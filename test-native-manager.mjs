/**
 * 原生 MCP 会话管理器: 接管判据 + 退避重连(铁律 9)。
 *
 * 这层是「迁移 OAuth 行」的前置条件: 没有自动重连, 一次启动抖动就会让
 * 工具永久消失, 比 patch 方案更糟。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { join } from 'node:path'

const HERE = import.meta.dirname
const { createNativeManager } = await import(join(HERE, 'lib', 'native-mcp-manager.js'))

/** 真实最小 MCP 服务器; failFirst 指定前 N 次连接返回 503。 */
function startMcp({ failFirst = 0, tools = 1 } = {}) {
	let connects = 0
	const srv = createServer((req, res) => {
		let body = ''
		req.on('data', (c) => { body += c })
		req.on('end', () => {
			let msg
			try { msg = JSON.parse(body) } catch { res.writeHead(400); res.end(); return }
			if (msg.method === 'initialize') {
				connects += 1
				if (connects <= failFirst) {
					res.writeHead(503, { 'content-type': 'application/json' })
					res.end('{"error":"temporarily unavailable"}')
					return
				}
				res.writeHead(200, { 'content-type': 'application/json' })
				res.end(JSON.stringify({
					jsonrpc: '2.0', id: msg.id,
					result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 't', version: '1' } },
				}))
				return
			}
			if (msg.method === 'notifications/initialized') { res.writeHead(202); res.end(); return }
			if (msg.method === 'tools/list') {
				res.writeHead(200, { 'content-type': 'application/json' })
				res.end(JSON.stringify({
					jsonrpc: '2.0', id: msg.id,
					result: {
						tools: Array.from({ length: tools }, (_, i) => ({
							name: `tool${i}`, description: `T${i}`,
							inputSchema: { type: 'object', properties: {} },
						})),
					},
				}))
				return
			}
			res.writeHead(404); res.end()
		})
	})
	return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({
		srv, url: `http://127.0.0.1:${srv.address().port}/mcp`, get connects() { return connects },
	})))
}

function fakeCtx() {
	const registered = new Map()
	return {
		registered,
		ctx: {
			logger: { info() {}, warn() {}, error() {} },
			tools: { register(d) { registered.set(d.name, d); return () => registered.delete(d.name) } },
			get: () => undefined,
		},
	}
}

const row = (id, url, extra = {}) => ({
	id, enabled: false, config: { serverName: id, transport: 'streamable-http', url, ...extra },
})

test('接管判据: 只有 dsh 侧 disabled 的行才接管', async () => {
	const { srv, url } = await startMcp()
	const { ctx, registered } = fakeCtx()
	const rows = [row('a', url), { ...row('b', url), enabled: true }]
	const m = createNativeManager({ ctx, rows: () => rows, retry: { baseMs: 5, maxMs: 20 } })
	try {
		const r = await m.startAll()
		assert.deepEqual(r.active, ['a'], '只接管 disabled 行')
		assert.equal(registered.size, 1)
	} finally { await m.stopAll(); srv.close() }
})

test('接管判据: 配置里点名但 dsh 仍 enabled → 拒绝接管并报错', async () => {
	const { srv, url } = await startMcp()
	const { ctx, registered } = fakeCtx()
	const rows = [{ ...row('b', url), enabled: true }]
	const warns = []
	ctx.logger.warn = (m) => warns.push(String(m))
	const m = createNativeManager({ ctx, rows: () => rows, takeover: ['b'], retry: { baseMs: 5, maxMs: 20 } })
	try {
		const r = await m.startAll()
		assert.deepEqual(r.active, [], '不得接管')
		assert.equal(registered.size, 0, '不得注册工具')
		assert.ok(warns.some((w) => /refus/i.test(w)), '必须留下拒绝理由')
	} finally { await m.stopAll(); srv.close() }
})

test('重连: 首次 503 后自动退避重试并最终成功', async () => {
	const { srv, url, get } = await startMcp({ failFirst: 2 })
	const { ctx, registered } = fakeCtx()
	const m = createNativeManager({ ctx, rows: () => [row('a', url)], retry: { baseMs: 10, maxMs: 40 } })
	try {
		await m.startAll()
		// 等自动重连跑完。首次 connect 含模块解析(冷启动 ~1.7s), 故给足余量;
		// 解析结果有缓存, 后续重试是毫秒级。
		const deadline = Date.now() + 15000
		while (registered.size === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25))
		assert.equal(registered.size, 1, '重连后应注册工具')
		assert.ok(m.listRetrying().length === 0, '成功后不再处于重试态')
	} finally { await m.stopAll(); srv.close() }
})

test('重连: 401 不重试(需人工授权), 只尝试一次', async () => {
	let attempts = 0
	const srv = createServer((req, res) => {
		attempts += 1
		res.writeHead(401, { 'www-authenticate': 'Bearer resource_metadata="http://127.0.0.1:1/x"' })
		res.end('{"error":"unauthorized"}')
	})
	await new Promise((ok) => srv.listen(0, '127.0.0.1', ok))
	const url = `http://127.0.0.1:${srv.address().port}/mcp`
	const { ctx } = fakeCtx()
	const m = createNativeManager({ ctx, rows: () => [row('a', url)], retry: { baseMs: 5, maxMs: 20 } })
	try {
		await m.startAll()
		await new Promise((r) => setTimeout(r, 400))
		assert.equal(attempts, 1, `401 只应尝试一次, 实际 ${attempts}`)
		assert.equal(m.listRetrying().length, 0, '401 不进重试队列')
		assert.ok(m.listFailed().some((f) => f.id === 'a'), '应记为失败供 UI 展示')
	} finally { await m.stopAll(); srv.close() }
})

test('stopAll: 取消挂起的重连, 不留定时器', async () => {
	const { srv, url } = await startMcp({ failFirst: 9999 })
	const { ctx } = fakeCtx()
	const m = createNativeManager({ ctx, rows: () => [row('a', url)], retry: { baseMs: 5, maxMs: 20 } })
	await m.startAll()
	assert.ok(m.listRetrying().length > 0, '应处于重试态')
	await m.stopAll()
	assert.equal(m.listRetrying().length, 0, 'stopAll 后不得残留重试')
	srv.close()
})

test('stopAll 幂等', async () => {
	const { srv, url } = await startMcp()
	const { ctx } = fakeCtx()
	const m = createNativeManager({ ctx, rows: () => [row('a', url)], retry: { baseMs: 5, maxMs: 20 } })
	await m.startAll()
	await m.stopAll()
	await m.stopAll()
	srv.close()
})

test('reconnect: token 更新后换新连接并重新注册', async () => {
	const { srv, url } = await startMcp()
	const { ctx, registered } = fakeCtx()
	const rows = [row('a', url)]
	const m = createNativeManager({ ctx, rows: () => rows, retry: { baseMs: 5, maxMs: 20 } })
	try {
		await m.startAll()
		assert.equal(registered.size, 1)
		await m.reconnect('a')
		assert.equal(registered.size, 1, '重连后应仍有 1 个工具, 不重复')
	} finally { await m.stopAll(); srv.close() }
})
