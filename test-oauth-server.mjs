/**
 * oauth-server 契约测试 —— 先于实现存在（TDD 先红）。
 *
 * 直接测 registerOAuthRoutes（注入假 route/writeJson/readMcpRows），
 * 覆盖 oauth-provider-contract.md §4 与授权书第三节定死的决策：
 *   1. /oauth/start 响应 = {status, authUrl}，无 stateEcho
 *   2. 410 友好 HTML「授权超时，请回 dsh 重新发起」
 *   3. 探测 AbortController 3s；失败一律 need-auth；2xx → already-works；401 → OAuth；探测错误不落日志
 *   4. Map 无记录但 store 有 pending → 按 pending 处理
 *   5. 路由工厂自带 loopback 围栏
 *
 * 前置 2: state 三重校验（不存在 / pending 过期+purge / 重放）TDD 先红。
 *
 * 注意: `inflight` 是模块级 Map，故每个用例用唯一 id 隔离，防跨用例串扰。
 *
 * 运行: node --test test-oauth-server.mjs
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const HUB = '/data/data/com.termux/files/home/dsh-plugins-src/dsh-mcp-skill-hub'
let mod = null
let authStore = null
try {
  mod = await import(HUB + '/lib/oauth-server.js')
  authStore = await import(HUB + '/lib/auth-store.js')
} catch (error) {
  mod = null
}

test('lib/oauth-server.js 可加载（实现缺失即失败，不是 skip）', () => {
  assert.ok(mod, 'lib/oauth-server.js 应可 import')
  assert.equal(typeof mod.registerOAuthRoutes, 'function', '应导出 registerOAuthRoutes')
  assert.ok(authStore, 'lib/auth-store.js 应可 import')
})

const tmpdirs = []
let uid = 0
const nextId = () => 'mcp-t' + (++uid)

function sandbox(id) {
  const dir = mkdtempSync('/data/data/com.termux/files/usr/tmp/opencode/osv-')
  tmpdirs.push(dir)
  const patchPath = join(dir, 'cordis.patch.yml')
  const authPath = join(dir, 'mcp-auth.json')
  writeFileSync(patchPath, [
    '# 用户注释,必须保留',
    '- insert:',
    '    - id: ' + id,
    "      name: '@deepseek-ai/dsh-mcp-client'",
    '      config:',
    '        serverName: demo',
    '        transport: streamable-http',
    '        url: https://demo.example.com/mcp',
    '',
  ].join('\n'))
  return { dir, patchPath, authPath }
}
test.after(() => { for (const d of tmpdirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} } })

/** 假 route 工厂：复刻 lib/index.js 的围栏/405/错误兜底语义。 */
function makeHarness(s, id, row) {
  const routes = []
  const warns = []
  const isLoopback = (a) => a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1'
  const writeJson = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  }
  const route = (path, method, handler) => ({
    kind: 'exact',
    path,
    handler: async (req, res) => {
      if (!isLoopback(req?.socket?.remoteAddress)) return writeJson(res, 403, { error: 'forbidden' })
      if (req.method !== method) return writeJson(res, 405, { error: 'method not allowed' })
      try { await handler(req, res) } catch (e) {
        warns.push(String(e?.message || e))
        if (!res.headersSent) writeJson(res, e?.status || 500, { error: String(e?.message || e) })
      }
    },
  })
  const registered = mod.registerOAuthRoutes({
    route,
    patchPath: s.patchPath,
    authPath: s.authPath,
    readMcpRows: () => ({ rows: [row] }),
    writeJson,
  })
  routes.push(...registered)
  return { routes, warns }
}

function makeReq(method, url, { body, remoteAddress = '127.0.0.1' } = {}) {
  const listeners = {}
  const req = {
    method, url, socket: { remoteAddress },
    on(ev, fn) {
      (listeners[ev] ||= []).push(fn)
      return req
    },
    destroy() {},
  }
  // 注册后异步投递（模拟真实 IncomingMessage 的数据流时序）
  setTimeout(() => {
    if (body !== undefined) (listeners.data || []).forEach((f) => f(Buffer.from(JSON.stringify(body))))
    ;(listeners.end || []).forEach((f) => f())
  }, 0)
  return req
}
function makeRes() {
  return {
    statusCode: 0, headers: null, body: '', headersSent: false,
    writeHead(s, h) { this.statusCode = s; this.headers = h; this.headersSent = true },
    end(b) { this.body = b || '' },
  }
}
const API = '/api/dsh-mcp-skill-hub'
async function call(h, path, method = 'GET', body, opts) {
  // registerOAuthRoutes 内部自己拼 API 前缀；测试侧用裸路径调用，这里做归一。
  const full = path.startsWith(API) ? path : API + path
  const [pathOnly] = full.split('?')
  const r = h.routes.find((x) => x.path === pathOnly)
  if (!r) throw new Error('no route ' + pathOnly + '（实际 ' + h.routes.map((x) => x.path).join(', ') + '）')
  const res = makeRes()
  await r.handler(makeReq(method, full, { body, ...opts }), res)
  let json = null
  try { json = JSON.parse(res.body) } catch {}
  return { status: res.statusCode, json, raw: res.body }
}

/** 起授权并返回回调端口（保证 probe 不真连网：注入假 fetch）。 */
async function startWith(h, id, fetchImpl) {
  const realFetch = globalThis.fetch
  if (fetchImpl) globalThis.fetch = fetchImpl
  try {
    const r = await call(h, '/oauth/start', 'POST', { id })
    return r
  } finally {
    if (fetchImpl) globalThis.fetch = realFetch
  }
}
const portOf = (id) => mod.__internals.inflight.get(id)?.server?.address()?.port

// ── 注册 ──
test('5 条路由注册', () => {
  const id = nextId()
  const s = sandbox(id)
  const h = makeHarness(s, id, { id, config: { url: 'https://demo.example.com/mcp', headers: {} } })
  const paths = h.routes.map((r) => r.path).sort()
  for (const p of ['/oauth/start', '/oauth/callback', '/oauth/status', '/oauth/finish', '/oauth/cancel']) {
    assert.ok(paths.some((x) => x === API + p), `应注册 ${API}${p}（实际 ${paths.join(' ')}）`)
  }
})

// ── 围栏（决策 5） ──
test('围栏: 非 loopback 全 403', async () => {
  const id = nextId()
  const s = sandbox(id)
  const h = makeHarness(s, id, { id, config: { url: 'https://demo.example.com/mcp', headers: {} } })
  for (const p of ['/oauth/start', '/oauth/status', '/oauth/finish', '/oauth/cancel']) {
    const r = await call(h, p, 'POST', { id }, { remoteAddress: '192.168.1.9' })
    assert.equal(r.status, 403, `${p} 对局域网 IP 应 403`)
  }
  const rc = await call(h, '/oauth/callback', 'GET', undefined, { remoteAddress: '10.0.0.5' })
  assert.equal(rc.status, 403, 'callback 对局域网 IP 应 403')
})

// ── 状态机（决策 4） ──
test('状态机: not_authenticated / 缺 id 400 / 未知 id 404', async () => {
  const id = nextId()
  const s = sandbox(id)
  const h = makeHarness(s, id, { id, config: { url: 'https://demo.example.com/mcp', headers: {} } })
  const r = await call(h, '/oauth/status?id=' + id, 'GET')
  assert.equal(r.status, 200)
  assert.equal(r.json.status, 'not_authenticated')
  assert.equal(r.json.hasClientId, false)
  assert.equal(r.json.hasTokens, false)
  assert.equal((await call(h, '/oauth/status', 'GET')).status, 400)
  assert.equal((await call(h, '/oauth/status?id=ghost', 'GET')).status, 404)
})

test('状态机: store 有 pending + 内存无记录 → pending（决策4 防 HMR 卡死）', async () => {
  const id = nextId()
  const s = sandbox(id)
  const h = makeHarness(s, id, { id, config: { url: 'https://demo.example.com/mcp', headers: {} } })
  authStore.setOAuthState(s.authPath, id, 'a'.repeat(64))
  authStore.setCodeVerifier(s.authPath, id, 'v'.repeat(43))
  const r = await call(h, '/oauth/status?id=' + id, 'GET')
  assert.equal(r.json.status, 'pending', 'store 有 pending 应按 pending 处理')
  assert.ok(r.json.pendingAgeSec >= 0, '应报 pendingAgeSec')
  assert.equal(r.json.inFlight, false, '内存无记录')
})

test('状态机: pending 过期 → expired + expiresAt（降级方案 B, 不依赖浏览器）', async () => {
  const id = nextId()
  const s = sandbox(id)
  const h = makeHarness(s, id, { id, config: { url: 'https://demo.example.com/mcp', headers: {} } })
  authStore.setOAuthState(s.authPath, id, 'a'.repeat(64))
  authStore.setCodeVerifier(s.authPath, id, 'v'.repeat(43))
  // pendingAt 拨到 11 分钟前（> PENDING_MAX_AGE_MS 600s）
  const raw = JSON.parse(readFileSync(s.authPath, 'utf8'))
  raw[id].pendingAt = Math.floor(Date.now() / 1000) - 700
  writeFileSync(s.authPath, JSON.stringify(raw))
  const r = await call(h, '/oauth/status?id=' + id, 'GET')
  assert.equal(r.json.status, 'expired', 'pending 超时应报 expired 而非 pending')
  assert.ok(Number.isFinite(r.json.expiresAt), '应给出 expiresAt 供 UI 展示')
  assert.equal(r.json.expiresAt, raw[id].pendingAt + 600, 'expiresAt = pendingAt + TTL')
  // 未过期的 pending 仍报 pending
  const id2 = nextId()
  const s2 = sandbox(id2)
  const h2 = makeHarness(s2, id2, { id: id2, config: { url: 'https://demo.example.com/mcp', headers: {} } })
  authStore.setOAuthState(s2.authPath, id2, 'b'.repeat(64))
  const r2 = await call(h2, '/oauth/status?id=' + id2, 'GET')
  assert.equal(r2.json.status, 'pending', '未过期仍报 pending')
})

test('状态机: 有 tokens → authenticated；已过期 → expired', async () => {
  const id = nextId()
  const s = sandbox(id)
  const h = makeHarness(s, id, { id, config: { url: 'https://demo.example.com/mcp', headers: {} } })
  const now = Math.floor(Date.now() / 1000)
  authStore.setTokens(s.authPath, id, { accessToken: 'AT', expiresAt: now + 3600 })
  assert.equal((await call(h, '/oauth/status?id=' + id, 'GET')).json.status, 'authenticated')
  authStore.setTokens(s.authPath, id, { accessToken: 'AT', expiresAt: now - 60 })
  assert.equal((await call(h, '/oauth/status?id=' + id, 'GET')).json.status, 'expired')
})

// ── /oauth/start ──
test('start: 探测失败(非 2xx 非 401) → need-auth, 响应只有 status+authUrl(决策1+3)', async () => {
  const id = nextId()
  const s = sandbox(id)
  const h = makeHarness(s, id, { id, config: { url: 'https://demo.example.com/mcp', headers: {} } })
  const r = await startWith(h, id, async () => ({ status: 500 }))
  assert.equal(r.status, 200, 'start 应 200, 得到 ' + r.status + ' ' + r.raw)
  assert.equal(r.json.status, 'need-auth', '探测非 2xx/401 应降级 need-auth(决策3)')
  assert.ok(typeof r.json.authUrl === 'string' && r.json.authUrl.startsWith('https://'), 'authUrl 应为 https')
  assert.equal(r.json.stateEcho, undefined, '不得有 stateEcho(决策1)')
  for (const bad of ['access_token', 'accessToken', 'refresh_token', 'clientSecret', 'code_verifier']) {
    assert.ok(!r.raw.includes(bad), `响应体不得含 ${bad}`)
  }
  assert.equal(h.warns.length, 0, `探测失败不应落日志, 实际 ${JSON.stringify(h.warns)}`)
  await call(h, '/oauth/cancel', 'POST', { id })
})

test('start: 2xx → already-works（决策3 另一方向）', async () => {
  const id = nextId()
  const s = sandbox(id)
  const h = makeHarness(s, id, { id, config: { url: 'https://demo.example.com/mcp', headers: {} } })
  const r = await startWith(h, id, async () => ({ status: 200 }))
  assert.equal(r.json.status, 'already-works', '2xx 应 already-works')
  assert.equal(r.json.authUrl, undefined, 'already-works 不应有 authUrl')
})

test('start: 只有明确 401 才进 OAuth（决策3）', async () => {
  const id = nextId()
  const s = sandbox(id)
  const h = makeHarness(s, id, { id, config: { url: 'https://demo.example.com/mcp', headers: {} } })
  const r = await startWith(h, id, async () => ({ status: 403 }))
  assert.equal(r.json.status, 'need-auth', '403 不是 401 → 降级 need-auth')
  assert.ok(r.json.authUrl, '降级后仍给 authUrl')
  await call(h, '/oauth/cancel', 'POST', { id })
})

test('start: 401 → 进 OAuth 流程并落 pending', async () => {
  const id = nextId()
  const s = sandbox(id)
  const h = makeHarness(s, id, { id, config: { url: 'https://demo.example.com/mcp', headers: {} } })
  const r = await startWith(h, id, async () => ({ status: 401 }))
  assert.equal(r.json.status, 'need-auth')
  assert.ok(typeof authStore.getOAuthState(s.authPath, id) === 'string', '应落 pending state')
  assert.ok(typeof authStore.getCodeVerifier(s.authPath, id) === 'string', '应落 code verifier')
  await call(h, '/oauth/cancel', 'POST', { id })
})

test('start: 真实网络不可达 → need-auth 且不落日志(真 fetch)', async () => {
  const id = nextId()
  const s = sandbox(id)
  const h = makeHarness(s, id, { id, config: { url: 'http://127.0.0.1:1/mcp', headers: {} } })
  const r = await startWith(h, id, null)
  assert.equal(r.json.status, 'need-auth', '不可达应降级 need-auth')
  assert.ok(typeof r.json.authUrl === 'string' && r.json.authUrl.length > 10, '仍应给 authUrl')
  assert.equal(h.warns.length, 0, '探测失败不应落日志')
  await call(h, '/oauth/cancel', 'POST', { id })
})

test('start: 未知 id → 404；缺 id → 400', async () => {
  const id = nextId()
  const s = sandbox(id)
  const h = makeHarness(s, id, { id, config: { url: 'https://demo.example.com/mcp', headers: {} } })
  assert.equal((await call(h, '/oauth/start', 'POST', { id: 'ghost' })).status, 404)
  assert.equal((await call(h, '/oauth/start', 'POST', {})).status, 400)
})

test('start: 重复 → 409（in-flight 唯一性）', async () => {
  const id = nextId()
  const s = sandbox(id)
  const h = makeHarness(s, id, { id, config: { url: 'https://demo.example.com/mcp', headers: {} } })
  assert.equal((await startWith(h, id, async () => ({ status: 401 }))).status, 200)
  const second = await call(h, '/oauth/start', 'POST', { id })
  assert.equal(second.status, 409, '已 in-flight 应 409')
  await call(h, '/oauth/cancel', 'POST', { id })
})

// ── state 三重校验（前置 2） ──
test('三重校验①: state 不匹配 → 400 且不写 token / 不清 pending', async () => {
  const id = nextId()
  const s = sandbox(id)
  const h = makeHarness(s, id, { id, config: { url: 'https://demo.example.com/mcp', headers: {} } })
  await startWith(h, id, async () => ({ status: 401 }))
  const stored = authStore.getOAuthState(s.authPath, id)
  assert.equal(typeof stored, 'string')
  const wrong = stored === 'a'.repeat(64) ? 'b'.repeat(64) : 'a'.repeat(64)
  const res = await fetch(`http://127.0.0.1:${portOf(id)}/mcp/oauth/callback?code=x&state=${wrong}`)
  assert.equal(res.status, 400, 'state 不匹配应 400, 得到 ' + res.status)
  assert.equal(authStore.getTokens(s.authPath, id), undefined, '不得写 token')
  assert.ok(authStore.getOAuthState(s.authPath, id), 'state 不匹配不应清 pending')
  await call(h, '/oauth/cancel', 'POST', { id })
})

test('三重校验②: pending 过期 → 400 且 purge', async () => {
  const id = nextId()
  const s = sandbox(id)
  const h = makeHarness(s, id, { id, config: { url: 'https://demo.example.com/mcp', headers: {} } })
  await startWith(h, id, async () => ({ status: 401 }))
  const st = authStore.getOAuthState(s.authPath, id)
  const raw = JSON.parse(readFileSync(s.authPath, 'utf8'))
  raw[id].pendingAt = Math.floor(Date.now() / 1000) - 700   // > PENDING_MAX_AGE_MS(600s)
  writeFileSync(s.authPath, JSON.stringify(raw))
  const res = await fetch(`http://127.0.0.1:${portOf(id)}/mcp/oauth/callback?code=x&state=${st}`)
  assert.equal(res.status, 400, '过期 pending 应 400, 得到 ' + res.status)
  const after = authStore.getEntry(s.authPath, id)
  assert.equal(after?.codeVerifier, undefined, '过期 pending 应被 purge')
  assert.equal(after?.oauthState, undefined, '过期 pending 应被 purge')
  await call(h, '/oauth/cancel', 'POST', { id })
})

test('三重校验③: 重放 → 400 且不换出第二个 token', async () => {
  const id = nextId()
  const s = sandbox(id)
  const h = makeHarness(s, id, { id, config: { url: 'https://demo.example.com/mcp', headers: {} } })
  await startWith(h, id, async () => ({ status: 401 }))
  const port = portOf(id)
  const st = authStore.getOAuthState(s.authPath, id)
  // 第一次: 换 token 必失败(demo.example.com 无真 token 端点) → 400 + 清 pending + 关 in-flight
  const r1 = await fetch(`http://127.0.0.1:${port}/mcp/oauth/callback?code=x&state=${st}`)
  assert.equal(r1.status, 400, '换 token 失败应 400, 得到 ' + r1.status)
  assert.equal(authStore.getOAuthState(s.authPath, id), undefined, '失败后 pending 应清')
  assert.equal(mod.__internals.inflight.has(id), false, '失败后 in-flight 应关')
  // 第二次(重放): in-flight 已关 → server 端口已关闭(连接被拒), 或收到 410 友好页。
  // 两种都证明 state 不可再次换 token。
  let refused = false
  let secondStatus = null
  let secondText = ''
  try {
    const r2 = await fetch(`http://127.0.0.1:${port}/mcp/oauth/callback?code=x&state=${st}`)
    secondStatus = r2.status
    secondText = await r2.text()
  } catch {
    refused = true
  }
  assert.ok(refused || secondStatus === 410 || secondStatus === 400,
    `重放应被拒(连接拒绝/410/400), 得到 refused=${refused} status=${secondStatus}`)
  assert.ok(refused || !secondText.includes('授权成功'), '重放不得提示成功')
  assert.equal(authStore.getTokens(s.authPath, id), undefined, '重放不得产生 token')
})

test('回调缺 code → 400', async () => {
  const id = nextId()
  const s = sandbox(id)
  const h = makeHarness(s, id, { id, config: { url: 'https://demo.example.com/mcp', headers: {} } })
  await startWith(h, id, async () => ({ status: 401 }))
  const st = authStore.getOAuthState(s.authPath, id)
  const res = await fetch(`http://127.0.0.1:${portOf(id)}/mcp/oauth/callback?state=${st}`)
  assert.equal(res.status, 400, '缺 code 应 400')
  await call(h, '/oauth/cancel', 'POST', { id })
})

test('回调 path 不对 → 404', async () => {
  const id = nextId()
  const s = sandbox(id)
  const h = makeHarness(s, id, { id, config: { url: 'https://demo.example.com/mcp', headers: {} } })
  await startWith(h, id, async () => ({ status: 401 }))
  const res = await fetch(`http://127.0.0.1:${portOf(id)}/nope`)
  assert.equal(res.status, 404)
  await call(h, '/oauth/cancel', 'POST', { id })
})

test('回调: 换 token 成功路径 → 200 + tokens 落盘 + pending 清', async () => {
  const id = nextId()
  const s = sandbox(id)
  const h = makeHarness(s, id, { id, config: { url: 'https://demo.example.com/mcp', headers: {} } })
  await startWith(h, id, async () => ({ status: 401 }))
  const port = portOf(id)
  const st = authStore.getOAuthState(s.authPath, id)
  // 只 mock /token 端点，放行 loopback 回调（否则 fetch 假注入会把回调自己拦掉）
  const realFetch = globalThis.fetch
  let tokenCalls = 0
  globalThis.fetch = async (url, opts) => {
    if (String(url).endsWith('/token')) {
      tokenCalls++
      return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'AT_OK', refresh_token: 'RT_OK', expires_in: 3600, token_type: 'Bearer', scope: 'user:read' }) }
    }
    return realFetch(url, opts)
  }
  try {
    const res = await fetch(`http://127.0.0.1:${port}/mcp/oauth/callback?code=goodcode&state=${st}`)
    assert.equal(res.status, 200, '成功路径应 200, 得到 ' + res.status + ' ' + (await res.clone().text()).slice(0, 80))
    const html = await res.text()
    assert.ok(html.includes('授权成功'), '应提示授权成功: ' + html.slice(0, 60))
  } finally { globalThis.fetch = realFetch }
  assert.equal(tokenCalls, 1, '应正好打一次 token 端点')
  const toks = authStore.getTokens(s.authPath, id)
  assert.equal(toks.accessToken, 'AT_OK', 'token 应落盘')
  assert.equal(toks.refreshToken, 'RT_OK')
  assert.equal(authStore.getOAuthState(s.authPath, id), undefined, '成功后 pending 应清')
  assert.equal(mod.__internals.inflight.has(id), false, '成功后 in-flight 应关')
})

// ── finish / cancel ──
test('finish: 幂等清 pending(无 pending 也 200)', async () => {
  const id = nextId()
  const s = sandbox(id)
  const h = makeHarness(s, id, { id, config: { url: 'https://demo.example.com/mcp', headers: {} } })
  const r0 = await call(h, '/oauth/finish', 'POST', { id })
  assert.equal(r0.status, 200)
  assert.equal(r0.json.status, 'ok')
  assert.equal(r0.json.cleared, false, '无 pending 时 cleared=false 但仍是 200')
  await startWith(h, id, async () => ({ status: 401 }))
  assert.ok(authStore.getOAuthState(s.authPath, id))
  const r1 = await call(h, '/oauth/finish', 'POST', { id })
  assert.equal(r1.json.cleared, true)
  assert.equal(authStore.getOAuthState(s.authPath, id), undefined, 'finish 应清 pending')
})

test('cancel: 清 pending + 关 server + 可重新 start', async () => {
  const id = nextId()
  const s = sandbox(id)
  const h = makeHarness(s, id, { id, config: { url: 'https://demo.example.com/mcp', headers: {} } })
  await startWith(h, id, async () => ({ status: 401 }))
  const c = await call(h, '/oauth/cancel', 'POST', { id })
  assert.equal(c.status, 200)
  assert.equal(authStore.getOAuthState(s.authPath, id), undefined)
  assert.equal(mod.__internals.inflight.has(id), false, 'cancel 应关掉 in-flight')
  const again = await startWith(h, id, async () => ({ status: 401 }))
  assert.equal(again.status, 200, 'cancel 后应能重新 start')
  await call(h, '/oauth/cancel', 'POST', { id })
})

// ── 脱敏 ──
test('脱敏: 回调响应体与 warn 不含 code/verifier/token', async () => {
  const id = nextId()
  const s = sandbox(id)
  const h = makeHarness(s, id, { id, config: { url: 'https://demo.example.com/mcp', headers: {} } })
  await startWith(h, id, async () => ({ status: 401 }))
  const port = portOf(id)
  const st = authStore.getOAuthState(s.authPath, id)
  const cv = authStore.getCodeVerifier(s.authPath, id)
  const res = await fetch(`http://127.0.0.1:${port}/mcp/oauth/callback?code=SECRETCODE123&state=${st}`)
  const text = await res.text()
  assert.ok(!text.includes('SECRETCODE123'), '回调响应不得含 code')
  assert.ok(!text.includes(cv), '回调响应不得含 verifier')
  for (const w of h.warns) {
    assert.ok(!w.includes('SECRETCODE123') && !w.includes(cv), '日志不得含 code/verifier: ' + w)
  }
  await call(h, '/oauth/cancel', 'POST', { id })
})

test('pure helpers: buildAuthorizeUrl / normalizeToken', () => {
  const u = mod.buildAuthorizeUrl('https://mcp.cloudflare.com/mcp', {
    clientId: 'CID', redirectUri: 'http://127.0.0.1:1234/mcp/oauth/callback',
    codeChallenge: 'CH', codeChallengeMethod: 'S256', state: 'ST', scope: 'user:read',
  })
  const p = new URL(u)
  assert.equal(p.origin, 'https://mcp.cloudflare.com')
  assert.equal(p.pathname, '/authorize', '端点应为 /authorize(实测无 /oauth 前缀)')
  assert.equal(p.searchParams.get('client_id'), 'CID')
  assert.equal(p.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(p.searchParams.get('state'), 'ST')
  const t = mod.normalizeToken({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600, scope: 's' })
  assert.equal(t.access_token, 'AT')
  assert.equal(t.expires_in, 3600)
  assert.equal(t.token_type, 'Bearer')
})

// ── 审计 M3 回归: 探测必须用 rawHeaders(未 mask), 不能用 config.headers ──
test('M3: 探测用 rawHeaders 原值, mask 后的 config.headers 不影响 already-works 判定', async () => {
  const id = nextId()
  const s = sandbox(id)
  // 模拟 readMcpRows 的真实输出: config.headers 被 mask 成 '•••',
  // 真值只在 rawHeaders 里。带静态 Token 的行应被判 already-works。
  const row = {
    id,
    config: { url: 'https://demo.example.com/mcp', headers: { Authorization: '•••' } },
    rawHeaders: { Authorization: 'Bearer REAL-TOKEN' },
  }
  const h = makeHarness(s, id, row)
  let seenHeaders = null
  const r = await startWith(h, id, async (url, opts) => {
    seenHeaders = opts?.headers
    return { status: 200 }
  })
  assert.equal(r.json.status, 'already-works',
    'M3: 带静态 Token 的行必须能判出 already-works, 不得被迫走 OAuth')
  assert.equal(seenHeaders?.['Authorization'], 'Bearer REAL-TOKEN',
    'M3: 探测请求必须携带未 mask 的原值(不是 •••)')
})

test('M3: 无 rawHeaders 时退回 config.headers(向后兼容)', async () => {
  const id = nextId()
  const s = sandbox(id)
  const h = makeHarness(s, id, { id, config: { url: 'https://demo.example.com/mcp', headers: { 'X-Key': 'plain' } } })
  let seenHeaders = null
  const r = await startWith(h, id, async (url, opts) => {
    seenHeaders = opts?.headers
    return { status: 200 }
  })
  assert.equal(r.json.status, 'already-works')
  assert.equal(seenHeaders?.['X-Key'], 'plain', 'M3: 无 rawHeaders 时退回 config.headers')
})

// ── needsAuth 探测（学 opencode MCPStatus 口径）──
// 用户反馈「所有 MCP 都挂授权按钮很莫名」→ 授权入口改为「要授权的才显示」。
async function statusWith(h, id, fetchImpl) {
  const realFetch = globalThis.fetch
  if (fetchImpl) globalThis.fetch = fetchImpl
  try {
    return await call(h, '/oauth/status?id=' + encodeURIComponent(id), 'GET')
  } finally {
    if (fetchImpl) globalThis.fetch = realFetch
  }
}

test('needsAuth: 探测得 401 → needsAuth=true（真的需要授权）', async () => {
  const id = nextId()
  const s = sandbox(id)
  const h = makeHarness(s, id, { id, config: { url: 'https://demo.example.com/mcp', headers: {} }, rawHeaders: {} })
  const r = await statusWith(h, id, async () => ({ status: 401 }))
  assert.equal(r.json.needsAuth, true, '401 应判 needsAuth=true')
})

test('needsAuth: 探测得 2xx → needsAuth=false（静态 Token 已够用）', async () => {
  const id = nextId()
  const s = sandbox(id)
  const h = makeHarness(s, id, { id, config: { url: 'https://demo.example.com/mcp', headers: { Authorization: 'Bearer X' } }, rawHeaders: { Authorization: 'Bearer X' } })
  const r = await statusWith(h, id, async () => ({ status: 200 }))
  assert.equal(r.json.needsAuth, false, '2xx 应判 needsAuth=false')
})

test('needsAuth: 探测得 403 → needsAuth=false（服务端明确拒绝, 非 OAuth 需求）', async () => {
  const id = nextId()
  const s = sandbox(id)
  const h = makeHarness(s, id, { id, config: { url: 'https://demo.example.com/mcp', headers: {} }, rawHeaders: {} })
  const r = await statusWith(h, id, async () => ({ status: 403 }))
  assert.equal(r.json.needsAuth, false, '403 应判 false')
  assert.equal(r.json.probeFailed, false)
})

test("needsAuth: 探测不可达(超时) → 'unknown' + probeFailed=true(不猜但也不隐藏)", async () => {
  const id = nextId()
  const s = sandbox(id)
  const h = makeHarness(s, id, { id, config: { url: 'https://demo.example.com/mcp', headers: {} }, rawHeaders: {} })
  const r = await statusWith(h, id, async () => { throw new Error('timeout') })
  // 用户场景: cloudflare.com 在本机网络不可达 → 探测 unreachable。
  // 静默判 false 会让授权入口永不出现, 用户想授权也无从下手。
  assert.equal(r.json.needsAuth, 'unknown', '不可达应判 unknown(不猜)')
  assert.equal(r.json.probeFailed, true, 'probeFailed 应为 true(供 UI 标注)')
})

test('needsAuth: store 已有 token → needsAuth=false（省一次探测）', async () => {
  const id = nextId()
  const s = sandbox(id)
  const h = makeHarness(s, id, { id, config: { url: 'https://demo.example.com/mcp', headers: {} }, rawHeaders: {} })
  // 先存 token
  authStore.setTokens(s.authPath, id, { accessToken: 'AT' })
  let probed = false
  const r = await statusWith(h, id, async () => { probed = true; return { status: 401 } })
  assert.equal(r.json.needsAuth, false, '已有 token 应判 false')
  assert.equal(probed, false, '已有 token 时不应再探测上游')
})

test('needsAuth: 60s TTL 缓存生效（UI 10s 轮询不打爆上游）', async () => {
  const id = nextId()
  const s = sandbox(id)
  const h = makeHarness(s, id, { id, config: { url: 'https://demo.example.com/mcp', headers: {} }, rawHeaders: {} })
  let n = 0
  const stub = async () => { n++; return { status: 401 } }
  const r1 = await statusWith(h, id, stub)
  const r2 = await statusWith(h, id, stub)
  assert.equal(r1.json.needsAuth, true)
  assert.equal(r2.json.needsAuth, true)
  assert.equal(n, 1, `TTL 内第二次应命中缓存, 实际探测 ${n} 次`)
})

test('needsAuth: status=authenticated/pending 时短路 false（不探测）', async () => {
  const id = nextId()
  const s = sandbox(id)
  const h = makeHarness(s, id, { id, config: { url: 'https://demo.example.com/mcp', headers: {} }, rawHeaders: {} })
  authStore.setTokens(s.authPath, id, { accessToken: 'AT', expires_in: 3600 })
  let probed = false
  const r = await statusWith(h, id, async () => { probed = true; return { status: 401 } })
  assert.equal(r.json.status, 'authenticated')
  assert.equal(r.json.needsAuth, false)
  assert.equal(probed, false, '已授权行不得探测上游')
})
