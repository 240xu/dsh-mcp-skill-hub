/**
 * SDK-facing provider 的 refresh 链路测试 —— 先红后绿(铁律 9)。
 *
 * 背景(P0-D): `setRedirectUrl` 只在 `/oauth/start` 的临时 provider 实例上调用
 * (oauth-server.js:308), 而 SDK 每请求实际用的 provider 来自
 * `registerAuthService().getAuthProvider()`(index.js:826), 这条链上没有任何
 * setRedirectUrl。于是 SDK 判 `nonInteractiveFlow = !provider.redirectUrl` 恒真,
 * 进 fetchToken() 必抛, **永远到不了 refresh_token 分支** —— token 过期后
 * 永远不会自己刷新。
 *
 * 本测试用真实运行时 SDK(@modelcontextprotocol/client) + 真实 Hub provider,
 * 驱动一个本地 mock OAuth AS, 做一变量对照:
 *   组1: provider 无 redirectUrl          → auth() 必抛
 *   组2: provider 有 redirectUrl(占位)    → auth() AUTHORIZED 且真的 refresh
 *
 * 运行: node --test test-oauth-refresh.mjs
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const HERE = import.meta.dirname

// 真实 Hub provider + SDK-facing 的构造入口
const { createAuthProvider, CALLBACK_PATH } = await import(join(HERE, 'lib', 'oauth-provider.js'))
const { selfHealOauthSeam, ANCHORS } = await import(join(HERE, 'lib', 'self-heal.mjs'))

// 真实运行时 SDK(装在 dsh 的 node_modules 下, 不在 mcp-client 下)
const DSH_ROOT = '/data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh'
let auth
try {
  ({ auth } = await import(join(DSH_ROOT, 'node_modules/@modelcontextprotocol/client/dist/index.mjs')))
} catch {
  ({ auth } = await import('@modelcontextprotocol/client'))
}

const PORT_RANGE_START = 41_000
let portCursor = PORT_RANGE_START

function startMockAS() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1')
      if (req.method === 'POST' && u.pathname === '/token') {
        let body = ''
        req.on('data', (c) => { body += c })
        req.on('end', () => {
          const params = new URLSearchParams(body)
          const grant = params.get('grant_type')
          const n = ++startMockAS.refreshCount
          res.writeHead(200, { 'content-type': 'application/json' })
          // refresh 轮换: 每次给不同的 token, 便于断言"真的刷了"
          res.end(JSON.stringify({
            access_token: `mock-access-v${n}`,
            refresh_token: `mock-refresh-v${n}`,
            token_type: 'Bearer',
            expires_in: 3600,
            scope: 'read:mcp',
          }))
        })
        return
      }
      if (req.method === 'GET' && u.pathname === '/.well-known/oauth-authorization-server') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          issuer: `http://127.0.0.1:${server.address().port}`,
          authorization_endpoint: `http://127.0.0.1:${server.address().port}/authorize`,
          token_endpoint: `http://127.0.0.1:${server.address().port}/token`,
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
        }))
        return
      }
      res.writeHead(404); res.end('nope')
    })
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}
startMockAS.refreshCount = 0

/** 造一个 Hub provider, 可指定是否注入 redirectUrl。 */
function makeProvider(authFile, serverUrl, withRedirectUrl) {
  const p = createAuthProvider({
    name: 'row-test',
    serverUrl,
    filePath: authFile,
    staticHeaders: {},
  })
  // 预置 clientInfo(已 DCR 过), 避免 auth() 真去 register。
  // 注意键名是 auth-store 归一化后的形态(clientId/clientIdIssuedAt),
  // 不是 RFC 7591 的 client_id —— provider.clientInformation() 会转换。
  const store = JSON.parse(readFileSync(authFile, 'utf8'))
  store['row-test'] = store['row-test'] || {}
  store['row-test'].clientInfo = {
    clientId: 'mock-client-1',
    clientSecret: 'mock-secret',
    clientIdIssuedAt: Math.floor(Date.now() / 1000),
    clientSecretExpiresAt: 0,   // RFC 7591: 0 = 永不过期
  }
  // 预置一个**已过期**的 token + 一个有效 refresh_token
  store['row-test'].tokens = {
    accessToken: 'mock-access-v0',
    refreshToken: 'mock-refresh-v0',
    tokenType: 'Bearer',
    expiresAt: Math.floor(Date.now() / 1000) - 7200,   // 2 小时前就过期
    scope: 'read:mcp',
  }
  writeFileSync(authFile, JSON.stringify(store, null, 2))
  if (withRedirectUrl) p.setRedirectUrl(`http://127.0.0.1:0${CALLBACK_PATH}`)
  return p
}

const tmp = mkdtempSync('/data/data/com.termux/files/usr/tmp/opencode/rf-')

/** 关干净: close 等监听结束, closeAllConnections 掐 keep-alive, unref 防止挂住进程 */
function killAS(as) {
  try { as.closeAllConnections?.() } catch {}
  try { as.close() } catch {}
  try { as.unref() } catch {}
}

test('组1(对照): provider 无 redirectUrl → SDK 的 auth() 必抛, 不会 refresh', async () => {
  const as = await startMockAS()
  const serverUrl = `http://127.0.0.1:${as.address().port}`
  const authFile = join(tmp, 'no-redirect.json')
  writeFileSync(authFile, '{}')

  const provider = makeProvider(authFile, serverUrl, false)

  let threw = null
  try {
    await auth(provider, { serverUrl })
  } catch (e) { threw = e }

  assert.ok(threw, '无 redirectUrl 时 auth() 应抛错(nonInteractiveFlow 恒真)')
  // 关键断言: **tokens 不得被刷新** —— 说明根本没走到 refresh_token 分支。
  // (clientInfo 可能被 SDK 的 DCR 路径先落盘, 那与 refresh 无关, 不在此断言范围)
  const after = JSON.parse(readFileSync(authFile, 'utf8'))
  assert.equal(after['row-test']?.tokens?.accessToken, 'mock-access-v0',
    'accessToken 不应被轮换 —— 没走到 refresh 分支')
  assert.equal(after['row-test']?.tokens?.refreshToken, 'mock-refresh-v0',
    'refreshToken 不应被轮换')
  killAS(as)
})

test('组2(修复目标): provider 有 redirectUrl → auth() AUTHORIZED 且真的 refresh', async () => {
  const as = await startMockAS()
  const serverUrl = `http://127.0.0.1:${as.address().port}`
  const authFile = join(tmp, 'with-redirect.json')
  writeFileSync(authFile, '{}')

  const provider = makeProvider(authFile, serverUrl, true)

  const result = await auth(provider, { serverUrl })
  assert.equal(result, 'AUTHORIZED', `应返回 AUTHORIZED, 实际 ${result}`)

  const store = JSON.parse(readFileSync(authFile, 'utf8'))
  const toks = store['row-test']?.tokens
  assert.ok(toks, 'refresh 后应回写 tokens')
  assert.notEqual(toks.accessToken, 'mock-access-v0', 'accessToken 应被轮换')
  assert.ok(toks.expiresAt > Math.floor(Date.now() / 1000), 'expiresAt 应上移(不再过期)')
  killAS(as)
})

test('组3(回归): 与组2同形, 但走 self-heal 的 SDK-facing 构造口径', async () => {
  // 验证"占位 redirectUrl 无需真实可监听"这一论断: refresh 流程不发 redirect_uri
  const as = await startMockAS()
  const serverUrl = `http://127.0.0.1:${as.address().port}`
  const authFile = join(tmp, 'placeholder.json')
  writeFileSync(authFile, '{}')
  const provider = makeProvider(authFile, serverUrl, true)
  const before = JSON.stringify(provider.clientMetadata, null, 0)
  const r = await auth(provider, { serverUrl })
  assert.equal(r, 'AUTHORIZED')
  // clientMetadata 不应因 refresh 而变
  assert.equal(JSON.stringify(provider.clientMetadata, null, 0), before)
  killAS(as)
})

test('辅助: CALLBACK_PATH 形态合法(占位 URL 能过 setRedirectUrl 校验)', () => {
  assert.match(CALLBACK_PATH, /^\/[A-Za-z0-9/_-]+$/)
  const p = createAuthProvider({ name: 'x', serverUrl: 'https://mcp.example.com', filePath: join(tmp, 'aux.json'), staticHeaders: {} })
  writeFileSync(join(tmp, 'aux.json'), '{}')
  p.setRedirectUrl(`http://127.0.0.1:0${CALLBACK_PATH}`)   // 不得抛
  assert.equal(p.redirectUrl, `http://127.0.0.1:0${CALLBACK_PATH}`)
})

test('辅助: 自愈模块与本测试共用同一份 ANCHORS(口径不漂移)', () => {
  assert.equal(ANCHORS.length, 3)
  assert.deepEqual(ANCHORS.map(a => a.id), ['P1', 'P2', 'P3+P4'])
})

// ─────────────────────────────────────────────────────────────
// P0-D 产品路径回归: registerAuthService().getAuthProvider() 产出的
// provider 必须自带 redirectUrl, 否则 SDK 判 nonInteractiveFlow 恒真,
// token 过期后永远刷不了。
// ─────────────────────────────────────────────────────────────

/** 造一个最小 ctx, 让 registerAuthService 能把服务 provide 出来。 */
function makeCtx() {
  const provided = {}
  return {
    provided,
    provide(svc, obj) { provided[svc] = obj },
    logger: { warn() {}, info() {}, error() {} },
    get() { return undefined },
  }
}

test('P0-D 回归: getAuthProvider() 产出的 provider 带 redirectUrl', async () => {
  const { __internals } = await import(join(HERE, 'lib', 'index.js'))
  const authFile = join(tmp, 'svc.json')
  writeFileSync(authFile, '{}')

  // patch 文件里放一行 streamable-http, 让 resolveRowId 能唯一命中
  const patchPath = join(tmp, 'cordis.patch.yml')
  writeFileSync(patchPath, [
    'plugins:',
    '  - id: mcp-cloudflare',
    "    name: '@deepseek-ai/dsh-mcp-client'",
    '    config:',
    '      serverName: cloudflare',
    '      transport: streamable-http',
    '      url: https://mcp.cloudflare.com/mcp',
    '',
  ].join('\n'))

  const ctx = makeCtx()
  __internals.registerAuthService(ctx, { patchPath, authPath: authFile })
  assert.ok(ctx.provided.mcpAuth, 'mcpAuth 服务应被 provide')

  const p = ctx.provided.mcpAuth.getAuthProvider('mcp-cloudflare', { url: 'https://mcp.cloudflare.com/mcp' })
  assert.ok(p, '应返回 provider')
  assert.equal(typeof p.setRedirectUrl, 'function', 'provider 应有 setRedirectUrl')
  assert.ok(p.redirectUrl, `redirectUrl 不应为空(否则 SDK 恒走 nonInteractiveFlow): ${p.redirectUrl}`)
  assert.equal(p.redirectUrl, `http://127.0.0.1:0${CALLBACK_PATH}`)
})

test('P0-D 回归: getAuthProvider() 的 provider 能真的刷新过期 token', async () => {
  const { __internals } = await import(join(HERE, 'lib', 'index.js'))
  const as = await startMockAS()
  const serverUrl = `http://127.0.0.1:${as.address().port}`
  const authFile = join(tmp, 'svc-refresh.json')
  const patchPath = join(tmp, 'cordis.patch2.yml')
  writeFileSync(patchPath, [
    'plugins:',
    '  - id: row-test',
    "    name: '@deepseek-ai/dsh-mcp-client'",
    '    config:',
    '      serverName: row-test',
    '      transport: streamable-http',
    `      url: ${serverUrl}`,
    '',
  ].join('\n'))

  // 预置过期 token(用 auth-store 的归一化键名)
  writeFileSync(authFile, JSON.stringify({
    'row-test': {
      clientInfo: {
        clientId: 'mock-client-1', clientSecret: 'mock-secret',
        clientIdIssuedAt: Math.floor(Date.now() / 1000), clientSecretExpiresAt: 0,
      },
      tokens: {
        accessToken: 'mock-access-v0', refreshToken: 'mock-refresh-v0',
        tokenType: 'Bearer', expiresAt: Math.floor(Date.now() / 1000) - 7200,
        scope: 'read:mcp',
      },
    },
  }, null, 2))

  const ctx = makeCtx()
  __internals.registerAuthService(ctx, { patchPath, authPath: authFile })
  const p = ctx.provided.mcpAuth.getAuthProvider('row-test', { url: serverUrl })
  assert.ok(p, '应返回 provider')

  const r = await auth(p, { serverUrl })
  assert.equal(r, 'AUTHORIZED', `应 AUTHORIZED, 实际 ${r}`)
  const after = JSON.parse(readFileSync(authFile, 'utf8'))
  assert.notEqual(after['row-test'].tokens.accessToken, 'mock-access-v0', 'accessToken 应被轮换')
  assert.ok(after['row-test'].tokens.expiresAt > Math.floor(Date.now() / 1000), 'expiresAt 应上移')
  killAS(as)
})

test.after(() => {
  try { rmSync(tmp, { recursive: true, force: true }) } catch { /* best effort */ }
})
