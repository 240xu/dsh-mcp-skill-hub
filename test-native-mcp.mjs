/**
 * 原生 MCP 连接层 —— 免 patch 重构的核心(铁律 9 先红后绿)。
 *
 * 背景(2026-11-08, 竞品调研后发现):
 *   本插件此前为了让 MCP 支持 OAuth, 会改写官方 `@deepseek-ai/dsh-mcp-client`
 *   的编译产物(seam patch): 在 `createTransport` 签名里加 authProvider 参数,
 *   把 provider 透传给 SDK 的 StreamableHTTPClientTransport。
 *
 *   竞品 `@guilduo/dsh-oauth-poc` 证明这条路**根本不需要**:
 *   官方 SDK 的 `StreamableHTTPClientTransport` 本来就接受 `authProvider`,
 *   而 dsh-mcp-client 公开导出了 `createMcpToolDefinition(ctx, {...})` 用来把
 *   上游 MCP 工具转成 dsh 的 ToolDefinition。只要自己起 Client + transport,
 *   自己 `ctx.tools.register(...)`, 就完全不碰官方文件。
 *
 *   收益: dsh 升级永远不会让 OAuth 失效; 卸载不需要还原任何东西。
 *
 * 本模块只负责「连接 + 工具注册」这一层, 不含 UI 与 OAuth 路由。
 *
 * 运行: node --test test-native-mcp.mjs
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HERE = import.meta.dirname
const mod = await import(join(HERE, 'lib', 'native-mcp.js'))

test('模块可加载且导出被测函数', () => {
	for (const fn of ['buildToolOptions', 'publicToolName', 'normalizeListedTools', 'createNativeSession']) {
		assert.equal(typeof mod[fn], 'function', `导出缺失: ${fn}`)
	}
})

// ── 工具名规范化 ──────────────────────────────────────────────────────
// dsh 的 ToolRuntime 对公开名有硬约束(64 字符, [A-Za-z0-9_-]), 且要求
// mcp__<server>__<raw> 形态。MCP 上游的 tool 名不受这些限制, 必须归一化,
// 并且不同身份绝不能撞名(撞名会让后注册的把先注册的顶掉)。

test('publicToolName: 干净输入 → 直接拼接', () => {
	assert.equal(mod.publicToolName('exa', 'search'), 'mcp__exa__search')
})

test('publicToolName: 非法字符替换为下划线, 且因有损而附哈希', () => {
	const got = mod.publicToolName('my server', 'do.thing')
	// 归一化是有损的(`a.b` 与 `a_b` 会撞), 故必须带身份哈希后缀
	assert.match(got, /^mcp__my_server__do_thing_[0-9a-f]{12}$/, `实得 ${got}`)
	assert.ok(got.length <= 64)
})

test('publicToolName: 超长时截断并附哈希, 保持 <= 64 且仍可区分', () => {
	const long = 'x'.repeat(80)
	const a = mod.publicToolName('srv', long + 'A')
	const b = mod.publicToolName('srv', long + 'B')
	assert.ok(a.length <= 64, `长度应 <= 64, 实得 ${a.length}`)
	assert.ok(b.length <= 64)
	assert.notEqual(a, b, '截断后不同身份不得撞名')
})

test('publicToolName: 归一化后相同但原始不同 → 仍能区分', () => {
	const a = mod.publicToolName('s', 'a.b')
	const b = mod.publicToolName('s', 'a_b')
	// a.b 与 a_b 归一化后都是 a_b; 必须靠哈希后缀区分, 否则后注册者覆盖前者
	assert.notEqual(a, b, '归一化碰撞必须靠哈希消解')
})

// ── 工具列表规范化 ────────────────────────────────────────────────────

test('normalizeListedTools: 过滤掉没有名字的条目, 保留 schema', () => {
	const listed = [
		{ name: 'search', description: 'Search', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } },
		{ name: '', description: 'broken' },
		{ description: 'nameless' },
		{ name: 'fetch', inputSchema: { type: 'object' } },
	]
	const out = mod.normalizeListedTools('srv', listed)
	assert.equal(out.length, 2)
	assert.deepEqual(out.map((t) => t.rawName), ['search', 'fetch'])
	assert.equal(out[0].publicName, 'mcp__srv__search')
	assert.equal(out[0].description, 'Search')
	assert.deepEqual(out[0].inputSchema, { type: 'object', properties: { q: { type: 'string' } } })
})

test('normalizeListedTools: description 缺失时给空串而不是 undefined', () => {
	const out = mod.normalizeListedTools('srv', [{ name: 'x' }])
	assert.equal(out[0].description, '')
	assert.deepEqual(out[0].inputSchema, { type: 'object', properties: {} })
})

// ── buildToolOptions ──────────────────────────────────────────────────

test('buildToolOptions: 产出 createMcpToolDefinition 需要的形状, call 转给 session', async () => {
	let called = null
	const session = {
		callTool: async (rawName, args, execution) => { called = { rawName, args, execution }; return { content: [] } },
	}
	const opts = mod.buildToolOptions({
		ctx: {},
		session,
		tool: { rawName: 'search', publicName: 'mcp__srv__search', description: 'd', inputSchema: { type: 'object' }, outputSchema: undefined },
		serverName: 'srv',
	})
	assert.equal(opts.name, 'mcp__srv__search')
	assert.equal(opts.rawName, 'search')
	assert.equal(opts.description, 'd')
	assert.deepEqual(opts.inputSchema, { type: 'object' })
	const exec = { signal: null }
	await opts.call({ q: 'x' }, exec)
	assert.deepEqual(called, { rawName: 'search', args: { q: 'x' }, execution: exec })
})

test('buildToolOptions: taskRequired 透传(上游声明需要 task 扩展时报错而非静默)', () => {
	const opts = mod.buildToolOptions({
		ctx: {}, session: { callTool: async () => ({}) },
		tool: { rawName: 't', publicName: 'mcp__s__t', description: '', inputSchema: {}, taskRequired: true },
		serverName: 's',
	})
	assert.equal(opts.taskRequired, true)
})

// ── 端到端: 真实 HTTP MCP 服务器 + 真实注册 ──────────────────────────

/** 起一个最小 MCP streamable-http 服务器(initialize / tools/list / tools/call)。 */
function startMcpServer({ requireAuth = null } = {}) {
	return new Promise((resolve) => {
		const seen = { initialized: 0, listed: 0, called: [] }
		const server = createServer((req, res) => {
			let body = ''
			req.on('data', (c) => { body += c })
			req.on('end', () => {
				if (requireAuth) {
					const got = req.headers.authorization
					if (got !== `Bearer ${requireAuth}`) {
						res.writeHead(401, {
							'content-type': 'application/json',
							'www-authenticate': `Bearer resource_metadata="http://127.0.0.1:${server.address().port}/.well-known/oauth-protected-resource"`,
						})
						res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'unauthorized' }, id: null }))
						return
					}
				}
				let msg
				try { msg = JSON.parse(body) } catch { res.writeHead(400); res.end(); return }
				const reply = (result) => {
					res.writeHead(200, { 'content-type': 'application/json' })
					res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }))
				}
				if (msg.method === 'initialize') {
					seen.initialized += 1
					reply({
						protocolVersion: '2025-06-18',
						capabilities: { tools: {} },
						serverInfo: { name: 'test-mcp', version: '1.0.0' },
					})
					return
				}
				if (msg.method === 'notifications/initialized') { res.writeHead(202); res.end(); return }
				if (msg.method === 'tools/list') {
					seen.listed += 1
					reply({
						tools: [
							{
								name: 'echo',
								description: 'Echo back the input',
								inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
							},
						],
					})
					return
				}
				if (msg.method === 'tools/call') {
					seen.called.push({ name: msg.params.name, args: msg.params.arguments })
					reply({ content: [{ type: 'text', text: `echo:${msg.params.arguments?.text ?? ''}` }] })
					return
				}
				res.writeHead(404); res.end()
			})
		})
		server.listen(0, '127.0.0.1', () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}/mcp` }))
	})
}

/** 最小的 ctx 假体: 只提供 native-mcp 需要的 tools.register / logger。 */
function fakeCtx() {
	const registered = new Map()
	return {
		registered,
		ctx: {
			logger: { info() {}, warn() {}, error() {} },
			tools: {
				register(def) {
					registered.set(def.name, def)
					return () => registered.delete(def.name)
				},
			},
			get() { return undefined },
		},
	}
}

test('端到端: 连上真实 MCP 服务器并注册工具, 且能调用', async () => {
	const { server, seen, url } = await startMcpServer()
	const { ctx, registered } = fakeCtx()
	const s = mod.createNativeSession({ ctx, serverName: 'test', serverUrl: url })
	try {
		const tools = await s.connect()
		assert.equal(seen.initialized, 1, '应完成一次 initialize')
		assert.equal(tools.length, 1, '应发现 1 个工具')
		assert.ok(registered.has('mcp__test__echo'), `应注册 mcp__test__echo, 实得 ${[...registered.keys()]}`)

		const def = registered.get('mcp__test__echo')
		const r = await def.execute({ text: 'hi' }, { signal: null })
		assert.equal(seen.called.length, 1, '应真的调用了上游 tools/call')
		assert.equal(seen.called[0].name, 'echo')
		assert.deepEqual(seen.called[0].args, { text: 'hi' })
		assert.ok(r, 'execute 必须返回结果')
	} finally {
		await s.close()
		server.close()
	}
})

test('端到端: close() 之后工具被注销, 不留悬挂注册', async () => {
	const { server, url } = await startMcpServer()
	const { ctx, registered } = fakeCtx()
	const s = mod.createNativeSession({ ctx, serverName: 'test', serverUrl: url })
	try {
		await s.connect()
		assert.equal(registered.size, 1)
	} finally {
		await s.close()
		server.close()
	}
	assert.equal(registered.size, 0, 'close 必须注销全部工具')
})

test('端到端: 401 服务器 → 连接失败但不抛未捕获异常, 且给出可识别错误', async () => {
	const { server, url } = await startMcpServer({ requireAuth: 'secret' })
	const { ctx } = fakeCtx()
	const s = mod.createNativeSession({ ctx, serverName: 'auth', serverUrl: url })
	try {
		await assert.rejects(
			() => s.connect(),
			(err) => {
				assert.ok(err, '应抛出错误对象')
				// 错误里绝不能出现 token 值(铁律 6)
				assert.doesNotMatch(String(err.message), /secret/)
				return true
			}
		)
	} finally {
		await s.close().catch(() => {})
		server.close()
	}
})

test('端到端: 带 authProvider 时会把 token 放进 Authorization 头', async () => {
	const { server, seen, url } = await startMcpServer({ requireAuth: 'tok-123' })
	const { ctx } = fakeCtx()
	const s = mod.createNativeSession({
		ctx,
		serverName: 'authed',
		serverUrl: url,
		authProvider: {
			tokens: () => ({ access_token: 'tok-123', token_type: 'Bearer' }),
			clientInformation: () => ({ client_id: 'c1' }),
			redirectUrl: 'http://127.0.0.1:0/mcp/oauth/callback',
		},
	})
	try {
		const tools = await s.connect()
		assert.equal(seen.initialized, 1, '带 token 应能完成 initialize')
		assert.equal(tools.length, 1)
	} finally {
		await s.close()
		server.close()
	}
})

// ── 错误信息纪律 ─────────────────────────────────────────────────────

test('错误信息不得含 URL 的 query/fragment(可能带 token)', () => {
	const msg = mod.safeEndpointLabel('https://h.test/mcp?token=SECRETVALUE#frag')
	assert.doesNotMatch(msg, /SECRETVALUE/, '不得泄露 query 里的 token')
	assert.match(msg, /h\.test/, '应保留主机名以便排查')
})
