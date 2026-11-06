/**
 * 过期 token 主动续期 —— 用户 2026-11-06 明确要求的 UX 修复(铁律 9 先红后绿)。
 *
 * 问题现象: 设置页把 mcp-cloudflare 显示成「授权掉了」, 用户必须再点一次
 * 授权按钮才能恢复。用户原话:「那就自动换新啊, 为什么搞的怎么还要我重新点
 * 一次? 不要这样设计啊」。
 *
 * 根因: 续期是**懒触发**的 —— 只有 SDK 真正连 MCP 服务器并收到 401 时,
 * 才会走 auth() 里的 refresh_token 分支。而:
 *   1. 一个没被使用的 MCP 行永远不会发请求 → 永远不续 → 一直显示 expired;
 *   2. tokens() 无条件把已过期的 accessToken 交出去, 不自己判过期;
 *   3. UI 每次轮询 /oauth/status 只看 expiresAt, 于是长期停在「过期」。
 *
 * 修复口径(本测试锁定):
 *   - `tokens()` 在 token 已过期或即将过期(提前 5 分钟)且存在 refreshToken 时,
 *     必须**先在内部完成续期**再把新 token 交出去;
 *   - 续期失败不得吞掉原 token 也不得 crash: 交回原 token, 让上层按 401 走
 *     已有的交互式授权路径(即最终仍可恢复, 只是需要用户参与);
 *   - 并发调用只应真正续期一次, 避免同一 token 被并发刷新导致互相作废。
 *
 * 运行: node --test test-oauth-proactive-refresh.mjs
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'

const HERE = import.meta.dirname
const { createAuthProvider } = await import(join(HERE, 'lib', 'oauth-provider.js'))
const store = await import(join(HERE, 'lib', 'auth-store.js'))

/** 起一个 mock 授权服务器: /token 返回轮换的新 token; 记录被调用次数。 */
function startMockAS({ fail = false, delayMs = 0 } = {}) {
	return new Promise((resolve) => {
		const state = { tokenCalls: 0, lastGrant: null }
		const server = createServer((req, res) => {
			const u = new URL(req.url, 'http://127.0.0.1')
			if (req.method === 'GET' && u.pathname === '/.well-known/oauth-authorization-server') {
				const base = `http://127.0.0.1:${server.address().port}`
				res.writeHead(200, { 'content-type': 'application/json' })
				res.end(JSON.stringify({
					issuer: base,
					authorization_endpoint: `${base}/authorize`,
					token_endpoint: `${base}/token`,
					response_types_supported: ['code'],
					grant_types_supported: ['authorization_code', 'refresh_token'],
					code_challenge_methods_supported: ['S256'],
				}))
				return
			}
			if (req.method === 'GET' && u.pathname === '/.well-known/oauth-protected-resource') {
				const base = `http://127.0.0.1:${server.address().port}`
				res.writeHead(200, { 'content-type': 'application/json' })
				res.end(JSON.stringify({ resource: `${base}/mcp`, authorization_servers: [base] }))
				return
			}
			if (req.method === 'POST' && u.pathname === '/token') {
				let body = ''
				req.on('data', (c) => { body += c })
				req.on('end', () => {
					state.tokenCalls += 1
					state.lastGrant = new URLSearchParams(body).get('grant_type')
					const done = () => {
						if (fail) {
							res.writeHead(400, { 'content-type': 'application/json' })
							res.end(JSON.stringify({ error: 'invalid_grant' }))
							return
						}
						const n = state.tokenCalls
						res.writeHead(200, { 'content-type': 'application/json' })
						res.end(JSON.stringify({
							access_token: `refreshed-access-${n}`,
							refresh_token: `refreshed-refresh-${n}`,
							token_type: 'Bearer',
							expires_in: 3600,
						}))
					}
					if (delayMs > 0) setTimeout(done, delayMs)
					else done()
				})
				return
			}
			res.writeHead(404); res.end('nope')
		})
		server.listen(0, '127.0.0.1', () => resolve({ server, state }))
	})
}

function makeStore() {
	const dir = mkdtempSync(join(tmpdir(), 'hub-refresh-'))
	const filePath = join(dir, 'mcp-auth.json')
	return { dir, filePath, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/** 写入一条指定过期状态的凭据。expiresInSec 负数 = 已过期。 */
function seed(filePath, name, { expiresInSec, refresh = true, access = 'stale-access' }) {
	const now = Math.floor(Date.now() / 1000)
	store.setClientInfo(filePath, name, { clientId: 'client-abc', clientIdIssuedAt: now })
	return store.setTokens(filePath, name, {
		accessToken: access,
		...(refresh ? { refreshToken: 'stale-refresh' } : {}),
		expiresAt: now + expiresInSec,
	})
}

test('已过期 + 有 refreshToken → tokens() 自己续期, 交出新 token', async () => {
	const { server, state } = await startMockAS()
	const s = makeStore()
	const serverUrl = `http://127.0.0.1:${server.address().port}/mcp`
	try {
		seed(s.filePath, 'row-a', { expiresInSec: -3600 })
		const p = createAuthProvider({ name: 'row-a', serverUrl, filePath: s.filePath })
		p.setRedirectUrl?.('http://127.0.0.1:0/mcp/oauth/callback')

		const refreshed = await p.ensureFreshTokens()
		const tok = p.tokens()
		assert.equal(refreshed, true, '过期 token 必须续期成功')
		assert.equal(state.tokenCalls, 1, '过期 token 必须触发一次 refresh')
		assert.equal(state.lastGrant, 'refresh_token', '必须用 refresh_token grant')
		assert.equal(tok?.access_token, 'refreshed-access-1', '必须交出新 token 而不是过期的那个')
		assert.notEqual(tok?.access_token, 'stale-access')

		// 续期结果必须落盘(否则下次又过期)
		const persisted = store.getTokens(s.filePath, 'row-a')
		assert.equal(persisted.accessToken, 'refreshed-access-1', '新 token 必须写回 store')
		assert.equal(persisted.refreshToken, 'refreshed-refresh-1', '轮换后的 refreshToken 也要写回')
		assert.ok(persisted.expiresAt > Math.floor(Date.now() / 1000), '新的 expiresAt 应在未来')
	} finally {
		server.close(); s.cleanup()
	}
})

test('即将过期(剩余 < 5 分钟)也提前续期, 而不是等它烂掉', async () => {
	const { server, state } = await startMockAS()
	const s = makeStore()
	const serverUrl = `http://127.0.0.1:${server.address().port}/mcp`
	try {
		seed(s.filePath, 'row-b', { expiresInSec: 60 }) // 1 分钟后过期
		const p = createAuthProvider({ name: 'row-b', serverUrl, filePath: s.filePath })
		p.setRedirectUrl?.('http://127.0.0.1:0/mcp/oauth/callback')

		const refreshed = await p.ensureFreshTokens()
		const tok = p.tokens()
		assert.equal(refreshed, true, '临期 token 应续期')
		assert.equal(state.tokenCalls, 1, '临期 token 应提前续期(提前量 5 分钟)')
		assert.equal(tok?.access_token, 'refreshed-access-1')
	} finally {
		server.close(); s.cleanup()
	}
})

test('仍然有效的 token(剩余 > 5 分钟)不打扰服务器', async () => {
	const { server, state } = await startMockAS()
	const s = makeStore()
	const serverUrl = `http://127.0.0.1:${server.address().port}/mcp`
	try {
		seed(s.filePath, 'row-c', { expiresInSec: 3600 })
		const p = createAuthProvider({ name: 'row-c', serverUrl, filePath: s.filePath })
		p.setRedirectUrl?.('http://127.0.0.1:0/mcp/oauth/callback')

		const refreshed = await p.ensureFreshTokens()
		const tok = p.tokens()
		assert.equal(refreshed, false, '有效 token 不应续期')
		assert.equal(state.tokenCalls, 0, '有效 token 不应触发 refresh(避免无谓的抖动)')
		assert.equal(tok?.access_token, 'stale-access', '应交回原有的有效 token')
	} finally {
		server.close(); s.cleanup()
	}
})

test('续期失败: 不 crash, 交回原 token 让上层走交互式授权', async () => {
	const { server } = await startMockAS({ fail: true })
	const s = makeStore()
	const serverUrl = `http://127.0.0.1:${server.address().port}/mcp`
	try {
		seed(s.filePath, 'row-d', { expiresInSec: -3600 })
		const p = createAuthProvider({ name: 'row-d', serverUrl, filePath: s.filePath })
		p.setRedirectUrl?.('http://127.0.0.1:0/mcp/oauth/callback')

		const refreshed = await p.ensureFreshTokens()
		const tok = p.tokens()
		assert.equal(refreshed, false, '续期失败应返回 false, 不抛')
		assert.ok(tok, '续期失败也必须返回对象, 不能返回 undefined 让 SDK 直接无 token')
		assert.equal(tok.access_token, 'stale-access', '失败时交回原 token, 由 401 走交互式授权')
	} finally {
		server.close(); s.cleanup()
	}
})

test('无 refreshToken 时不尝试续期(直接交回原 token)', async () => {
	const { server, state } = await startMockAS()
	const s = makeStore()
	const serverUrl = `http://127.0.0.1:${server.address().port}/mcp`
	try {
		seed(s.filePath, 'row-e', { expiresInSec: -3600, refresh: false })
		const p = createAuthProvider({ name: 'row-e', serverUrl, filePath: s.filePath })
		p.setRedirectUrl?.('http://127.0.0.1:0/mcp/oauth/callback')

		const refreshed = await p.ensureFreshTokens()
		const tok = p.tokens()
		assert.equal(refreshed, false, '无 refreshToken 时不应声称续期成功')
		assert.equal(state.tokenCalls, 0, '没有 refreshToken 就无从续期, 不应打服务器')
		assert.equal(tok?.access_token, 'stale-access')
	} finally {
		server.close(); s.cleanup()
	}
})

test('并发调用只续期一次(避免同一 refreshToken 被并发轮换作废)', async () => {
	const { server, state } = await startMockAS({ delayMs: 60 })
	const s = makeStore()
	const serverUrl = `http://127.0.0.1:${server.address().port}/mcp`
	try {
		seed(s.filePath, 'row-f', { expiresInSec: -3600 })
		const p = createAuthProvider({ name: 'row-f', serverUrl, filePath: s.filePath })
		p.setRedirectUrl?.('http://127.0.0.1:0/mcp/oauth/callback')

		const results = await Promise.all([
			p.ensureFreshTokens(), p.ensureFreshTokens(), p.ensureFreshTokens(),
		])
		assert.equal(state.tokenCalls, 1, `并发 3 次应只真正 refresh 1 次, 实得 ${state.tokenCalls}`)
		for (const r of results) assert.equal(r, true, '并发调用都应报告续期成功')
		assert.equal(p.tokens()?.access_token, 'refreshed-access-1')
	} finally {
		server.close(); s.cleanup()
	}
})

test('已过期且无 refreshToken 时, tokens() 不返回过期 token 让人误以为可用', async () => {
	// 设计取舍: 交回原 token 会让 SDK 发一次 401 再走交互式授权, 这是期望路径;
	// 但必须让调用方**看得出来**它已过期, 以便 UI 提示「需要重新授权」。
	const s = makeStore()
	try {
		seed(s.filePath, 'row-g', { expiresInSec: -3600, refresh: false })
		const p = createAuthProvider({
			name: 'row-g', serverUrl: 'https://example.invalid/mcp', filePath: s.filePath,
		})
		const tok = p.tokens()
		assert.equal(tok?.access_token, 'stale-access')
		assert.equal(tok?.expires_in, 0, '过期 token 的 expires_in 必须为 0, 不能是负数或伪造正值')
	} finally { s.cleanup() }
})

// ── 端到端: /oauth/status 轮询就该把 token 换新 ──────────────────────────
// 这是用户实际体验的路径: 打开设置页 → UI 每 10s 轮询 /oauth/status
// → 状态路由顺手续期 → 用户看不到「授权掉了」。
test('端到端: /oauth/status 轮询触发主动续期, 状态从 expired 变 authenticated', async () => {
	const { server, state } = await startMockAS()
	const s = makeStore()
	const serverUrl = `http://127.0.0.1:${server.address().port}/mcp`
	try {
		seed(s.filePath, 'row-h', { expiresInSec: -3600 })
		// 用真实 provider + 真实路由, 只把 patch 行与 store 指向临时夹具
		const { registerOAuthRoutes } = await import(join(HERE, 'lib', 'oauth-server.js'))
		const routes = []
		const writeJson = (res, status, body) => { res.status = status; res.body = body }
		const route = (path, method, handler) => ({ path, method, handler })
		const provider = createAuthProvider({ name: 'row-h', serverUrl, filePath: s.filePath })
		provider.setRedirectUrl?.('http://127.0.0.1:0/mcp/oauth/callback')

		routes.push(...registerOAuthRoutes({
			route,
			patchPath: '/nonexistent-patch-for-this-test.yml',
			authPath: s.filePath,
			readMcpRows: () => ({
				rows: [{
					id: 'row-h', enabled: true, editable: true,
					config: { transport: 'streamable-http', url: serverUrl, serverName: 'row-h' },
				}],
				rawSecrets: new Map(),
			}),
			writeJson,
			authProviderFor: () => provider,
		}))

		const statusRoute = routes.find((r) => r.path.endsWith('/oauth/status'))
		assert.ok(statusRoute, '应注册 /oauth/status 路由')

		const res = {}
		const req = new EventEmitter()
		req.method = 'GET'
		req.url = '/api/dsh-mcp-skill-hub/oauth/status?id=row-h'
		await statusRoute.handler(req, res)

		assert.equal(state.tokenCalls, 1, 'status 轮询必须触发一次续期')
		assert.equal(res.status, 200)
		assert.equal(res.body.status, 'authenticated', `续期后状态应为 authenticated, 实得 ${res.body.status}`)
		assert.equal(res.body.hasTokens, true)
		assert.ok(res.body.expiresAt > Math.floor(Date.now() / 1000), 'expiresAt 应在未来')
	} finally {
		server.close(); s.cleanup()
	}
})
