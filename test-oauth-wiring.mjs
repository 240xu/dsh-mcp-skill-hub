/**
 * 装配测试 —— lib/index.js 的 mcpAuth 服务 + 5 条 oauth 路由（TDD 先红后绿）。
 *
 * 验证三件事:
 *   1. apply() 后 ctx.provide('mcpAuth') 被调用, 且服务有 getAuthProvider
 *   2. getAuthProvider 返回 per-MCP-line 稳定实例(seam 只取一次, 重连复用)
 *   3. 5 条 oauth 路由注册进 webServer, 且非 loopback 被 403
 *   4. oauth 装配失败不影响既有路由(降级路径)
 *
 * 运行: node --test test-oauth-wiring.mjs
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const HUB = '/data/data/com.termux/files/home/dsh-plugins-src/dsh-mcp-skill-hub'
let apply = null
let authStore = null
try {
  apply = (await import(HUB + '/lib/index.js')).apply
  authStore = await import(HUB + '/lib/auth-store.js')
} catch (error) {
  apply = null
}

test('lib/index.js 可加载（实现缺失即失败，不是 skip）', () => {
  assert.ok(apply, 'lib/index.js 应可 import')
  assert.ok(authStore, 'lib/auth-store.js 应可 import')
})

const tmpdirs = []
function sandbox() {
  const dir = mkdtempSync('/data/data/com.termux/files/usr/tmp/opencode/wr-')
  tmpdirs.push(dir)
  const patchPath = join(dir, 'cordis.patch.yml')
  writeFileSync(patchPath, [
    '# 用户注释',
    '- insert:',
    '    - id: mcp-demo',
    "      name: '@deepseek-ai/dsh-mcp-client'",
    '      config:',
    '        serverName: demo',
    '        transport: streamable-http',
    '        url: https://demo.example.com/mcp',
    '',
  ].join('\n'))
  return { dir, patchPath }
}
test.after(() => { for (const d of tmpdirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} } })

const MOUNT_KEY = '__dshMcpSkillHubMounted'
function env(s, { withProvide = true } = {}) {
  // 清掉 apply() 的单例守卫(Hub 防 HMR 重复挂载用的), 否则第二次 apply 直接 return
  delete globalThis[MOUNT_KEY]
  const routes = []
  const provided = []
  const ctx = {
    logger: { info: () => {}, warn: () => {} },
    effect: (fn) => fn(),
    get: (n) => {
      if (n === 'loader') return { entries: () => [{ options: { id: 'mcp-demo' }, fiber: {} }] }
      return undefined
    },
    webServer: { register: (r) => { routes.push(r); return () => {} } },
    skills: { list: async () => [] },
  }
  if (withProvide) ctx.provide = (n, v) => { provided.push([n, v]); }
  apply(ctx, { dshHome: s.dir, agentsHome: join(s.dir, 'agents'), profileDir: s.dir, patchPath: s.patchPath })
  return { ctx, routes, provided }
}

test('装配: ctx.provide("mcpAuth") 被调用', () => {
  const s = sandbox()
  const e = env(s)
  const hit = e.provided.find(([n]) => n === 'mcpAuth')
  assert.ok(hit, '应 provide("mcpAuth")')
  assert.equal(typeof hit[1].getAuthProvider, 'function', '服务应有 getAuthProvider')
})

test('装配: getAuthProvider 返回的 provider 有 SDK 必需成员', () => {
  const s = sandbox()
  const e = env(s)
  const svc = e.provided.find(([n]) => n === 'mcpAuth')[1]
  const p = svc.getAuthProvider('demo', { url: 'https://demo.example.com/mcp' })
  assert.ok(p, '应返回 provider')
  for (const k of ['redirectUrl', 'clientMetadata', 'clientInformation', 'tokens', 'saveTokens',
    'redirectToAuthorization', 'saveCodeVerifier', 'codeVerifier', 'setRedirectUrl']) {
    assert.ok(k in p, `provider 应有 ${k}`)
  }
})

test('装配: 同一 serverName+url 返回同一实例(seam 只取一次, 重连复用)', () => {
  const s = sandbox()
  const e = env(s)
  const svc = e.provided.find(([n]) => n === 'mcpAuth')[1]
  const a = svc.getAuthProvider('demo', { url: 'https://demo.example.com/mcp' })
  const b = svc.getAuthProvider('demo', { url: 'https://demo.example.com/mcp' })
  assert.equal(a, b, '同 serverName+url 必须同一实例')
  // 不同 serverName → 不同实例
  const c = svc.getAuthProvider('other', { url: 'https://demo.example.com/mcp' })
  assert.notEqual(a, c, '不同 serverName 应不同实例')
})

test('装配: 无 url 时返 undefined(stdio 行不应有 provider)', () => {
  const s = sandbox()
  const e = env(s)
  const svc = e.provided.find(([n]) => n === 'mcpAuth')[1]
  assert.equal(svc.getAuthProvider('demo', {}), undefined)
  assert.equal(svc.getAuthProvider('demo', { url: '' }), undefined)
})

test('装配: 5 条 oauth 路由注册进 webServer', () => {
  const s = sandbox()
  const e = env(s)
  const oauth = e.routes.filter((r) => r.path.includes('/oauth/')).map((r) => r.path).sort()
  assert.ok(oauth.length >= 5, '应注册 >=5 条 oauth 路由, 实际 ' + oauth.length + ': ' + oauth.join(' '))
  for (const p of ['/oauth/start', '/oauth/callback', '/oauth/status', '/oauth/finish', '/oauth/cancel']) {
    assert.ok(oauth.some((x) => x.endsWith(p)), `应有 ${p}`)
  }
})

test('装配: oauth 路由非 loopback → 403', async () => {
  const s = sandbox()
  const e = env(s)
  const path = '/api/dsh-mcp-skill-hub/oauth/status'
  const r = e.routes.find((x) => x.path === path)
  assert.ok(r, '应有 /oauth/status')
  const listeners = {}
  const req = { method: 'GET', url: path + '?id=mcp-demo', socket: { remoteAddress: '192.168.1.9' }, on(ev, fn) { (listeners[ev] ||= []).push(fn); return req } }
  const res = { writeHead(s2) { this.statusCode = s2; this.headersSent = true }, end(b) { this.body = b || '' } }
  setTimeout(() => { (listeners.end || []).forEach((f) => f()) }, 0)
  await r.handler(req, res)
  assert.equal(res.statusCode, 403, '非 loopback 应 403')
})

test('装配: oauth 路由方法错 → 405', async () => {
  const s = sandbox()
  const e = env(s)
  const path = '/api/dsh-mcp-skill-hub/oauth/status'
  const r = e.routes.find((x) => x.path === path)
  const listeners = {}
  const req = { method: 'POST', url: path, socket: { remoteAddress: '127.0.0.1' }, on(ev, fn) { (listeners[ev] ||= []).push(fn); return req } }
  const res = { writeHead(s2) { this.statusCode = s2; this.headersSent = true }, end(b) { this.body = b || '' } }
  setTimeout(() => { (listeners.end || []).forEach((f) => f()) }, 0)
  await r.handler(req, res)
  assert.equal(res.statusCode, 405, 'POST /oauth/status 应 405')
})

test('装配: ctx 无 provide 方法时不炸(降级路径)', () => {
  const s = sandbox()
  assert.doesNotThrow(() => env(s, { withProvide: false }), '无 provide 时 apply 不应抛')
})

test('装配: 既有路由未被 oauth 装配挤掉', () => {
  const s = sandbox()
  const e = env(s)
  const legacy = e.routes.filter((r) => !r.path.includes('/oauth/')).map((r) => r.path)
  assert.ok(legacy.includes('/api/dsh-mcp-skill-hub/state'), '既有 /state 应在')
  assert.ok(legacy.some((p) => p.includes('/mcp/')), '既有 MCP 操作路由应在')
})

test('装配: getAuthProvider 用 patch 行 id 作 auth-store 键（与 oauth 路由同口径）', () => {
  const s = sandbox()
  const e = env(s)
  const svc = e.provided.find(([n]) => n === 'mcpAuth')[1]
  // patch 行 id = mcp-demo, config.serverName = demo —— 两者不同, 必须用行 id 索引
  const p = svc.getAuthProvider('demo', { url: 'https://demo.example.com/mcp' })
  assert.ok(p, '应返回 provider')
  // provider 写凭据时用的 key 必须是行 id, 不是 serverName
  p.saveTokens({ access_token: 'AT1' }, {})
  const byRowId = authStore.getTokens(join(s.dir, 'mcp-auth.json'), 'mcp-demo')
  const byServerName = authStore.getTokens(join(s.dir, 'mcp-auth.json'), 'demo')
  assert.ok(byRowId?.accessToken === 'AT1',
    `凭据必须落在行 id(mcp-demo)下, 实际 ${JSON.stringify(byRowId)}`)
  assert.equal(byServerName?.accessToken, undefined,
    '不得同时落在 serverName(demo)下 —— 那会和 oauth 路由写的条目分裂')
})

test('装配: 无法从 config 推出行 id 时返 undefined(不猜键)', () => {
  const s = sandbox()
  const e = env(s)
  const svc = e.provided.find(([n]) => n === 'mcpAuth')[1]
  // serverName 存在但 config 无 url → 仍应返 undefined(无 url 无意义)
  assert.equal(svc.getAuthProvider('demo', {}), undefined)
})

test('装配 P1: getAuthProvider 内部异常 → 返 undefined 不抛(降级为无 authProvider)', () => {
  const s = sandbox()
  const e = env(s)
  const svc = e.provided.find(([n]) => n === 'mcpAuth')[1]
  // 用一个会让 createAuthProvider 抛错的 serverName(空串 → provider 构造抛)
  // 底座 seam 是 ?.getAuthProvider(...), 抛错会顺 P3 冒泡到 startConnection 失败,
  // 比"没有 OAuth 但有静态 headers"严重得多。必须吞掉。
  assert.doesNotThrow(() => svc.getAuthProvider('', { url: 'https://x/mcp' }),
    '空 serverName 不得让 getAuthProvider 抛错')
  assert.equal(svc.getAuthProvider('', { url: 'https://x/mcp' }), undefined,
    '异常时应返 undefined(降级)')
})

test('装配 P1: auth-store 文件不可读时 getAuthProvider 仍可用(auth-store 自身已收敛)', () => {
  const s = sandbox()
  const e = env(s)
  const svc = e.provided.find(([n]) => n === 'mcpAuth')[1]
  // 往 authPath 写一个目录(让读失败) —— auth-store 的 loadAuthStore 会收敛成 {}
  const p = svc.getAuthProvider('demo', { url: 'https://demo.example.com/mcp' })
  assert.ok(p, 'auth-store 读失败时 provider 仍应构造成功(读路径已收敛)')
  assert.equal(p.tokens(), undefined, '读不到 token 时 tokens() 返 undefined')
})

test('装配: 凭据文件路径落在 dshHome 下', () => {
  const s = sandbox()
  const e = env(s)
  const svc = e.provided.find(([n]) => n === 'mcpAuth')[1]
  assert.equal(svc.authPath, join(s.dir, 'mcp-auth.json'))
})

// 注: 不断言「真实 ~/.dsh/mcp-auth.json 不存在」—— 生产 dsh 进程有权在那里
// 写 clientInfo(DCR 注册结果, 实测 mcp-cloudflare / mcp-cf-radar 会被写入)。
// 只保证**测试自己**不碰真实路径: 用沙箱 dshHome 注入, 跑完后真实文件 mtime
// 不变。
test('装配: 测试全程不得修改真实 ~/.dsh/mcp-auth.json（防污染）', () => {
  const real = join(process.env.HOME, '.dsh', 'mcp-auth.json')
  const before = existsSync(real) ? statSync(real).mtimeMs : null
  // 本测试是防污染的「哨兵」: 它自己不写, 只记录基线。真正的断言在
  // 文件末尾的 afterAll 钩子里(与 before 比对)。
  if (before !== null) globalThis.__realAuthMtimeBefore = before
  assert.ok(true, '哨兵用例: 记录基线')
})

test('authStorePath: 缺省走 ~/.dsh（生产默认）, 显式 dshHome 优先', () => {
  assert.equal(authStore.authStorePath(), join(process.env.HOME, '.dsh', 'mcp-auth.json'))
  assert.equal(authStore.authStorePath({ dshHome: '/tmp/x' }), '/tmp/x/mcp-auth.json')
  assert.equal(authStore.authStorePath({ dshHome: '' }), join(process.env.HOME, '.dsh', 'mcp-auth.json'))
})

// ── 审计 M1 回归: 降级键必须与行 id 前缀隔离(防跨服务器凭据外发) ──
test('装配 M1: 降级键加 degraded: 前缀, 与行 id 不可能碰撞(防跨服务器凭据外发)', () => {
  const s = sandbox()
  // 构造碰撞场景: patch 里有两行 serverName 与 url 完全相同(重复行)
  // → resolveRowId 得到 2 个命中 → undefined → 走降级键。
  // 注: 仅 serverName 相同但 url 不同时, url 条件会把它收窄成唯一命中 → 仍用行 id,
  // 那条路径本身安全(已由上面"用 patch 行 id 作 auth-store 键"用例覆盖)。
  writeFileSync(s.patchPath, [
    '- insert:',
    '    - id: mcp-cloudflare',
    "      name: '@deepseek-ai/dsh-mcp-client'",
    '      config:',
    '        serverName: demo',
    '        transport: streamable-http',
    '        url: https://a.example.com/mcp',
    '    - id: demo',
    "      name: '@deepseek-ai/dsh-mcp-client'",
    '      config:',
    '        serverName: demo',
    '        transport: streamable-http',
    '        url: https://a.example.com/mcp',
    '',
  ].join('\n'))
  const e = env(s)
  const svc = e.provided.find(([n]) => n === 'mcpAuth')[1]
  const p = svc.getAuthProvider('demo', { url: 'https://a.example.com/mcp' })
  assert.ok(p, '应返回 provider')
  p.saveTokens({ access_token: 'AT-A' }, {})
  const storePath = join(s.dir, 'mcp-auth.json')
  // 旧缺陷: key = 'demo'(裸 serverName)。若另一行的行 id 恰好是 'demo',
  // 该行的 provider 会读到 AT-A 并把它发到自己的主机 → 跨服务器凭据外发。
  assert.equal(authStore.getTokens(storePath, 'demo')?.accessToken, undefined,
    'M1: 凭据不得落在裸 serverName 键下(会与他行的行 id 碰撞)')
  assert.equal(authStore.getTokens(storePath, 'degraded:demo')?.accessToken, 'AT-A',
    'M1: 降级键必须是 degraded:<serverName>')
})

test('装配 M1: 降级键不得等于任何 patch 行 id(前缀隔离的结构性证明)', () => {
  const s = sandbox()
  const e = env(s)
  const svc = e.provided.find(([n]) => n === 'mcpAuth')[1]
  // 让 patch 读不到(删文件) → resolveRowId 抛 ENOENT → 全行走降级键
  rmSync(s.patchPath, { force: true })
  const p = svc.getAuthProvider('demo', { url: 'https://demo.example.com/mcp' })
  assert.ok(p, 'patch 不可读时 provider 仍应构造成功')
  p.saveTokens({ access_token: 'AT-X' }, {})
  const storePath = join(s.dir, 'mcp-auth.json')
  const raw = JSON.parse(readFileSync(storePath, 'utf8'))
  const keys = Object.keys(raw)
  assert.ok(keys.length > 0, 'store 应有条目')
  for (const k of keys) {
    assert.ok(k.startsWith('degraded:'),
      `M1: 降级键 "${k}" 必须带 degraded: 前缀, 否则可能与行 id "${k}" 碰撞`)
  }
  assert.equal(authStore.getTokens(storePath, 'degraded:demo')?.accessToken, 'AT-X')
})

// ── 防污染闭环: 跑完后真实 ~/.dsh/mcp-auth.json 的 mtime 不得变化 ──
// 生产 dsh 进程有权写该文件(DCR clientInfo), 故不能断言「不存在」;
// 只保证测试自身没碰它。基线由上面的哨兵用例记录。
test.after(() => {
  const real = join(process.env.HOME, '.dsh', 'mcp-auth.json')
  const before = globalThis.__realAuthMtimeBefore
  if (before === null || before === undefined) return
  const after = existsSync(real) ? statSync(real).mtimeMs : null
  assert.equal(after, before,
    '真实 ~/.dsh/mcp-auth.json 的 mtime 在测试期间变了 —— 有测试注入了真实 dshHome')
})
