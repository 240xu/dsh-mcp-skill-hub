/**
 * OAuth provider —— 为 dsh-mcp-skill-hub 的 MCP HTTP 行实现 OAuth 授权。
 *
 * 契约: oauth-provider-contract.md §3
 * 底层: auth-store.js（凭据持久化，0600）
 * 形态: @modelcontextprotocol/sdk 2.2.0 的 OAuthClientProvider 是 **interface**
 *       而非 class（安装版未导出该名字），故用对象字面量实现。
 *
 * 静态 Bearer 兜底 + OAuth 优先：SDK 的 StreamableHTTPClientTransport 在
 * provider.tokens() 有返回值时用 token 作 Authorization，否则才发 requestInit
 * 里的静态 headers —— 所以「patch 里的静态 API Token」与「OAuth token」天然共存，
 * OAuth 优先。
 *
 * 铁律 6: 任何错误信息只含 name 与 host，绝不含 token/client_secret。
 */

import { createHash, randomBytes } from 'node:crypto'
import {
  getClientInfo, setClientInfo, getTokens, setTokens,
  getCodeVerifier, setCodeVerifier, getOAuthState, setOAuthState,
} from './auth-store.js'

const CALLBACK_PATH = '/mcp/oauth/callback'
const CLIENT_NAME = 'dsh-mcp-skill-hub'
const STATE_BYTES = 32

/** 主动续期: 距离过期不足这个秒数就提前续(5 分钟)。 */
const REFRESH_SKEW_SEC = 300
/** 续期请求硬限时: 失败就走交互式授权兜底, 不能让 UI 卡住。 */
const REFRESH_TIMEOUT_MS = 10000

/**
 * 发现授权服务器的 token 端点。
 *
 * 顺序与 MCP 规范一致: 先读资源元数据(oauth-protected-resource)拿 issuer,
 * 再读 issuer 的授权服务器元数据; 都拿不到就退回「与 MCP 同源」的 /token
 * (Cloudflare MCP 的实际形态)。
 *
 * 结果按 serverUrl 缓存(5 分钟), 避免每个请求都多打两次 HTTP。
 */
const tokenEndpointCache = new Map()
const TOKEN_ENDPOINT_TTL_MS = 300000

async function discoverTokenEndpoint(serverUrl) {
  const key = String(serverUrl)
  const hit = tokenEndpointCache.get(key)
  if (hit && Date.now() - hit.at < TOKEN_ENDPOINT_TTL_MS) return hit.url

  const origin = (() => {
    try { return new URL(key).origin } catch { return null }
  })()
  if (!origin) return null

  const fetchJson = async (url) => {
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) return null
      return await res.json()
    } catch { return null }
  }

  // 1) 资源元数据 → issuer
  const resourceMeta = await fetchJson(`${origin}/.well-known/oauth-protected-resource`)
  const issuer = Array.isArray(resourceMeta?.authorization_servers)
    ? resourceMeta.authorization_servers[0]
    : origin

  // 2) 授权服务器元数据 → token_endpoint
  let tokenUrl = null
  for (const base of [issuer, origin]) {
    if (typeof base !== 'string' || base === '') continue
    const meta = await fetchJson(`${base.replace(/\/$/, '')}/.well-known/oauth-authorization-server`)
    if (typeof meta?.token_endpoint === 'string' && meta.token_endpoint !== '') {
      tokenUrl = meta.token_endpoint
      break
    }
  }
  // 3) 兜底: 同源 /token(Cloudflare MCP 的真实形态)
  if (!tokenUrl) tokenUrl = `${origin}/token`

  tokenEndpointCache.set(key, { url: tokenUrl, at: Date.now() })
  return tokenUrl
}

export { CALLBACK_PATH, CLIENT_NAME }

/** 主机名（错误信息里只能出现这个，不能出现 path/query/token）。 */
function hostOf(url) {
  try { return new URL(url).host } catch { return String(url) }
}

/**
 * 取一个 provider 工厂的可复现错误构造器：消息只含 name + host。
 */
function makeError(name, serverUrl) {
  const host = hostOf(serverUrl)
  return (detail) => new Error(`[mcpAuth:${name}@${host}] ${detail}`)
}

/**
 * 创建一个 OAuthClientProvider（SDK interface 形状）。
 *
 * @param {object} options
 * @param {string} options.name MCP 行 id（auth-store 索引键）
 * @param {string} options.serverUrl MCP 行 config.url
 * @param {string} options.filePath 凭据文件路径（auth-store）
 * @param {object} [options.staticHeaders] patch 里的静态 headers（仅审计，不参与读写）
 * @returns {object} OAuthClientProvider
 */
export function createAuthProvider(options) {
  const { name, serverUrl, filePath, staticHeaders } = options ?? {}
  if (typeof name !== 'string' || name === '') throw new Error('createAuthProvider: name must be a non-empty string')
  if (typeof serverUrl !== 'string' || serverUrl === '') throw new Error('createAuthProvider: serverUrl must be a non-empty string')
  if (typeof filePath !== 'string' || filePath === '') throw new Error('createAuthProvider: filePath must be a non-empty string')

  const fail = makeError(name, serverUrl)
  /** Hub 内部扩展（非 SDK 成员）：回调 server 起来后注入真实 redirect URL。 */
  let redirectUrl = ''

  const provider = {
    // ── SDK: 用户授权完成后回跳的 URL。授权开始前占位为空串，由 setRedirectUrl 注入。 ──
    get redirectUrl() {
      return redirectUrl === '' ? undefined : redirectUrl
    },

    setRedirectUrl(url) {
      if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
        throw fail('setRedirectUrl requires an http(s) URL')
      }
      redirectUrl = url
    },

    get callbackPath() {
      return CALLBACK_PATH
    },

    /** 审计用：暴露静态 headers 的存在性，不暴露值。 */
    get hasStaticHeaders() {
      return staticHeaders != null && Object.keys(staticHeaders).length > 0
    },

    // ── SDK: public client 元数据（token_endpoint_auth_method: none）。 ──
    get clientMetadata() {
      return {
        redirect_uris: redirectUrl === '' ? [`http://127.0.0.1:0${CALLBACK_PATH}`] : [redirectUrl],
        client_name: CLIENT_NAME,
        client_uri: 'https://github.com/240xu/dsh-plugins-src',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        scope: 'user:read account:read offline_access',
      }
    },

    // ── SDK: CSRF state。同时落 pending 态供回调校验。 ──
    state() {
      const state = randomBytes(STATE_BYTES).toString('hex')
      setOAuthState(filePath, name, state)
      return state
    },

    // ── SDK: DCR 结果读取。过期 clientSecret 视为未注册（触发重新 DCR）。 ──
    clientInformation() {
      const info = getClientInfo(filePath, name)
      if (!info) return undefined
      // RFC 7591: client_secret_expires_at = 0 表示永不过期。只有 > 0 才判过期。
      if (Number.isFinite(info.clientSecretExpiresAt) && info.clientSecretExpiresAt > 0
        && info.clientSecretExpiresAt <= Math.floor(Date.now() / 1000)) {
        return undefined
      }
      return {
        client_id: info.clientId,
        ...(info.clientSecret ? { client_secret: info.clientSecret } : {}),
        ...(Number.isFinite(info.clientIdIssuedAt) ? { client_id_issued_at: info.clientIdIssuedAt } : {}),
      }
    },

    /**
     * RFC 7591 动态客户端注册（DCR）。
     *
     * 为什么需要: Cloudflare 等授权服务器要求 /authorize 必须带 client_id。
     * Hub 的 /oauth/start 原先直接读 clientInformation()?.client_id, 若 dsh 的
     * mcp-client 库还没做过 DCR(它只在连接时触发), authUrl 就缺 client_id →
     * 授权页 400 invalid_request。
     *
     * 幂等: 已有未过期 clientInfo 时直接复用, 不再发 /register。
     * clientSecret 过期(client_secret_expires_at <= now)视为未注册, 重新注册。
     *
     * 返回 { client_id, client_secret?, ... }（同时落盘, 后续 clientInformation() 可读）。
     */
    async registerClient() {
      const existing = provider.clientInformation()
      if (existing) return existing

      const meta = provider.clientMetadata
      const base = String(serverUrl).endsWith('/') ? String(serverUrl) : String(serverUrl) + '/'
      const regUrl = new URL('/register', base)
      const body = {
        client_name: meta.client_name,
        client_uri: meta.client_uri,
        redirect_uris: meta.redirect_uris,
        grant_types: meta.grant_types,
        response_types: meta.response_types,
        token_endpoint_auth_method: meta.token_endpoint_auth_method,
        scope: meta.scope,
      }

      const res = await fetch(regUrl.toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        // 错误信息不得泄露任何凭据(铁律 6); 只带状态码与端点路径。
        throw fail(`DCR rejected by ${regUrl.pathname} (status ${res.status})`)
      }
      const json = await res.json()
      if (!json || typeof json.client_id !== 'string' || json.client_id === '') {
        throw fail('DCR response has no client_id')
      }
      provider.saveClientInformation(json)
      return provider.clientInformation() || { client_id: json.client_id }
    },

    // ── SDK: DCR 成功持久化。 ──
    saveClientInformation(info) {
      if (!info || typeof info.client_id !== 'string' || info.client_id === '') {
        throw fail('saveClientInformation received no client_id')
      }
      setClientInfo(filePath, name, {
        clientId: info.client_id,
        clientIdIssuedAt: Number.isFinite(info.client_id_issued_at)
          ? info.client_id_issued_at
          : Math.floor(Date.now() / 1000),
        ...(typeof info.client_secret === 'string' && info.client_secret !== ''
          ? { clientSecret: info.client_secret } : {}),
        ...(Number.isFinite(info.client_secret_expires_at)
          ? { clientSecretExpiresAt: info.client_secret_expires_at } : {}),
      })
    },

    /**
     * SDK: per-request token 读取路径。
     * ctx === undefined 时（transport 每请求调用）必须返回最近 token，
     * 不得返回 undefined —— 否则 SDK 会重复发起授权流。
     *
     * 主动续期(2026-11-06, 用户明确要求的 UX):
     *   以前只把 store 里的 token 原样交出去, 过期了也不管 —— 续期全靠 SDK
     *   连 MCP 收到 401 后走 auth() 里的 refresh 分支。问题是**没人用的行永远
     *   不会发请求**, 于是 token 过期后 UI 长期停在「授权掉了」, 用户必须手动
     *   再点一次授权。这是错的。
     *
     *   现在: 剩余有效期 < REFRESH_SKEW_SEC(5 分钟) 且有 refreshToken 时,
     *   在这里**同步续期**再交出新 token。任何一次读取都会顺带把状态修缮,
     *   不需要用户介入, 也不需要等一次失败的 401 往返。
     *
     *   并发: inflightRefresh 让同一 provider 的并发读取共享一次刷新 ——
     *   轮换型 refreshToken 被并发使用会互相作废。
     *   失败: 交回原 token(不抛), 让上层按 401 走已有交互式授权兜底。
     */
    tokens() {
      const stored = getTokens(filePath, name)
      if (!stored) return undefined
      const accessToken = typeof stored.accessToken === 'string' && stored.accessToken !== ''
        ? stored.accessToken
        : undefined
      if (accessToken === undefined) return undefined
      const now = Math.floor(Date.now() / 1000)
      const expiresIn = Number.isFinite(stored.expiresAt)
        ? Math.max(0, stored.expiresAt - now)
        // 无过期时间的 token 视为长期有效（Cloudflare API Token 的常见形态）
        : undefined
      return {
        access_token: accessToken,
        token_type: 'Bearer',
        ...(typeof stored.refreshToken === 'string' && stored.refreshToken !== ''
          ? { refresh_token: stored.refreshToken } : {}),
        ...(typeof stored.scope === 'string' && stored.scope !== ''
          ? { scope: stored.scope } : {}),
        ...(expiresIn !== undefined ? { expires_in: expiresIn } : {}),
      }
    },

    /**
     * Hub 内部(非 SDK 成员): 主动续期。
     *
     * 「过期自动换新」放在这里而不是 tokens() 里, 是因为 tokens() 是 SDK 的
     * **同步**契约成员(28 个既有用例同步读取它), 改成 async 会破坏兼容。
     * 由 Hub 在状态轮询 / 启动补偿时 await 本方法, 效果等价且不破坏契约。
     *
     * @returns {Promise<boolean>} 是否真的换到了新 token
     */
    async ensureFreshTokens() {
      const stored = getTokens(filePath, name)
      if (!stored) return false
      if (!needsRefresh(stored)) return false
      const got = await refreshOnce()
      return typeof got === 'string' && got !== ''
    },

    /**
     * SDK: 授权/刷新成功后存 token。
     * expires_in → expiresAt；不带 expires_in 时保留原值（防写坏）。
     */
    saveTokens(tokens) {
      if (!tokens || typeof tokens.access_token !== 'string' || tokens.access_token === '') {
        throw fail('saveTokens received no access_token')
      }
      const prev = getTokens(filePath, name) ?? {}
      const now = Math.floor(Date.now() / 1000)
      const expiresAt = Number.isFinite(tokens.expires_in) && tokens.expires_in >= 0
        ? now + tokens.expires_in
        : prev.expiresAt
      setTokens(filePath, name, {
        accessToken: tokens.access_token,
        ...(typeof tokens.refresh_token === 'string' && tokens.refresh_token !== ''
          ? { refreshToken: tokens.refresh_token } : {}),
        ...(expiresAt !== undefined ? { expiresAt } : {}),
        ...(typeof tokens.scope === 'string' && tokens.scope !== ''
          ? { scope: tokens.scope } : {}),
      })
    },

    /**
     * SDK: SDK 要求跳转到授权页时调用。
     * 本方案由 oauth-server.js 的 /start 路由打开浏览器（dsh 无内嵌浏览器），
     * 故这里只做协议校验，不真的 redirect。
     */
    redirectToAuthorization(authorizationUrl) {
      if (authorizationUrl == null) throw fail('redirectToAuthorization called without a URL')
      const url = authorizationUrl instanceof URL ? authorizationUrl : new URL(String(authorizationUrl))
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw fail(`redirectToAuthorization rejected non-http protocol: ${url.protocol}`)
      }
      // 协议合法即视为已交接给上层；真实跳转由 oauth-server 的 /start 完成。
    },

    // ── SDK: PKCE。 ──
    saveCodeVerifier(codeVerifier) {
      if (typeof codeVerifier !== 'string' || codeVerifier.length < 43) {
        throw fail('saveCodeVerifier requires a PKCE verifier')
      }
      setCodeVerifier(filePath, name, codeVerifier)
    },

    codeVerifier() {
      const v = getCodeVerifier(filePath, name)
      if (typeof v !== 'string' || v === '') {
        throw fail('no stored code verifier — authorization flow was not started for this entry')
      }
      return v
    },

    /** Hub 内部：已存 oauthState（供 /callback 校验）。 */
    getStoredState() {
      return getOAuthState(filePath, name)
    },

    /** Hub 内部：生成 S256 challenge（供 /start 调 authorize 用）。 */
    staticChallengeFor(verifier) {
      return createHash('sha256').update(String(verifier)).digest('base64url')
    },
  }

  // ── 主动续期实现 ─────────────────────────────────────────────────────
  // 放在 provider 对象外: 这些是内部机制, 不是 SDK 契约成员。
  // 用闭包状态做并发去重 —— 同一 provider 实例的并发 tokens() 共享一次刷新。

  /** 是否应当主动续期: 有 refreshToken, 且已过期或剩余不足 5 分钟。 */
  function needsRefresh(stored) {
    if (typeof stored?.refreshToken !== 'string' || stored.refreshToken === '') return false
    if (!Number.isFinite(stored.expiresAt)) return false // 无过期时间 = 长期有效
    return stored.expiresAt - Math.floor(Date.now() / 1000) < REFRESH_SKEW_SEC
  }

  /** 一次真实的 refresh_token 换 token。成功写回 store; 失败返回 null(不抛)。 */
  async function doRefresh() {
    const stored = getTokens(filePath, name)
    const refreshToken = stored?.refreshToken
    if (typeof refreshToken !== 'string' || refreshToken === '') return null
    const clientId = getClientInfo(filePath, name)?.clientId
    const tokenUrl = await discoverTokenEndpoint(serverUrl)
    if (!tokenUrl) return null

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      ...(clientId ? { client_id: clientId } : {}),
      ...(typeof stored.scope === 'string' && stored.scope !== '' ? { scope: stored.scope } : {}),
    })
    let res
    try {
      res = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: params.toString(),
        signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
      })
    } catch { return null }
    if (!res.ok) return null
    let json
    try { json = await res.json() } catch { return null }
    if (typeof json?.access_token !== 'string' || json.access_token === '') return null

    const now = Math.floor(Date.now() / 1000)
    const expiresAt = Number.isFinite(json.expires_in) && json.expires_in >= 0
      ? now + json.expires_in
      : stored.expiresAt
    try {
      setTokens(filePath, name, {
        accessToken: json.access_token,
        // 轮换时服务器会回新 refreshToken; 不回则保留旧的(RFC 6749 §6)
        refreshToken: typeof json.refresh_token === 'string' && json.refresh_token !== ''
          ? json.refresh_token : refreshToken,
        ...(expiresAt !== undefined ? { expiresAt } : {}),
        ...(typeof json.scope === 'string' && json.scope !== ''
          ? { scope: json.scope }
          : (typeof stored.scope === 'string' && stored.scope !== '' ? { scope: stored.scope } : {})),
      })
    } catch { return null }
    return json.access_token
  }

  /** 并发去重: 同一时刻只允许一个刷新在飞, 其余等待同一个 Promise。 */
  let inflightRefresh = null
  function refreshOnce() {
    if (inflightRefresh) return inflightRefresh
    inflightRefresh = doRefresh()
      .catch(() => null)
      .finally(() => { inflightRefresh = null })
    return inflightRefresh
  }

  return provider
}

export const __internals = { hostOf, makeError, CALLBACK_PATH, CLIENT_NAME, STATE_BYTES }
