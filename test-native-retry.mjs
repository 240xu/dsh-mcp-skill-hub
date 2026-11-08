/**
 * 原生 MCP 重连策略(铁律 9: 先红后绿)。
 *
 * 本次目的是把「一次网络抖动 → 工具永久消失」修成「自动退避重连」，
 * 同时保证鉴权错误**不**被无意义地重试。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'

const mod = await import(join(import.meta.dirname, 'lib', 'native-retry.js'))

test('导出被测函数', () => {
	for (const fn of ['isRetriable', 'backoffDelay', 'describeRetry']) {
		assert.equal(typeof mod[fn], 'function', `缺导出: ${fn}`)
	}
})

test('isRetriable: 401/403 不重试(需人工授权)', () => {
	assert.equal(mod.isRetriable(Object.assign(new Error('x'), { status: 401 })), false)
	assert.equal(mod.isRetriable(Object.assign(new Error('x'), { status: 403 })), false)
})

test('isRetriable: SDK UnauthorizedError 不重试', () => {
	const e = new Error('no token')
	e.name = 'UnauthorizedError'
	assert.equal(mod.isRetriable(e), false)
})

test('isRetriable: InsufficientScopeError 不重试', () => {
	const e = new Error('scope')
	e.name = 'InsufficientScopeError'
	assert.equal(mod.isRetriable(e), false)
	assert.equal(mod.isRetriable({ name: 'InsufficientScopeError' }), false)
})

test('isRetriable: 顶层 fetch failed 但 cause 是 401 → 仍不重试(回归)', () => {
	// 真实形态: SDK 收到 401 后先试 OAuth discovery, discovery 失败 →
	// 顶层包成 `fetch failed`, 原始 401 藏在 cause 里。只看顶层会无限重试
	// 一个「需要人工授权」的连接。
	const inner = Object.assign(new Error('Error POSTing to endpoint'), { status: 401, name: 'SdkHttpError' })
	const outer = new Error('fetch failed')
	outer.cause = inner
	assert.equal(mod.isRetriable(outer), false)
})

test('isRetriable: 多层嵌套的 403 也能识别', () => {
	const a = Object.assign(new Error('x'), { status: 403 })
	const b = new Error('fetch failed'); b.cause = a
	const c = new Error('wrapped'); c.cause = b
	assert.equal(mod.isRetriable(c), false)
})

test('isRetriable: 网络抖动/中止/超时要重试', () => {
	assert.equal(mod.isRetriable(new Error('This operation was aborted')), true)
	assert.equal(mod.isRetriable(new Error('fetch failed')), true)
	assert.equal(mod.isRetriable(new Error('ECONNRESET')), true)
	assert.equal(mod.isRetriable(new Error('socket hang up')), true)
	assert.equal(mod.isRetriable(new Error('timed out after 20000ms')), true)
})

test('isRetriable: 地址解析失败不重试(配置错误)', () => {
	assert.equal(mod.isRetriable(new Error('getaddrinfo ENOTFOUND nope.invalid')), false)
	assert.equal(mod.isRetriable(new Error('invalid url')), false)
})

test('isRetriable: 5xx 要重试, 4xx(非 401/403)不重试', () => {
	assert.equal(mod.isRetriable(Object.assign(new Error('x'), { status: 500 })), true)
	assert.equal(mod.isRetriable(Object.assign(new Error('x'), { status: 502 })), true)
	assert.equal(mod.isRetriable(Object.assign(new Error('x'), { status: 404 })), false)
	assert.equal(mod.isRetriable(Object.assign(new Error('x'), { status: 400 })), false)
})

test('isRetriable: 未知错误倾向重试', () => {
	assert.equal(mod.isRetriable(new Error('something weird')), true)
	assert.equal(mod.isRetriable(null), true)
})

test('backoffDelay: 指数增长且封顶', () => {
	// 用固定 random=1 消除抖动, 看纯上界
	const fixed = { random: () => 1, baseMs: 1000, maxMs: 8000 }
	assert.equal(mod.backoffDelay(0, fixed), 999)   // [0,1000) 上界
	assert.equal(mod.backoffDelay(1, fixed), 1999)  // [0,2000)
	assert.equal(mod.backoffDelay(2, fixed), 3999)  // [0,4000)
	assert.equal(mod.backoffDelay(3, fixed), 7999)  // [0,8000)
	assert.equal(mod.backoffDelay(4, fixed), 7999)  // 封顶, 不再增长
	assert.equal(mod.backoffDelay(50, fixed), 7999)
})

test('backoffDelay: 抖动使同时失败的多行错开', () => {
	let i = 0
	const seq = [0.1, 0.9, 0.5]
	const rnd = () => seq[i++ % seq.length]
	const a = mod.backoffDelay(3, { baseMs: 1000, maxMs: 100000, random: rnd })
	const b = mod.backoffDelay(3, { baseMs: 1000, maxMs: 100000, random: rnd })
	assert.notEqual(a, b, '同样的 attempt 应因抖动得到不同延迟')
})

test('backoffDelay: 非法 attempt 退化为 0 次', () => {
	assert.equal(mod.backoffDelay(-5, { baseMs: 1000, maxMs: 8000, random: () => 1 }), 999)
	assert.equal(mod.backoffDelay(undefined, { baseMs: 1000, maxMs: 8000, random: () => 1 }), 999)
	assert.equal(mod.backoffDelay('abc', { baseMs: 1000, maxMs: 8000, random: () => 1 }), 999)
})

test('describeRetry: 含秒数与错误摘要, 供 /state 展示', () => {
	const s = mod.describeRetry({ attempt: 2, nextDelayMs: 4000, error: new Error('boom') })
	assert.match(s, /attempt 3/)
	assert.match(s, /4s/)
	assert.match(s, /boom/)
})
