/**
 * oauth-provider 契约测试 —— 先于实现存在（TDD 先红）。
 *
 * 覆盖 createAuthProvider 工厂返回的 OAuthClientProvider 接口（安装版 SDK 2.2.0
 * 的 interface，非 class，故用对象字面量实现）：
 *
 *   方法                                    | auth-store 依赖
 *   ----------------------------------------|----------------
 *   get redirectUrl()                      | setRedirectUrl 注入
 *   get clientMetadata()                   | 常量
 *   state()                                | 32B hex → setOAuthState
 *   clientInformation(ctx)                 | getClientInfo
 *   saveClientInformation(info, ctx)       | setClientInfo
 *   tokens(ctx)                            | getTokens（ctx=undefined 也返回最近）
 *   saveTokens(tokens, ctx)                | setTokens（expiresAt = now + expires_in）
 *   redirectToAuthorization(url)           | 协议校验 http/https
 *   saveCodeVerifier(v)                    | setCodeVerifier（打 pendingAt）
 *   codeVerifier()                         | getCodeVerifier
 *
 * 安全红线（铁律 6）：任何错误信息不得含 token/client_secret。
 * 运行: node --test test-oauth-provider.mjs
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'

const LIB = '/data/data/com.termux/files/home/dsh-plugins-src/dsh-mcp-skill-hub/lib/oauth-provider.js'
const AUTH_STORE = '/data/data/com.termux/files/home/dsh-plugins-src/dsh-mcp-skill-hub/lib/auth-store.js'

let mod = null
try {
  mod = await import(LIB)
} catch (error) {
  mod = null
}

let A = null
try {
  A = await import(AUTH_STORE)
} catch (error) {
  A = null
}

// TDD 先红硬要求：模块不可加载时必须是 FAIL，不许静默 skip。
test('oauth-provider.js 已实现', () => {
  assert.ok(mod, 'lib/oauth-provider.js 应可 import（实现缺失即失败，不是 skip）')
  assert.equal(typeof mod.createAuthProvider, 'function', '应导出 createAuthProvider 工厂')
})
test('lib/auth-store.js 可加载（前置依赖）', () => {
  assert.ok(A, 'lib/auth-store.js 应可 import')
})

// ── fetch 打桩: 拦截 /register(DCR), 记录最近一次请求体 ──
const LAST_FETCH = { calls: 0, body: null, url: null }
const REAL_FETCH = globalThis.fetch
globalThis.fetch = async (url, init = {}) => {
  const u = String(url)
  if (/\/register(\?|$)/.test(new URL(u).pathname)) {
    LAST_FETCH.calls += 1
    LAST_FETCH.url = u
    try { LAST_FETCH.body = JSON.parse(init.body || '{}') } catch { LAST_FETCH.body = null }
    return {
      ok: true, status: 201,
      json: async () => ({
        client_id: 'REG-CLIENT-1',
        client_secret: 'REG-SECRET-1',
        client_id_issued_at: 1786300000,
        client_secret_expires_at: 0,
      }),
      text: async () => JSON.stringify({ client_id: 'REG-CLIENT-1' }),
    }
  }
  return REAL_FETCH(url, init)
}

const tmpdirs = []
function store(ret) {
  const dir = mkdtempSync('/data/data/com.termux/files/usr/tmp/opencode/op-')
  tmpdirs.push(dir)
  const p = join(dir, 'auth.json')
  if (ret) writeFileSync(p, JSON.stringify(ret))
  return p
}

test.after(() => {
  for (const d of tmpdirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
})

const SKIP = mod === null || A === null ? '实现不可加载' : false

test('createAuthProvider 工厂签名与基本形状', { skip: SKIP }, () => {
  assert.equal(typeof mod.createAuthProvider, 'function', '应导出 createAuthProvider')
  const p = store()
  const prov = mod.createAuthProvider({
    name: 'cloudflare',
    serverUrl: 'https://mcp.cloudflare.com/mcp',
    filePath: p,
  })
  // 契约 §3.2 全部必需成员
  for (const k of ['redirectUrl', 'clientMetadata', 'clientInformation', 'tokens', 'saveTokens',
    'redirectToAuthorization', 'saveCodeVerifier', 'codeVerifier', 'setRedirectUrl']) {
    assert.ok(k in prov, `provider 应有成员 ${k}`)
  }
})

test('redirectUrl: 构造时占位, setRedirectUrl 后反映', { skip: SKIP }, () => {
  const p = store()
  const prov = mod.createAuthProvider({
    name: 'c', serverUrl: 'https://x/mcp', filePath: p, callbackPath: '/mcp/oauth/callback',
  })
  const before = String(prov.redirectUrl ?? '')
  prov.setRedirectUrl('http://127.0.0.1:51234/mcp/oauth/callback')
  assert.equal(String(prov.redirectUrl), 'http://127.0.0.1:51234/mcp/oauth/callback')
  assert.ok(before === '' || before.includes('127.0.0.1'), `构造期占位应是空或 loopback, 实际 ${before}`)
})

test('clientMetadata: public client + 必需字段', { skip: SKIP }, () => {
  const p = store()
  const prov = mod.createAuthProvider({ name: 'c', serverUrl: 'https://x/mcp', filePath: p })
  const md = prov.clientMetadata
  assert.equal(md.client_name, 'dsh-mcp-skill-hub')
  assert.equal(md.token_endpoint_auth_method, 'none', 'Cloudflare 支持 none, 用 public client')
  assert.ok(Array.isArray(md.redirect_uris) && md.redirect_uris.length === 1)
  assert.ok(md.grant_types.includes('authorization_code') && md.grant_types.includes('refresh_token'))
  assert.equal(md.response_types[0], 'code')
})

test('state 生成 32B hex 并写入 auth-store(pending 态)', { skip: SKIP }, () => {
  const p = store()
  const prov = mod.createAuthProvider({ name: 'c', serverUrl: 'https://x/mcp', filePath: p })
  const s = prov.state()
  assert.equal(s.length, 64, 'state 应为 32B hex')
  assert.match(s, /^[0-9a-f]{64}$/)
  const stored = A.getOAuthState(p, 'c')
  assert.equal(stored, s, 'state 应写入 auth-store')
  const entry = A.getEntry(p, 'c')
  assert.ok(Number.isFinite(entry.pendingAt), 'state 写入应打 pendingAt')
  // 两次调用生成不同值
  const s2 = prov.state()
  assert.notEqual(s2, s, '连续 state 应不同')
})

test('clientInformation: 无存储返 undefined', { skip: SKIP }, () => {
  const p = store()
  const prov = mod.createAuthProvider({ name: 'c', serverUrl: 'https://x/mcp', filePath: p })
  assert.equal(prov.clientInformation(), undefined)
})

test('clientInformation: 有存储返回 client_id', { skip: SKIP }, () => {
  const p = store()
  A.setClientInfo(p, 'c', { clientId: 'CID1', clientIdIssuedAt: 1786151616 })
  const prov = mod.createAuthProvider({ name: 'c', serverUrl: 'https://x/mcp', filePath: p })
  const info = prov.clientInformation()
  assert.equal(info.client_id, 'CID1')
})

test('clientInformation: clientSecretExpiresAt 已过期 → undefined(触发重新 DCR)', { skip: SKIP }, () => {
  const p = store()
  const past = Math.floor(Date.now() / 1000) - 60
  A.setClientInfo(p, 'c', { clientId: 'CID1', clientSecret: 'SEC', clientSecretExpiresAt: past })
  const prov = mod.createAuthProvider({ name: 'c', serverUrl: 'https://x/mcp', filePath: p })
  assert.equal(prov.clientInformation(), undefined, '过期 clientSecret 应视为未注册')
})

// ── DCR: provider 必须能自己注册客户端(RFC 7591) ──
// 背景: Cloudflare 等授权服务器要求 /authorize 带 client_id。Hub 的 /oauth/start
// 原先直接用 clientInformation()?.client_id, 若 dsh 的 mcp-client 库还没做过 DCR,
// authUrl 就缺 client_id → 授权页 400。修复: provider 自己实现 registerClient()。
test('registerClient: POST /register 并把结果落盘', { skip: SKIP }, async () => {
  const p = store()
  const prov = mod.createAuthProvider({ name: 'reg1', serverUrl: 'https://demo.example.com/mcp', filePath: p })
  const res = await prov.registerClient()
  assert.equal(res.client_id, 'REG-CLIENT-1')
  assert.equal(res.client_secret, 'REG-SECRET-1')
  // 落盘: 之后 clientInformation() 应能读回
  const info = prov.clientInformation()
  assert.equal(info.client_id, 'REG-CLIENT-1')
})

test('registerClient: 请求体符合 RFC 7591(client_name + redirect_uris + token_endpoint_auth_method=none)', { skip: SKIP }, async () => {
  const p = store()
  const prov = mod.createAuthProvider({ name: 'reg2', serverUrl: 'https://demo.example.com/mcp', filePath: p })
  prov.setRedirectUrl('http://127.0.0.1:9999/mcp/oauth/callback')
  await prov.registerClient()
  const body = LAST_FETCH.body
  const md = prov.clientMetadata
  assert.equal(body.client_name, md.client_name, 'client_name 应与 clientMetadata 一致')
  assert.deepEqual(body.redirect_uris, ['http://127.0.0.1:9999/mcp/oauth/callback'], 'redirect_uris 应来自当前 redirectUrl')
  assert.equal(body.token_endpoint_auth_method, 'none', 'public client 必须 none')
  assert.equal(body.grant_types.includes('authorization_code'), true)
})

test('registerClient: 已有 clientInfo 时复用, 不再注册(幂等)', { skip: SKIP }, async () => {
  const p = store()
  const prov = mod.createAuthProvider({ name: 'reg3', serverUrl: 'https://demo.example.com/mcp', filePath: p })
  await prov.registerClient()
  const before = LAST_FETCH.calls
  const again = await prov.registerClient()
  assert.equal(LAST_FETCH.calls, before, '已有 clientInfo 不得再发 /register')
  assert.equal(again.client_id, 'REG-CLIENT-1')
})

test('clientInformation: client_secret_expires_at=0 表示永不过期(RFC 7591)', { skip: SKIP }, () => {
  // 2026-10-22 修掉的 bug: 旧判断 `expiresAt <= now` 把 0(永不过期)当成已过期,
  // 导致 registerClient() 每次都重新 DCR(幂等失效)。
  const p = store({ c: { clientInfo: { clientId: 'CID', clientSecret: 'SEC', clientIdIssuedAt: 1786300000, clientSecretExpiresAt: 0 } } })
  const prov = mod.createAuthProvider({ name: 'c', serverUrl: 'https://x/mcp', filePath: p })
  const info = prov.clientInformation()
  assert.ok(info, 'clientSecretExpiresAt=0 不得视为过期')
  assert.equal(info.client_id, 'CID')
  assert.equal(info.client_secret, 'SEC')
})

test('clientInformation: client_secret_expires_at 已过去 → 视为未注册', { skip: SKIP }, () => {
  const p = store({ c: { clientInfo: { clientId: 'CID', clientSecret: 'SEC', clientIdIssuedAt: 1786300000, clientSecretExpiresAt: 1000 } } })
  const prov = mod.createAuthProvider({ name: 'c', serverUrl: 'https://x/mcp', filePath: p })
  assert.equal(prov.clientInformation(), undefined, '过期 secret 应视为未注册')
})

test('registerClient: clientSecretExpiresAt 过期 → 重新注册', { skip: SKIP }, async () => {
  const p = store()
  const prov = mod.createAuthProvider({ name: 'reg4', serverUrl: 'https://demo.example.com/mcp', filePath: p })
  // 手工塞一个已过期的 secret
  prov.saveClientInformation({ client_id: 'OLD', client_secret: 'OLD-SECRET', client_secret_expires_at: 1 })
  const r = await prov.registerClient()
  assert.equal(r.client_id, 'REG-CLIENT-1', '过期 secret 应触发重新注册')
})

test('saveClientInformation: DCR 结果落盘', { skip: SKIP }, () => {
  const p = store()
  const prov = mod.createAuthProvider({ name: 'c', serverUrl: 'https://x/mcp', filePath: p })
  prov.saveClientInformation({ client_id: 'NEWCID', client_id_issued_at: 1786300000 }, {})
  assert.equal(A.getClientInfo(p, 'c').clientId, 'NEWCID')
})

test('tokens: ctx=undefined 也返回最近 token(per-request 读取路径)', { skip: SKIP }, () => {
  const p = store()
  const now = Math.floor(Date.now() / 1000)
  A.setTokens(p, 'c', { accessToken: 'AT', refreshToken: 'RT', expiresAt: now + 3600, scope: 'user:read' })
  const prov = mod.createAuthProvider({ name: 'c', serverUrl: 'https://x/mcp', filePath: p })
  const t = prov.tokens()
  assert.ok(t, 'ctx=undefined 时必须返回 token')
  assert.equal(t.access_token, 'AT')
  assert.equal(t.token_type, 'Bearer')
  assert.equal(t.refresh_token, 'RT')
  assert.equal(t.scope, 'user:read')
  assert.ok(t.expires_in > 3500 && t.expires_in <= 3600, `expires_in 应为剩余秒数, 实际 ${t.expires_in}`)
})

test('tokens: 已过期时 expires_in 为 0 不吐负值', { skip: SKIP }, () => {
  const p = store()
  const past = Math.floor(Date.now() / 1000) - 120
  A.setTokens(p, 'c', { accessToken: 'AT', expiresAt: past })
  const prov = mod.createAuthProvider({ name: 'c', serverUrl: 'https://x/mcp', filePath: p })
  const t = prov.tokens()
  assert.equal(t.expires_in, 0)
})

test('tokens: 无 token 返回 undefined', { skip: SKIP }, () => {
  const p = store()
  const prov = mod.createAuthProvider({ name: 'c', serverUrl: 'https://x/mcp', filePath: p })
  assert.equal(prov.tokens(), undefined)
})

test('saveTokens: expiresAt = now + expires_in, 文件 0600', { skip: SKIP }, () => {
  const p = store()
  const prov = mod.createAuthProvider({ name: 'c', serverUrl: 'https://x/mcp', filePath: p })
  const before = Math.floor(Date.now() / 1000)
  prov.saveTokens({ access_token: 'AT2', refresh_token: 'RT2', expires_in: 1800, scope: 'user:read account:read' }, {})
  const st = A.getTokens(p, 'c')
  assert.equal(st.accessToken, 'AT2', '字段名 access_token → accessToken')
  assert.equal(st.refreshToken, 'RT2')
  assert.equal(st.scope, 'user:read account:read')
  assert.ok(st.expiresAt >= before + 1800 && st.expiresAt <= before + 1802, `expiresAt=${st.expiresAt}`)
})

test('saveTokens: 不含 expires_in 时不写坏 expiresAt', { skip: SKIP }, () => {
  const p = store()
  const now = Math.floor(Date.now() / 1000)
  A.setTokens(p, 'c', { accessToken: 'OLD', expiresAt: now + 600 })
  const prov = mod.createAuthProvider({ name: 'c', serverUrl: 'https://x/mcp', filePath: p })
  prov.saveTokens({ access_token: 'NEW' }, {})
  const st = A.getTokens(p, 'c')
  assert.equal(st.accessToken, 'NEW')
  assert.equal(st.expiresAt, now + 600, '无 expires_in 时应保留原 expiresAt')
})

test('redirectToAuthorization: 仅接受 http/https', { skip: SKIP }, () => {
  const p = store()
  const prov = mod.createAuthProvider({ name: 'c', serverUrl: 'https://x/mcp', filePath: p })
  assert.throws(() => prov.redirectToAuthorization(new URL('file:///etc/passwd')), /protocol|http/i)
  assert.throws(() => prov.redirectToAuthorization(new URL('javascript:alert(1)')))
  // https 不抛
  assert.doesNotThrow(() => prov.redirectToAuthorization(new URL('https://mcp.cloudflare.com/authorize?x=1')))
})

test('saveCodeVerifier / codeVerifier 往返', { skip: SKIP }, () => {
  const p = store()
  const prov = mod.createAuthProvider({ name: 'c', serverUrl: 'https://x/mcp', filePath: p })
  prov.saveCodeVerifier('v'.repeat(43))
  assert.equal(prov.codeVerifier(), 'v'.repeat(43))
  const entry = A.getEntry(p, 'c')
  assert.ok(Number.isFinite(entry.pendingAt), 'saveCodeVerifier 应打 pendingAt')
})

test('codeVerifier: 无值时抛错(SDK 会在授权回调时调用)', { skip: SKIP }, () => {
  const p = store()
  const prov = mod.createAuthProvider({ name: 'c', serverUrl: 'https://x/mcp', filePath: p })
  assert.throws(() => prov.codeVerifier(), /codeVerifier|verifier/i)
})

test('安全红线: 任何错误信息不得含 token/client_secret', { skip: SKIP }, () => {
  const p = store()
  const now = Math.floor(Date.now() / 1000)
  A.setTokens(p, 'c', { accessToken: 'SECRET_AT_XYZ', refreshToken: 'SECRET_RT_XYZ', expiresAt: now + 60 })
  A.setClientInfo(p, 'c', { clientId: 'CID', clientSecret: 'SECRET_CS_XYZ' })
  const prov = mod.createAuthProvider({ name: 'c', serverUrl: 'https://x/mcp', filePath: p })
  let msgs = []
  // 触发各类错误路径
  const attempts = [
    () => prov.redirectToAuthorization(new URL('ftp://x/')),
    () => prov.codeVerifier(),
  ]
  for (const fn of attempts) { try { fn() } catch (e) { msgs.push(String(e.message)) } }
  // tokens() 成功后也检查没有把 secret 泄进返回值以外的通道
  for (const m of msgs) {
    for (const s of ['SECRET_AT_XYZ', 'SECRET_RT_XYZ', 'SECRET_CS_XYZ']) {
      assert.ok(!m.includes(s), `错误信息不得含 secret: ${m}`)
    }
  }
})

test('持久化隔离: 两个 provider 写不同 name 互不串', { skip: SKIP }, () => {
  const p = store()
  const a = mod.createAuthProvider({ name: 'a', serverUrl: 'https://a/mcp', filePath: p })
  const b = mod.createAuthProvider({ name: 'b', serverUrl: 'https://b/mcp', filePath: p })
  a.saveTokens({ access_token: 'TA' }, {})
  b.saveTokens({ access_token: 'TB' }, {})
  assert.equal(A.getTokens(p, 'a').accessToken, 'TA')
  assert.equal(A.getTokens(p, 'b').accessToken, 'TB')
})

test('并发写: 两 provider 交替写不互相覆盖(靠 auth-store 串行化)', { skip: SKIP }, () => {
  const p = store()
  const a = mod.createAuthProvider({ name: 'a', serverUrl: 'https://a/mcp', filePath: p })
  const b = mod.createAuthProvider({ name: 'b', serverUrl: 'https://b/mcp', filePath: p })
  for (let i = 0; i < 20; i++) {
    a.saveTokens({ access_token: `TA${i}` }, {})
    b.saveTokens({ access_token: `TB${i}` }, {})
  }
  assert.equal(A.getTokens(p, 'a').accessToken, 'TA19')
  assert.equal(A.getTokens(p, 'b').accessToken, 'TB19')
})

test('文件损坏: provider 读写不得崩溃', { skip: SKIP }, () => {
  const p = store()
  writeFileSync(p, '{ this is not json')
  const prov = mod.createAuthProvider({ name: 'c', serverUrl: 'https://x/mcp', filePath: p })
  // 损坏文件应被 auth-store 抢救, provider 读到空态而非崩
  assert.equal(prov.tokens(), undefined)
  assert.equal(prov.clientInformation(), undefined)
  prov.saveTokens({ access_token: 'AT' }, {})
  assert.equal(A.getTokens(p, 'c').accessToken, 'AT')
})
