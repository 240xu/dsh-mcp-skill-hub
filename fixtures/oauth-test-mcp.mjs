#!/usr/bin/env node
/**
 * OAuth 测试 MCP 服务器 —— 与 Cloudflare 远程 MCP 协议同构, 但跑在本地。
 *
 * 用途: 在没有 cloudflare.com 网络可达性的环境下, 完整验证 dsh-mcp-skill-hub 的
 *       OAuth 2.1 + PKCE 全链路(authorize → callback → token → 持 token 调 MCP)。
 *
 * 实现三个端点(与 Cloudflare 一致):
 *   GET  /authorize           授权页(可点 Approve/Deny)
 *   POST /token               换 token(authorization_code + refresh_token)
 *   POST / (或 /mcp)           MCP Streamable HTTP, 无 token → 401
 *
 * 额外测试端点(仅供断言, 非协议部分):
 *   GET  /__state             查看已签发 code/token, 断言用
 *   POST /__reset             清空状态
 *
 * 用法:
 *   PORT=9981 node fixtures/oauth-test-mcp.mjs &
 *   curl -s http://127.0.0.1:9981/__state
 */
import http from 'node:http'
import crypto from 'node:crypto'
import { randomUUID } from 'node:crypto'

const PORT = Number(process.env.PORT || 9981)
const HOST = process.env.HOST || '127.0.0.1'

// ── 状态 ──
const codes = new Map()       // code → { clientId, redirectUri, challenge, expiresAt, scope }
const tokens = new Map()      // accessToken → { clientId, scope, expiresAt, refreshToken }
const refreshes = new Map()   // refreshToken → { accessToken, clientId, scope }
const dcrClients = new Map()  // clientId → { clientSecret, issuedAt }
const log = []

// ── 工具 ──
const b64url = (buf) => Buffer.from(buf).toString('base64url')
const now = () => Math.floor(Date.now() / 1000)
const say = (msg) => { log.push(`[${new Date().toISOString()}] ${msg}`); console.error(msg) }

const json = (res, status, obj, headers = {}) => {
  const body = JSON.stringify(obj)
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(body)
}

const readBody = (req) => new Promise((resolve) => {
  let b = ''
  req.on('data', (c) => { b += c; if (b.length > 1e6) req.destroy() })
  req.on('end', () => resolve(b))
})

const html = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' })
  res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>OAuth Test MCP</title>
<style>body{font-family:system-ui,sans-serif;max-width:520px;margin:60px auto;padding:0 16px;background:#0f1115;color:#e6e8eb}
h1{font-size:20px}button{font-size:15px;padding:10px 20px;margin:8px 8px 0 0;border-radius:6px;border:1px solid #444;background:#1c1f26;color:#e6e8eb;cursor:pointer}
button.ok{background:#2563eb;border-color:#2563eb}table{border-collapse:collapse;width:100%;margin-top:16px;font-size:12px}
td,th{border:1px solid #333;padding:6px 8px;text-align:left;word-break:break-all}code{color:#7dd3fc}</style></head>
<body>${body}</body></html>`)
}

// ── DCR: POST /register(Cloudflare 走 RFC 7591 动态客户端注册) ──
async function handleRegister(req, res) {
  const body = await readBody(req)
  let meta = {}
  try { meta = JSON.parse(body) } catch {}
  const clientId = 'test-client-' + randomUUID().slice(0, 8)
  dcrClients.set(clientId, {
    clientSecret: 'secret-' + randomUUID().slice(0, 12),
    issuedAt: now(),
    redirectUris: meta.redirect_uris || [],
    clientName: meta.client_name || 'unknown',
  })
  say(`DCR 注册: clientId=${clientId} name=${meta.client_name} redirect_uris=${JSON.stringify(meta.redirect_uris)}`)
  json(res, 201, {
    client_id: clientId,
    client_secret: dcrClients.get(clientId).clientSecret,
    client_id_issued_at: now(),
    // Cloudflare 真实响应带 client_secret_expires_at: 0(永不过期)
    client_secret_expires_at: 0,
    redirect_uris: meta.redirect_uris || [],
    client_name: meta.client_name,
  })
}

// ── GET /authorize: 授权页 ──
async function handleAuthorize(u, res) {
  const clientId = u.searchParams.get('client_id')
  const redirectUri = u.searchParams.get('redirect_uri')
  const state = u.searchParams.get('state')
  const challenge = u.searchParams.get('code_challenge')
  const method = u.searchParams.get('code_challenge_method')
  const scope = u.searchParams.get('scope') || ''
  const responseType = u.searchParams.get('response_type')

  say(`授权请求: client_id=${clientId} redirect_uri=${redirectUri} state=${state?.slice(0, 12)}… method=${method} scope="${scope}"`)

  // 参数校验(与真实授权服务器同构: 缺一不可)
  if (responseType !== 'code') return html(res, 400, `<h1>400 unsupported_response_type</h1><p>期望 code, 得到 ${responseType}</p>`)
  if (!clientId) return html(res, 400, `<h1>400 invalid_request</h1><p>缺 client_id</p>`)
  if (!redirectUri) return html(res, 400, `<h1>400 invalid_request</h1><p>缺 redirect_uri</p>`)
  if (!challenge) return html(res, 400, `<h1>400 invalid_request</h1><p>缺 code_challenge(PKCE 必需)</p>`)
  if (method !== 'S256') return html(res, 400, `<h1>400 invalid_request</h1><p>code_challenge_method 必须 S256, 得到 ${method}</p>`)

  // 动作: approve / deny(支持 approve?auto=1 供无人值守测试)
  const action = u.searchParams.get('__act') || (u.searchParams.get('auto') === '1' ? 'approve' : null)

  if (action === 'deny') {
    const back = new URL(redirectUri)
    back.searchParams.set('error', 'access_denied')
    back.searchParams.set('state', state || '')
    say('用户拒绝授权 → 302 error=access_denied')
    res.writeHead(302, { location: back.toString() }); res.end(); return
  }

  if (action === 'approve') {
    const code = b64url(crypto.randomBytes(32))
    codes.set(code, {
      clientId, redirectUri, challenge, scope,
      expiresAt: now() + 120,  // code 2 分钟有效(与真实服务器一致)
    })
    const back = new URL(redirectUri)
    back.searchParams.set('code', code)
    back.searchParams.set('state', state || '')
    say(`签发 code=${code.slice(0, 12)}… → 302 ${redirectUri}`)
    res.writeHead(302, { location: back.toString() }); res.end(); return
  }

  // 无人为动作 → 渲染授权页(等用户点按钮)
  html(res, 200, `<h1>授权 OAuth Test MCP</h1>
<p>客户端 <code>${clientId}</code> 请求访问, scope: <code>${scope || '(none)'}</code></p>
<table>
<tr><th>redirect_uri</th><td><code>${redirectUri}</code></td></tr>
<tr><th>PKCE</th><td>${method} / <code>${challenge.slice(0, 24)}…</code></td></tr>
<tr><th>state</th><td><code>${state}</code></td></tr>
</table>
<form method="get">
  <input type="hidden" name="__act" value="approve">
  <button class="ok" type="submit">Approve(同意授权)</button>
</form>
<form method="get">
  <input type="hidden" name="__act" value="deny">
  <button type="submit">Deny(拒绝)</button>
</form>`)
}

// ── POST /token ──
async function handleToken(req, res) {
  const body = await readBody(req)
  const p = new URLSearchParams(body)
  const grant = p.get('grant_type')
  const redirectUri = p.get('redirect_uri')
  const clientId = p.get('client_id')
  say(`token 请求: grant=${grant} client_id=${clientId} redirect_uri=${redirectUri}`)

  if (grant === 'authorization_code') {
    const code = p.get('code')
    const verifier = p.get('code_verifier')
    const rec = codes.get(code)
    if (!rec) { say('✗ code 无效或已用过'); return json(res, 400, { error: 'invalid_grant' }) }
    if (rec.expiresAt < now()) { codes.delete(code); say('✗ code 已过期'); return json(res, 400, { error: 'invalid_grant', error_description: 'code expired' }) }
    if (redirectUri !== rec.redirectUri) { say(`✗ redirect_uri 不匹配: ${redirectUri} != ${rec.redirectUri}`); return json(res, 400, { error: 'invalid_grant', error_description: 'redirect_uri mismatch' }) }
    if (clientId !== rec.clientId) { say('✗ client_id 不匹配'); return json(res, 400, { error: 'invalid_grant', error_description: 'client_id mismatch' }) }

    // PKCE 校验: SHA256(verifier) base64url === challenge
    const computed = b64url(crypto.createHash('sha256').update(verifier || '').digest())
    if (computed !== rec.challenge) {
      say(`✗ PKCE 校验失败: computed=${computed.slice(0, 16)}… challenge=${rec.challenge.slice(0, 16)}…`)
      return json(res, 400, { error: 'invalid_grant', error_description: 'PKCE verification failed' })
    }

    codes.delete(code)  // 一次性
    const accessToken = 'at_' + randomUUID()
    const refreshToken = 'rt_' + randomUUID()
    const expiresIn = 3600
    tokens.set(accessToken, { clientId: rec.clientId, scope: rec.scope, expiresAt: now() + expiresIn, refreshToken })
    refreshes.set(refreshToken, { accessToken, clientId: rec.clientId, scope: rec.scope })
    say(`✓ 签发 access_token=${accessToken.slice(0, 14)}… expires_in=${expiresIn} refresh_token=${refreshToken.slice(0, 14)}…`)
    return json(res, 200, {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: expiresIn,
      refresh_token: refreshToken,
      scope: rec.scope,
    })
  }

  if (grant === 'refresh_token') {
    const rt = p.get('refresh_token')
    const rec = refreshes.get(rt)
    if (!rec) { say('✗ refresh_token 无效'); return json(res, 400, { error: 'invalid_grant', error_description: 'invalid refresh token' }) }
    // 轮换: 旧 refresh 作废, 签新的(与 Cloudflare 一致)
    refreshes.delete(rt)
    const oldAt = rec.accessToken
    if (tokens.has(oldAt)) tokens.delete(oldAt)
    const accessToken = 'at_' + randomUUID()
    const refreshToken = 'rt_' + randomUUID()
    tokens.set(accessToken, { clientId: rec.clientId, scope: rec.scope, expiresAt: now() + 3600, refreshToken })
    refreshes.set(refreshToken, { accessToken, clientId: rec.clientId, scope: rec.scope })
    say(`✓ refresh 轮换: 新 access_token=${accessToken.slice(0, 14)}… 旧 token 已作废`)
    return json(res, 200, {
      access_token: accessToken, token_type: 'Bearer', expires_in: 3600,
      refresh_token: refreshToken, scope: rec.scope,
    })
  }

  say(`✗ 不支持的 grant_type: ${grant}`)
  json(res, 400, { error: 'unsupported_grant_type' })
}

// ── MCP: POST / (streamable http) ──
const MCP_TOOLS = [
  {
    name: 'add',
    description: 'Add two numbers (OAuth-gated test tool)',
    inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] },
  },
  {
    name: 'whoami',
    description: 'Return the token scope the request was authorized with',
    inputSchema: { type: 'object', properties: {} },
  },
]

async function handleMcp(req, res) {
  const auth = req.headers.authorization || ''
  const m = /^Bearer (.+)$/.exec(auth)
  const at = m ? m[1] : ''

  // 无 token 或 token 无效 → 401 + WWW-Authenticate(带 resource_metadata, 与 RFC 9728 同构)
  const rec = at ? tokens.get(at) : undefined
  if (!rec || rec.expiresAt < now()) {
    if (at && !rec) say(`MCP 调用 token 无效: ${at.slice(0, 14)}…`)
    else if (at && rec.expiresAt < now()) say('MCP 调用 token 已过期')
    res.writeHead(401, {
      'content-type': 'application/json',
      'www-authenticate': `Bearer realm="oauth-test-mcp", resource_metadata="http://${HOST}:${PORT}/.well-known/oauth-protected-resource"`,
    })
    res.end(JSON.stringify({
      jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null,
    }))
    return
  }

  const body = await readBody(req)
  let msg
  try { msg = JSON.parse(body) } catch { return json(res, 400, { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }) }
  say(`MCP ${msg.method} (token scope="${rec.scope}")`)

  const reply = (result, id) => json(res, 200, { jsonrpc: '2.0', result, id })

  switch (msg.method) {
    case 'initialize':
      return reply({
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'oauth-test-mcp', version: '1.0.0' },
      }, msg.id)
    case 'tools/list':
      return reply({ tools: MCP_TOOLS }, msg.id)
    case 'tools/call': {
      const { name, arguments: args } = msg.params || {}
      if (name === 'add') {
        const { a, b } = args || {}
        return reply({ content: [{ type: 'text', text: String(Number(a) + Number(b)) }] }, msg.id)
      }
      if (name === 'whoami') {
        return reply({ content: [{ type: 'text', text: JSON.stringify({ scope: rec.scope, clientId: rec.clientId }) }] }, msg.id)
      }
      return json(res, 200, { jsonrpc: '2.0', error: { code: -32602, message: `unknown tool: ${name}` }, id: msg.id })
    }
    case 'ping':
      return reply({}, msg.id)
    default:
      return json(res, 200, { jsonrpc: '2.0', error: { code: -32601, message: `method not found: ${msg.method}` }, id: msg.id })
  }
}

// ── 测试辅助端点 ──
async function handleTestState(res) {
  json(res, 200, {
    codes: [...codes.entries()].map(([k, v]) => ({ code: k, ...v })),
    tokens: [...tokens.entries()].map(([k, v]) => ({ token: k, ...v })),
    refreshes: [...refreshes.keys()],
    dcrClients: [...dcrClients.entries()].map(([k, v]) => ({ clientId: k, ...v })),
    log: log.slice(-40),
  })
}

// ── 路由 ──
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${HOST}:${PORT}`)
  const path = u.pathname
  try {
    if (req.method === 'GET' && path === '/authorize') return await handleAuthorize(u, res)
    if (req.method === 'GET' && path === '/__state') return await handleTestState(res)
    if (req.method === 'POST' && path === '/__reset') { codes.clear(); tokens.clear(); refreshes.clear(); dcrClients.clear(); log.length = 0; return json(res, 200, { ok: true }) }
    if (req.method === 'POST' && path === '/register') return await handleRegister(req, res)
    if (req.method === 'POST' && path === '/token') return await handleToken(req, res)
    if (req.method === 'GET' && path === '/.well-known/oauth-protected-resource') {
      return json(res, 200, { resource: `http://${HOST}:${PORT}/`, authorization_servers: [`http://${HOST}:${PORT}`] })
    }
    if (req.method === 'POST' && (path === '/' || path === '/mcp')) return await handleMcp(req, res)
    json(res, 404, { error: 'not found', path })
  } catch (e) {
    say('内部错误: ' + e.message)
    json(res, 500, { error: 'internal', message: e.message })
  }
})

server.listen(PORT, HOST, () => {
  // PORT=0 时 OS 分配空闲端口; 把实际端口写到 stdout 供调用方读取
  // (测试用固定/随机端口偶发冲突, 曾造成一次未能复现的失败)
  const actual = server.address().port
  process.stdout.write(`__LISTENING__ ${actual}\n`)
  say(`OAuth test MCP listening on http://${HOST}:${actual}`)
  say(`  /authorize  授权页(支持 ?__act=approve|deny|auto=1)`)
  say(`  /token      authorization_code + refresh_token`)
  say(`  /           MCP streamable http(无 token → 401)`)
})
