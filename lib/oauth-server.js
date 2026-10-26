/**
 * OAuth 授权服务 —— Hub 侧的 5 条路由 + 临时回调 HTTP server。
 *
 * 契约: oauth-provider-contract.md §4
 *
 * 依赖注入而非重复造轮子：本模块只实现 OAuth 业务逻辑，所有与 host 半重复的
 * 能力（writeJson / readMcpRows / route 工厂 / logger）由 lib/index.js 的调用方
 * 注入，避免出现第二份实现（否则两处行为漂移就是缺陷源）。
 *
 * 设计定死项（用户阶段 3a 授权书第三节）：
 *   1. /oauth/start 响应 = {status, authUrl}，无 stateEcho
 *   2. /oauth/callback 410 → 友好 HTML「授权超时，请回 dsh 重新发起」
 *   3. 网络探测 AbortController 3s 硬限时；失败一律 need-auth；只有 2xx 返
 *      already-works、明确 401 进 OAuth；探测错误不落日志（只记 id + 结果枚举）
 *   4. in-flight Map 内存态：Map 无记录但 store 有 pending → 按 pending 处理
 *   5. 全部路由走 route() 工厂，自动继承 loopback 围栏
 *
 * 铁律 6: code/code_verifier/token/client_secret 一律不进响应体、日志、错误信息。
 */

import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { clearOAuthState, purgeStalePending, getEntry, listEntries, setTokens } from './auth-store.js'
import { createAuthProvider, CALLBACK_PATH } from './oauth-provider.js'

/** in-flight 授权表（内存态，HMR 后丢失，靠 store pending + 决策 4 兜底）。 */
const inflight = new Map()

const PROBE_TIMEOUT_MS = 3000
const CALLBACK_TTL_MS = 300000
const PENDING_MAX_AGE_MS = 600000
/** Hub API 前缀：与 lib/index.js 的 API 常量一致。 */
const API = '/api/dsh-mcp-skill-hub'

const TIMEOUT_HTML = '<!doctype html><meta charset="utf-8"><title>授权超时</title>'
  + '<body style="font:14px/1.6 system-ui;padding:2rem;max-width:32rem;margin:0 auto">'
  + '<h2>授权超时</h2><p>授权超时，请回 dsh 重新发起。</p></body>'

/** 探测结果枚举（日志只记这个，不记原因）。 */
const PROBE = { OK: 'ok', UNAUTHORIZED: 'unauthorized', UNREACHABLE: 'unreachable', OTHER: 'other' }

/**
 * needs_auth 探测缓存（TTL 60s）。
 *
 * 学 opencode 的 MCPStatus 口径: needs_auth 必须是「连接时真的拿到 401」的结论,
 * 不能预先假设。但 UI 每 10s 轮询一次 /oauth/status, 若不缓存会对上游造成
 * 3s 超时 × 6 行的持续压力。故缓存探测结论, TTL 到期才重探。
 *
 * key = rowId, value = { needsAuth: bool, at: ms }
 */
const NEEDS_AUTH_CACHE = new Map()
const NEEDS_AUTH_TTL_MS = 60000

/** 构造 authorize URL（端点路径实测为 /authorize，无 /oauth 前缀）。 */
export function buildAuthorizeUrl(serverUrl, { clientId, redirectUri, codeChallenge, codeChallengeMethod, state, scope }) {
  const base = String(serverUrl).endsWith('/') ? String(serverUrl) : String(serverUrl) + '/'
  const u = new URL('/authorize', base)
  if (clientId) u.searchParams.set('client_id', clientId)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('redirect_uri', String(redirectUri))
  u.searchParams.set('code_challenge', codeChallenge)
  u.searchParams.set('code_challenge_method', codeChallengeMethod)
  u.searchParams.set('state', state)
  if (scope) u.searchParams.set('scope', scope)
  return u.toString()
}

/** authorization_code 换 token：直接打 /token，避免 Hub 侧对 SDK 的运行时依赖。 */
export async function exchangeCode({ url, code, verifier, redirectUri, clientId }) {
  const base = String(url).endsWith('/') ? String(url) + '/' : String(url)
  const tokenUrl = new URL('/token', base)
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    redirect_uri: String(redirectUri),
    ...(clientId ? { client_id: clientId } : {}),
  })
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: params.toString(),
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { throw Object.assign(new Error('token endpoint returned non-json'), { status: 502 }) }
  if (!res.ok || typeof json.access_token !== 'string') {
    throw Object.assign(new Error('token exchange rejected'), { status: 400 })
  }
  return json
}

/**
 * AbortController 硬限时探测：用 patch 里的静态 headers 请求一次 MCP 端点。
 *
 * 决策 3：失败一律降级（不进 OAuth 判定）；只有明确 2xx → OK、明确 401 → UNAUTHORIZED。
 * 绝不把探测失败写进日志。
 */
export async function probeStaticHeaders(url, headers) {
  if (typeof fetch !== 'function') return PROBE.UNREACHABLE
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), PROBE_TIMEOUT_MS)
  try {
    const res = await fetch(String(url), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(headers || {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: {
          protocolVersion: '2025-06-18', capabilities: {},
          clientInfo: { name: 'dsh-mcp-skill-hub', version: '0.1.0' },
        },
      }),
      signal: ac.signal,
      redirect: 'manual',
    })
    if (res.status >= 200 && res.status < 300) return PROBE.OK
    if (res.status === 401) return PROBE.UNAUTHORIZED
    return PROBE.OTHER
  } catch {
    return PROBE.UNREACHABLE
  } finally {
    clearTimeout(timer)
  }
}

/** token 响应 → StoredOAuthTokens 形状（字段名按 auth-store / SDK 两侧契约映射）。 */
export function normalizeToken(t) {
  const now = Math.floor(Date.now() / 1000)
  return {
    access_token: t.access_token,
    token_type: typeof t.token_type === 'string' ? t.token_type : 'Bearer',
    ...(typeof t.refresh_token === 'string' && t.refresh_token !== '' ? { refresh_token: t.refresh_token } : {}),
    ...(Number.isFinite(t.expires_in) ? { expires_in: t.expires_in } : {}),
    ...(typeof t.scope === 'string' && t.scope !== '' ? { scope: t.scope } : {}),
  }
}

/**
 * 注册 5 条 OAuth 路由。
 *
 * @param {object} deps
 * @param {(path, method, handler) => object} deps.route host 半的路由工厂（自带 loopback 围栏 + 405 + 错误兜底）
 * @param {string} deps.patchPath cordis.patch.yml 路径
 * @param {string} deps.authPath mcp-auth.json 路径
 * @param {(patchPath, ctx) => {rows: Array}} deps.readMcpRows host 半的 MCP 行读取（含 live/enabled）
 * @param {(res, status, body) => void} deps.writeJson host 半的 JSON 响应
 */
export function registerOAuthRoutes({ route, patchPath, authPath, readMcpRows, writeJson, seamState }) {
  if (typeof route !== 'function') throw new Error('registerOAuthRoutes: deps.route must be a function')
  if (typeof readMcpRows !== 'function') throw new Error('registerOAuthRoutes: deps.readMcpRows must be a function')
  if (typeof writeJson !== 'function') throw new TypeError('registerOAuthRoutes: deps.writeJson must be a function')

  const rowsOf = () => {
    try { return readMcpRows(patchPath, {}).rows || [] } catch { return [] }
  }
  // 未 mask 的静态 headers/env(0.3.4 起由 readMcpRows 单列返回, 不再挂在 row 上,
  // 以免经 /state 泄露)。仅供探测路径按需取用, 绝不进任何响应体。
  const rawSecretsOf = () => {
    try { return readMcpRows(patchPath, {}).rawSecrets || new Map() } catch { return new Map() }
  }
  const rawHeadersFor = (id) => {
    const got = rawSecretsOf().get(id)
    return (got && got.headers) || {}
  }
  const requireRow = (res, id) => {
    const row = rowsOf().find((r) => r.id === id)
    if (!row) { writeJson(res, 404, { error: 'unknown mcp id' }); return null }
    return row
  }
  const requireBodyId = async (req, res) => {
    const body = await new Promise((resolve) => {
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        try { resolve(raw ? JSON.parse(raw) : {}) } catch { resolve({}) }
      })
      req.on('error', () => resolve({}))
    })
    const id = typeof body?.id === 'string' ? body.id : ''
    if (id === '') { writeJson(res, 400, { error: 'missing id' }); return null }
    const row = requireRow(res, id)
    return row ? { id, row } : null
  }
  const statusOf = (id) => {
    const entry = getEntry(authPath, id)
    const toks = entry && entry.tokens
    if (toks && typeof toks.accessToken === 'string' && toks.accessToken !== '') {
      const exp = Number(toks.expiresAt)
      const expired = Number.isFinite(exp) && exp <= Math.floor(Date.now() / 1000)
      return expired ? 'expired' : 'authenticated'
    }
    if (entry && (entry.codeVerifier !== undefined || entry.oauthState !== undefined)) {
      // pending 过期判据与回调侧一致(pendingAt + PENDING_MAX_AGE_MS):
      // 用户 TTL 后没在浏览器完成授权, 这里就报 expired 让 UI 提示重新点。
      const pendingAt = Number(entry.pendingAt)
      if (!Number.isFinite(pendingAt)
        || pendingAt < Math.floor((Date.now() - PENDING_MAX_AGE_MS) / 1000)) {
        return 'expired'
      }
      return 'pending'
    }
    return 'not_authenticated'
  }
  const closeCallback = (id) => {
    const rec = inflight.get(id)
    if (!rec) return
    inflight.delete(id)
    try { rec.server.close() } catch { /* already closed */ }
    if (rec.timer) clearTimeout(rec.timer)
  }
  /** 临时回调 server 的处理器（独立于主 server）。 */
  async function serveCallback(req, res) {
    const u = new URL(req.url, 'http://127.0.0.1')
    if (u.pathname !== CALLBACK_PATH) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      return res.end('not found')
    }
    const code = u.searchParams.get('code')
    const stateParam = u.searchParams.get('state') || ''
    if (!stateParam) {
      res.writeHead(400, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      return res.end('<h2>参数缺失</h2><p>缺少 state。</p>')
    }
    // 定位 id：先看内存 in-flight（本次进程发起的），再退回 store 的 pending
    // （HMR/重启后内存丢了但 store 还在 → 仍可走完校验与换 token）。
    let id = [...inflight.entries()].find(([, rec]) => rec.state === stateParam)?.[0]
    if (id === undefined) id = findEntryByState(stateParam)
    if (id === undefined) {
      // 三重校验①（不存在）：state 既不在内存也不在 store → 过期/重放/伪造。
      // 契约 §4：不存在 → 400（不是 410）。
      res.writeHead(400, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      return res.end('<h2>授权校验失败</h2><p>state 无效或已过期，请回 dsh 重新发起。</p>')
    }
    const rec = inflight.get(id)
    const reply = (status, html) => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(html)
      closeCallback(id)
      clearOAuthState(authPath, id)
    }
    // 三重校验（匹配）：store 里该 entry 的 oauthState 必须与收到的相同
    const entry = getEntry(authPath, id)
    if (entry?.oauthState !== stateParam) {
      return reply(400, '<h2>授权校验失败</h2><p>state 不匹配，可能存在 CSRF 风险，请回 dsh 重新发起。</p>')
    }
    if (!code) return reply(400, '<h2>参数缺失</h2><p>缺少 code。</p>')
    // 三重校验②（时效）：pendingAt 判据，与 auth-store 的缺陷修复对齐
    const pendingAt = Number(entry?.pendingAt)
    if (!Number.isFinite(pendingAt) || pendingAt < Math.floor((Date.now() - PENDING_MAX_AGE_MS) / 1000)) {
      purgeStalePending(authPath, PENDING_MAX_AGE_MS)
      return reply(400, '<h2>授权已过期</h2><p>授权会话已过期，请回 dsh 重新发起。</p>')
    }
    // 三重校验③（重放）：state 被消费后 store 的 oauthState 已清，第二次同 state
    // 进来时 findEntryByState 找不到 → 命中上面的「不存在」分支 400。
    let tokens
    try {
      tokens = await exchangeCode({
        url: rec?.url || entryUrl(entry),
        code,
        verifier: rec?.verifier || (await codeVerifierOf(entry)),
        redirectUri: rec?.provider?.redirectUrl || `http://127.0.0.1${CALLBACK_PATH}`,
        clientId: rec?.provider?.clientInformation()?.client_id,
      })
    } catch {
      return reply(400, '<h2>授权失败</h2><p>换取 token 失败，请回 dsh 重新发起。</p>')
    }
    if (rec?.provider) rec.provider.saveTokens(normalizeToken(tokens), {})
    else {
      // HMR 后内存无 provider：用 auth-store 直接落（provider 只是 auth-store 的薄壳）
      setTokens(authPath, id, normalizeToken(tokens))
      setTokens(authPath, id, normalizeToken(tokens))
    }
    clearOAuthState(authPath, id)
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end('<h2>授权成功</h2><p>可以关闭此窗口，回到 dsh。</p>')
    closeCallback(id)
  }

  // ── 1. /oauth/start ──
  const startHandler = async (req, res) => {
    const got = await requireBodyId(req, res)
    if (!got) return
    const { id, row } = got
    const url = row?.config?.url
    if (typeof url !== 'string' || url === '') return writeJson(res, 400, { error: 'mcp row has no http url' })
    if (inflight.has(id)) return writeJson(res, 409, { error: 'authorization already in flight' })

    // 探测：静态 headers（patch 里的 API Token）是否已够用。
    // 必须用未 mask 的原值；row.config.headers 已被 maskSecrets 换成 '•••'，
    // 拿它探测会让所有静态 Token 行都判成 need-auth（审计 M3）。
    // 原值经 rawHeadersFor 从 host 半单独取，不经过客户端传来的 row（0.3.4 安全修正）。
    const rawHeaders = rawHeadersFor(id)
    const probe = await probeStaticHeaders(url, rawHeaders)
    if (probe === PROBE.OK) return writeJson(res, 200, { status: 'already-works' })
    // DCR 失败信息(不阻断授权, 仅提示)
    let dcrError = null
    // PROBE.UNAUTHORIZED → 进 OAuth；PROBE.OTHER / PROBE.UNREACHABLE → 决策 3 降级为 need-auth

    const provider = createAuthProvider({ name: id, serverUrl: url, filePath: authPath })
    const server = http.createServer(serveCallback)
    server.unref()
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
      })
    } catch {
      closeCallback(id)
      return writeJson(res, 503, { error: 'callback server unavailable' })
    }
    const port = server.address().port
    provider.setRedirectUrl(`http://127.0.0.1:${port}${CALLBACK_PATH}`)

    // DCR: Cloudflare 等授权服务器要求 /authorize 必须带 client_id。dsh 的
    // mcp-client 库只在连接时才触发 DCR, 时序在 /oauth/start 之后 —— 若不在这里
    // 先注册一次, authUrl 就缺 client_id, 授权页直接 400 invalid_request。
    // registerClient() 幂等: 已有未过期 clientInfo 时复用, 不发 /register。
    let clientId
    try {
      const reg = await provider.registerClient()
      clientId = reg?.client_id
    } catch (e) {
      // DCR 失败不阻断授权: 有的服务器不需要 client_id(纯 PKCE)。带上错误信息
      // 让 UI 能提示, 但 authUrl 仍照常生成。
      dcrError = e?.message ? String(e.message) : String(e)
    }

    // PKCE + state
    const verifier = randomBytes(32).toString('base64url')
    provider.saveCodeVerifier(verifier)
    const state = provider.state()
    const authUrl = buildAuthorizeUrl(url, {
      clientId: clientId || provider.clientInformation()?.client_id,
      redirectUri: provider.redirectUrl,
      codeChallenge: provider.staticChallengeFor(verifier),
      codeChallengeMethod: 'S256',
      state,
      scope: provider.clientMetadata.scope,
    })

    const timer = setTimeout(() => {
      closeCallback(id)
      clearOAuthState(authPath, id)
    }, CALLBACK_TTL_MS)
    timer.unref?.()
    inflight.set(id, { provider, server, timer, state, verifier, url })

    // 决策 1: 只返 status + authUrl（dcrError 仅在 DCR 失败时出现）
    writeJson(res, 200, { status: 'need-auth', authUrl, ...(dcrError ? { dcrError } : {}) })
  }

  /**
   * 该行是否「需要授权」—— 学 opencode 的 needs_auth 口径。
   *
   * 判定链:
   *   1. store 已有 accessToken            → false（已授权过）
   *   2. 探测静态 headers 得 2xx            → false（静态 Token 已够用）
   *   3. 探测得 401                         → true （明确需要授权）
   *   4. 探测不可达(超时/DNS/连接失败)       → 'unknown'（不猜, 但也不隐藏:
   *      用户可能在一个能连通的环境里用, 静默判 false 会让授权入口永不出现,
   *      用户想授权也无从下手。交给用户决定。)
   *   5. 其它(403 等)                       → false（服务端明确拒绝静态 Token,
   *      但那不是 OAuth 需求; 留给连接时报错）
   *
   * 60s TTL 缓存: UI 每 10s 轮询一次, 不缓存会对上游造成持续压力。
   *
   * 返回值: true | false | 'unknown'
   */
  const probeNeedsAuth = async (id, row, authPath) => {
    const cached = NEEDS_AUTH_CACHE.get(id)
    const now = Date.now()
    if (cached && now - cached.at < NEEDS_AUTH_TTL_MS) return cached.needsAuth
    let needs = false
    try {
      const entry = getEntry(authPath, id)
      const hasToken = !!(entry?.tokens && typeof entry.tokens.accessToken === 'string' && entry.tokens.accessToken !== '')
      if (hasToken) {
        needs = false
      } else {
        const url = row?.config?.url
        if (typeof url !== 'string' || url === '') {
          needs = false
        } else {
          const probe = await probeStaticHeaders(url, rawHeadersFor(row.id))
          if (probe === PROBE.UNAUTHORIZED) needs = true
          else if (probe === PROBE.UNREACHABLE) needs = 'unknown'
          else needs = false
        }
      }
    } catch { needs = 'unknown' }
    NEEDS_AUTH_CACHE.set(id, { needsAuth: needs, at: now })
    return needs
  }

  // ── 2. /oauth/status ──
  const statusHandler = async (req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1')
    const id = u.searchParams.get('id')
    if (!id) return writeJson(res, 400, { error: 'missing id' })
    const row = requireRow(res, id)
    if (!row) return
    const entry = getEntry(authPath, id)
    const toks = entry?.tokens
    const pendingAt = Number(entry?.pendingAt)
    const now = Math.floor(Date.now() / 1000)
    const status = statusOf(id)
    // needsAuth: 该行是否真的需要 OAuth。判定标准学 opencode —— 连接时拿到
    // 401 才算 needs_auth, 不预先假设。带 60s TTL 缓存, 避免 UI 10s 轮询
    // 对上游造成持续压力。
    //
    // 已授权/授权中的行不需要再判(直接 false), 省一次探测。
    const needsAuth = (status === 'authenticated' || status === 'pending')
      ? false
      : await probeNeedsAuth(id, row, authPath)
    // expiresAt 语义: tokens 有 → token 过期时刻; pending 有 → pending 过期时刻
    // (pendingAt + PENDING_MAX_AGE_MS)。UI 据此提示「已超时, 请重新授权」。
    const pendingExpiresAt = Number.isFinite(pendingAt) ? pendingAt + Math.floor(PENDING_MAX_AGE_MS / 1000) : null
    writeJson(res, 200, {
      id,
      status,
      hasClientId: !!(entry?.clientInfo?.clientId),
      hasTokens: !!(toks && toks.accessToken),
      expiresAt: toks?.expiresAt ?? (status === 'expired' || status === 'pending' ? pendingExpiresAt : null),
      pendingAgeSec: Number.isFinite(pendingAt) ? Math.max(0, now - pendingAt) : null,
      inFlight: inflight.has(id),
      // needsAuth: true=确认需要授权; false=不需要; 'unknown'=探测不可达(不猜,
      // 但 UI 会显示授权入口让用户自己决定 —— 静默隐藏会让用户想授权也无从下手)。
      needsAuth,
      // probeFailed: 探测是否因网络不可达而失败(供 UI 显示「探测失败」标注)。
      probeFailed: needsAuth === 'unknown',
      // P1-8: OAuth seam 补丁状态。非 patched/already 时 UI 应显示红色横幅 ——
      // 此前 dsh 升级后补丁失效是静默的, 用户只看到「已授权」而功能全废。
      ...(typeof seamState === 'function'
        ? { seam: seamState() }
        : {}),
    })
  }

  // ── 3. /oauth/finish ──
/** 从 store 的 pending 里反查持有该 state 的 entry id（HMR/重启后内存丢失时用）。 */
function findEntryByState(state) {
  try {
    for (const { name, entry } of listEntries(authPath)) {
      if (entry?.oauthState === state) return name
    }
  } catch { /* store 不存在/损坏 → 视为无 */ }
  return undefined
}
/** entry 里存的 serverUrl（HMR 后用 store 补 rec 缺失的字段）。 */
function entryUrl(entry) {
  return typeof entry?.serverUrl === 'string' ? entry.serverUrl : ''
}
/** entry 里存的 code_verifier。 */
function codeVerifierOf(entry) {
  return typeof entry?.codeVerifier === 'string' ? entry.codeVerifier : ''
}

const finishHandler = async (req, res) => {
    const got = await requireBodyId(req, res)
    if (!got) return
    const hadPending = getEntry(authPath, got.id)?.codeVerifier !== undefined
      || getEntry(authPath, got.id)?.oauthState !== undefined
    const wasInflight = inflight.has(got.id)
    closeCallback(got.id)
    clearOAuthState(authPath, got.id)
    writeJson(res, 200, { status: 'ok', cleared: hadPending || wasInflight })
  }

  // ── 4. /oauth/cancel ──
  const cancelHandler = async (req, res) => {
    const got = await requireBodyId(req, res)
    if (!got) return
    closeCallback(got.id)
    clearOAuthState(authPath, got.id)
    writeJson(res, 200, { status: 'ok', closed: true })
  }

  return [
    route(API + '/oauth/start', 'POST', startHandler),
    route(API + '/oauth/callback', 'GET', async (req, res) => {
      // 主 server 上的 /oauth/callback 只作说明。真实回调由 /oauth/start 起的
      // 临时 server 在 127.0.0.1:<random>+CALLBACK_PATH 上服务（围栏天然满足）。
      writeJson(res, 200, { status: 'note', message: 'callback is served by the ephemeral server started by /oauth/start' })
    }),
    route(API + '/oauth/status', 'GET', statusHandler),
    route(API + '/oauth/finish', 'POST', finishHandler),
    route(API + '/oauth/cancel', 'POST', cancelHandler),
  ]
}

export const __internals = { inflight, PROBE, TIMEOUT_HTML, CALLBACK_TTL_MS, PENDING_MAX_AGE_MS }
