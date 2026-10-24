/**
 * OAuth fixture 回归测试 —— 用真实 HTTP 服务器(fixtures/oauth-test-mcp.mjs)
 * 验证 Hub 的 OAuth 客户端侧全链路。
 *
 * 为什么不用 mock fetch: 2026-10-22 抓到的 P0(authUrl 缺 client_id)正是
 * mock 抓不到的类型 —— 单测 `buildAuthorizeUrl` 永远绿, 只有真打一个
 * 要求 client_id 的授权服务器才暴露。故本测试起真实 HTTP。
 *
 * 覆盖(与 Cloudflare 协议同构):
 *   1. DCR /register → client_id 落盘
 *   2. registerClient 幂等(第二次不发 /register)
 *   3. /authorize 缺 PKCE challenge → 400
 *   4. 授权(approve) → 302 带 code
 *   5. /token PKCE 校验失败 → invalid_grant
 *   6. /token 正确 → access + refresh token
 *   7. code 一次性(重放 → invalid_grant)
 *   8. refresh 轮换(旧 at 作废, 旧 rt 一次性)
 *   9. MCP 无 token → 401 + www-authenticate
 *  10. MCP 假 token → 401
 *  11. MCP 持真 token → tools/call add = a+b
 *  12. redirect_uri 不匹配 → invalid_grant
 *  13. 拒绝授权(deny) → 302 error=access_denied
 *  14. Hub provider 端到端: getAuthProvider → tokens() → 调 MCP
 *
 * 运行: node --test test-oauth-fixture.mjs
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomBytes } from 'node:crypto'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(HERE, 'fixtures', 'oauth-test-mcp.mjs')
const HUB = join(HERE, 'lib', 'oauth-provider.js')

// ── fixture 服务器生命周期(整个 test 文件共享一个实例) ──
let BASE = ''
let serverProc = null
const tmpdirs = []

test.before(async () => {
  // PORT=0 → OS 分配空闲端口, 彻底消除端口冲突
  // (2026-10-22 曾用随机端口 20000-40000, 造成一次未能取证的失败)
  serverProc = spawn(process.execPath, [FIXTURE], {
    env: { ...process.env, PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  // fixture 就绪后把实际端口写到 stdout(__LISTENING__ <port>)
  const actualPort = await new Promise((resolve, reject) => {
    let buf = ''
    const timer = setTimeout(() => reject(new Error('fixture 未在 5s 内报告监听端口')), 5000)
    serverProc.stdout.on('data', (d) => {
      buf += d.toString()
      const m = buf.match(/__LISTENING__ (\d+)/)
      if (m) { clearTimeout(timer); resolve(Number(m[1])) }
    })
    serverProc.on('exit', (code) => { clearTimeout(timer); reject(new Error('fixture 提前退出 code=' + code)) })
  })
  BASE = `http://127.0.0.1:${actualPort}`
})

test.after(() => {
  if (serverProc) { try { serverProc.kill('SIGKILL') } catch { /* already dead */ } }
  for (const d of tmpdirs) { try { rmSync(d, { recursive: true, force: true }) } catch { /* best effort */ } }
})

const reset = async () => {
  await fetch(`${BASE}/__reset`, { method: 'POST' })
}

const get = async (path) => {
  const r = await fetch(BASE + path, { redirect: 'manual' })
  return { status: r.status, location: r.headers.get('location'), headers: r.headers }
}

const post = async (path, body, headers = {}) => {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(body).toString(),
    redirect: 'manual',
  })
  let json = null
  try { json = await r.json() } catch { /* non-json */ }
  return { status: r.status, json, headers: r.headers }
}

const mcpCall = async (method, params, token) => {
  const r = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) }),
  })
  return { status: r.status, wwwAuth: r.headers.get('www-authenticate'), json: await r.json() }
}

const b64url = (b) => Buffer.from(b).toString('base64url')
const challengeOf = (verifier) => b64url(createHash('sha256').update(verifier).digest())

/** 走完一次完整授权, 返回 token 响应。 */
async function fullAuthorize({ scope = 'user:read account:read offline_access', redirectUri } = {}) {
  await reset()
  // 1. DCR
  const reg = await fetch(`${BASE}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'fixture-test',
      redirect_uris: [redirectUri || 'http://127.0.0.1:0/mcp/oauth/callback'],
      token_endpoint_auth_method: 'none',
    }),
  }).then((r) => r.json())
  // 2. authorize(approve)
  const verifier = b64url(randomBytes(32))
  const state = b64url(randomBytes(16))
  const redir = redirectUri || 'http://127.0.0.1:12345/mcp/oauth/callback'
  const q = new URLSearchParams({
    client_id: reg.client_id,
    response_type: 'code',
    redirect_uri: redir,
    code_challenge: challengeOf(verifier),
    code_challenge_method: 'S256',
    state,
    scope,
    __act: 'approve',
  })
  const auth = await get(`/authorize?${q}`)
  assert.equal(auth.status, 302, 'authorize approve 应 302')
  const cb = new URL(auth.location)
  const code = cb.searchParams.get('code')
  assert.ok(code, '回调应带 code')
  assert.equal(cb.searchParams.get('state'), state, '回调 state 应原样带回')
  // 3. token
  const tok = await post('/token', {
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    redirect_uri: redir,
    client_id: reg.client_id,
  })
  return { reg, verifier, state, code, redir, tok }
}

// ══════════════════ DCR ══════════════════

test('DCR: POST /register 签 client_id 且 secret 永不过期', async () => {
  const r = await fetch(`${BASE}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 't', redirect_uris: ['http://127.0.0.1:0/cb'] }),
  }).then((x) => x.json())
  assert.match(r.client_id, /^test-client-/, 'client_id 应有前缀')
  assert.ok(r.client_secret, '应返 client_secret')
  assert.equal(r.client_secret_expires_at, 0, 'Cloudflare 语义: 0 = 永不过期')
})

// ══════════════════ authorize ══════════════════

test('authorize: 缺 code_challenge → 400(PKCE 必需)', async () => {
  const r = await get('/authorize?client_id=c&response_type=code&redirect_uri=http://127.0.0.1:9999/cb&state=s&code_challenge_method=S256')
  assert.equal(r.status, 400)
})

test('authorize: code_challenge_method 非 S256 → 400', async () => {
  const r = await get('/authorize?client_id=c&response_type=code&redirect_uri=http://127.0.0.1:9999/cb&state=s&code_challenge=x&code_challenge_method=plain')
  assert.equal(r.status, 400)
})

test('authorize: approve → 302 带 code + state', async () => {
  const { code, state } = await fullAuthorize()
  assert.ok(code && state)
})

test('authorize: deny → 302 error=access_denied', async () => {
  await reset()
  const reg = await fetch(`${BASE}/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 't', redirect_uris: ['http://127.0.0.1:12345/cb'] }),
  }).then((r) => r.json())
  const q = new URLSearchParams({
    client_id: reg.client_id, response_type: 'code',
    redirect_uri: 'http://127.0.0.1:12345/cb',
    code_challenge: challengeOf(b64url(randomBytes(32))),
    code_challenge_method: 'S256', state: 'st', __act: 'deny',
  })
  const r = await get(`/authorize?${q}`)
  assert.equal(r.status, 302)
  const cb = new URL(r.location)
  assert.equal(cb.searchParams.get('error'), 'access_denied')
})

// ══════════════════ token ══════════════════

test('token: 正确 PKCE → access + refresh + scope', async () => {
  const { tok } = await fullAuthorize()
  assert.equal(tok.status, 200)
  assert.match(tok.json.access_token, /^at_/)
  assert.match(tok.json.refresh_token, /^rt_/)
  assert.equal(tok.json.token_type, 'Bearer')
  assert.ok(tok.json.expires_in > 0)
  assert.equal(tok.json.scope, 'user:read account:read offline_access')
})

test('token: PKCE 校验失败(错 verifier) → invalid_grant', async () => {
  await reset()
  const reg = await fetch(`${BASE}/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 't', redirect_uris: ['http://127.0.0.1:12345/cb'] }),
  }).then((r) => r.json())
  const redir = 'http://127.0.0.1:12345/mcp/oauth/callback'
  const q = new URLSearchParams({
    client_id: reg.client_id, response_type: 'code', redirect_uri: redir,
    code_challenge: challengeOf('correct-verifier'), code_challenge_method: 'S256',
    state: 's', __act: 'approve',
  })
  const cb = new URL((await get(`/authorize?${q}`)).location)
  const r = await post('/token', {
    grant_type: 'authorization_code',
    code: cb.searchParams.get('code'),
    code_verifier: 'WRONG-verifier',   // 错的
    redirect_uri: redir, client_id: reg.client_id,
  })
  assert.equal(r.status, 400)
  assert.equal(r.json.error, 'invalid_grant')
})

test('token: redirect_uri 不匹配 → invalid_grant(Cloudflare 实测同行为)', async () => {
  const { code, tok } = await fullAuthorize({ redirectUri: 'http://127.0.0.1:12345/mcp/oauth/callback' })
  // 用同一个 code 但换 redirect_uri
  const reg = await fetch(`${BASE}/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 't', redirect_uris: ['http://127.0.0.1:12345/mcp/oauth/callback'] }),
  }).then((r) => r.json())
  void reg; void tok
  const redir = 'http://127.0.0.1:12345/mcp/oauth/callback'
  // 重新拿一个 code(上面那个已被消费)
  const verifier = b64url(randomBytes(32))
  const q = new URLSearchParams({
    client_id: (await fullAuthorize({ redirectUri: redir })).reg.client_id,
    response_type: 'code', redirect_uri: redir,
    code_challenge: challengeOf(verifier), code_challenge_method: 'S256',
    state: 's2', __act: 'approve',
  })
  void code
  const cb = new URL((await get(`/authorize?${q}`)).location)
  const r = await post('/token', {
    grant_type: 'authorization_code',
    code: cb.searchParams.get('code'),
    code_verifier: verifier,
    redirect_uri: 'http://127.0.0.1:9999/DIFFERENT',   // 不匹配
  })
  assert.equal(r.status, 400)
  assert.equal(r.json.error, 'invalid_grant')
})

test('token: code 一次性(重放 → invalid_grant)', async () => {
  // 自己拿一个未消费的 code(fullAuthorize 内部已消费掉它生成的那个)
  await reset()
  const reg = await fetch(`${BASE}/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 't', redirect_uris: ['http://127.0.0.1:12345/mcp/oauth/callback'] }),
  }).then((r) => r.json())
  const redir = 'http://127.0.0.1:12345/mcp/oauth/callback'
  const verifier = b64url(randomBytes(32))
  const q = new URLSearchParams({
    client_id: reg.client_id, response_type: 'code', redirect_uri: redir,
    code_challenge: challengeOf(verifier), code_challenge_method: 'S256',
    state: 's', __act: 'approve',
  })
  const code = new URL((await get(`/authorize?${q}`)).location).searchParams.get('code')
  const body = {
    grant_type: 'authorization_code', code,
    code_verifier: verifier, redirect_uri: redir, client_id: reg.client_id,
  }
  const first = await post('/token', body)
  assert.equal(first.status, 200, '首次应成功')
  const replay = await post('/token', body)
  assert.equal(replay.status, 400, '重放应失败')
  assert.equal(replay.json.error, 'invalid_grant')
})

// ══════════════════ refresh 轮换 ══════════════════

test('refresh: 轮换签发新 at/rt, 旧 at 作废, 旧 rt 一次性', async () => {
  const { tok, reg } = await fullAuthorize()
  const oldAt = tok.json.access_token
  const oldRt = tok.json.refresh_token
  const r = await post('/token', { grant_type: 'refresh_token', refresh_token: oldRt, client_id: reg.client_id })
  assert.equal(r.status, 200)
  assert.notEqual(r.json.access_token, oldAt, 'access_token 应轮换')
  assert.notEqual(r.json.refresh_token, oldRt, 'refresh_token 应轮换')
  // 旧 at 作废
  const oldAtCall = await mcpCall('tools/list', null, oldAt)
  assert.equal(oldAtCall.status, 401, '旧 access_token 应已作废')
  // 旧 rt 一次性
  const oldRtAgain = await post('/token', { grant_type: 'refresh_token', refresh_token: oldRt, client_id: reg.client_id })
  assert.equal(oldRtAgain.status, 400, '旧 refresh_token 应已作废')
})

// ══════════════════ MCP 鉴权 ══════════════════

test('MCP: 无 token → 401 + www-authenticate 带 resource_metadata', async () => {
  const r = await mcpCall('tools/list')
  assert.equal(r.status, 401)
  assert.match(r.wwwAuth || '', /^Bearer /)
  assert.match(r.wwwAuth || '', /resource_metadata=/)
})

test('MCP: 假 token → 401', async () => {
  const r = await mcpCall('tools/list', null, 'at_bogus_token')
  assert.equal(r.status, 401)
})

test('MCP: 持真 token → initialize + tools/list + tools/call', async () => {
  const { tok } = await fullAuthorize()
  const at = tok.json.access_token
  const init = await mcpCall('initialize', {
    protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' },
  }, at)
  assert.equal(init.status, 200)
  assert.equal(init.json.result.serverInfo.name, 'oauth-test-mcp')
  const list = await mcpCall('tools/list', null, at)
  assert.equal(list.status, 200)
  assert.equal(list.json.result.tools.length, 2)
  const call = await mcpCall('tools/call', { name: 'add', arguments: { a: 7, b: 8 } }, at)
  assert.equal(call.status, 200)
  assert.equal(call.json.result.content[0].text, '15', 'add(7,8) 应得 15')
})

test('MCP: whoami 返回授权时的 scope(证明 scope 透传到资源服务器)', async () => {
  const { tok } = await fullAuthorize({ scope: 'user:read account:read' })
  const r = await mcpCall('tools/call', { name: 'whoami', arguments: {} }, tok.json.access_token)
  assert.equal(r.status, 200)
  const who = JSON.parse(r.json.result.content[0].text)
  assert.equal(who.scope, 'user:read account:read')
})

// ══════════════════ Hub provider 端到端 ══════════════════

test('Hub provider 端到端: getAuthProvider → tokens() → 调 MCP 得结果', async () => {
  const { mod } = await import(HUB).then((m) => ({ mod: m })).catch(() => ({ mod: null }))
  assert.ok(mod, 'lib/oauth-provider.js 应可 import')

  const dir = mkdtempSync('/data/data/com.termux/files/usr/tmp/opencode/fx-')
  tmpdirs.push(dir)
  const authPath = join(dir, 'mcp-auth.json')

  const prov = mod.createAuthProvider({
    name: 'fx-e2e',
    serverUrl: `${BASE}/mcp`,
    filePath: authPath,
  })

  // 1. DCR(真打 fixture 的 /register)
  const reg = await prov.registerClient()
  assert.match(reg.client_id, /^test-client-/, 'provider DCR 应成功')
  // 2. 幂等: 第二次不再注册
  const callsBefore = (await (await fetch(`${BASE}/__state`)).json()).dcrClients.length
  await prov.registerClient()
  const callsAfter = (await (await fetch(`${BASE}/__state`)).json()).dcrClients.length
  assert.equal(callsAfter, callsBefore, 'registerClient 应幂等')

  // 3. 走完授权, 手工把 token 存进 provider 的 store
  //    (provider 的 saveTokens 是 SDK 回调, 这里直接模拟换 token 成功后的落盘)
  const verifier = b64url(randomBytes(32))
  const state = b64url(randomBytes(16))
  prov.setRedirectUrl('http://127.0.0.1:7777/mcp/oauth/callback')
  prov.saveCodeVerifier(verifier)
  prov.state()
  const q = new URLSearchParams({
    client_id: reg.client_id, response_type: 'code',
    redirect_uri: 'http://127.0.0.1:7777/mcp/oauth/callback',
    code_challenge: challengeOf(verifier), code_challenge_method: 'S256',
    state, scope: prov.clientMetadata.scope, __act: 'approve',
  })
  const cb = new URL((await get(`/authorize?${q}`)).location)
  const tok = await post('/token', {
    grant_type: 'authorization_code',
    code: cb.searchParams.get('code'),
    code_verifier: verifier,
    redirect_uri: 'http://127.0.0.1:7777/mcp/oauth/callback',
    client_id: reg.client_id,
  })
  assert.equal(tok.status, 200)
  prov.saveTokens(tok.json)

  // 4. 读回并调 MCP
  const saved = prov.tokens()
  assert.equal(saved.access_token, tok.json.access_token)
  const r = await mcpCall('tools/call', { name: 'add', arguments: { a: 20, b: 22 } }, saved.access_token)
  assert.equal(r.status, 200)
  assert.equal(r.json.result.content[0].text, '42', 'add(20,22) 应得 42')
})
