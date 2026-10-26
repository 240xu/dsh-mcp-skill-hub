/**
 * YAML 块解析回归 —— 两个 P0 的「先红后绿」用例(铁律 9)。
 *
 * 背景: 0.3.3 逐字审核时由并行子代理报出、主会话逐项复现确认:
 *
 *   P0-A scanMcpBlocks: flow 深度计数把**注释里未闭合的括号**算进去。
 *        patch 中任意 MCP 行之前出现 `# TODO[ revisit` 这样的注释,
 *        depth 永不为 0 → before > 0 → 所有 `- id:` 行被 continue 跳过
 *        → **所有 MCP 行从 UI 消失, 且无法增删改**。
 *        修复前本测试第 1 组为红, 修复后转绿。
 *
 *   P0-B parseBlockFields: `headers:` 等 map 开启后, 遇到 config 内的
 *        下一个顶层标量键(reconnect: / enabled: / url:)不退出 map 态,
 *        把这些键**吞进 headers map**, 同时 out.url / out.enabled 丢失。
 *        保存时 buildRowLines 会把它们写成 headers 的子键 → MCP 行
 *        URL 改变、未知字段错位。修复前第 2 组为红。
 *
 * 运行: node --test test-yaml-block-parse.mjs
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SRC = readFileSync(new URL('./lib/index.js', import.meta.url), 'utf8')

const MCP_NAME = "'@deepseek-ai/dsh-mcp-client'"
const row = (id, extra) => [
	`- id: ${id}`,
	`  name: ${MCP_NAME}`,
	'  config:',
	...extra,
]

test('模块可加载且 __internals 导出被测函数', async () => {
	const mod = await import(new URL('./lib/index.js', import.meta.url).href)
	assert.equal(typeof mod.__internals, 'object')
	for (const fn of ['scanMcpBlocks', 'parseBlockFields', 'buildRowLines']) {
		assert.equal(typeof mod.__internals[fn], 'function', `__internals.${fn} 缺失`)
	}
})

// ── P0-A: 注释里的未闭合括号不得吞掉 MCP 行 ────────────────────
test('P0-A: 注释含未闭合 "[" 时 MCP 行仍全部可见', async () => {
	const { scanMcpBlocks } = (await import(new URL('./lib/index.js', import.meta.url).href)).__internals
	const body = [
		...row('mcp-a', ['    transport: stdio', '    command: uvx']),
		...row('mcp-b', ['    transport: streamable-http', '    url: https://x.example.com/mcp']),
	]
	assert.equal(scanMcpBlocks(body).length, 2, '基线: 无注释时应扫到 2 行')

	for (const comment of ['# TODO[ revisit later', '# see [docs', '# arr[0]', '# NOTE{ unclosed']) {
		const withComment = [comment, ...body]
		const n = scanMcpBlocks(withComment).length
		assert.equal(n, 2, `注释 ${JSON.stringify(comment)} 导致 MCP 行从 ${2} 变成 ${n}`)
	}
})

test('P0-A: 注释出现在两个 MCP 行之间也不影响第二行', async () => {
	const { scanMcpBlocks } = (await import(new URL('./lib/index.js', import.meta.url).href)).__internals
	const lines = [
		...row('mcp-a', ['    transport: stdio', '    command: uvx']),
		'  # TODO[ remember to fix',
		...row('mcp-b', ['    transport: streamable-http', '    url: https://x.example.com/mcp']),
	]
	const blocks = scanMcpBlocks(lines)
	assert.equal(blocks.length, 2, `期望 2 行, 实际 ${blocks.length}`)
	assert.deepEqual(blocks.map((b) => b.id).sort(), ['mcp-a', 'mcp-b'])
})

// ── P0-B: map 开启后遇到下一个顶层键必须退出 map 态 ────────────
test('P0-B: headers 后的未知嵌套块不得吞掉 url / enabled', async () => {
	const { parseBlockFields } = (await import(new URL('./lib/index.js', import.meta.url).href)).__internals
	const block = [
		'- id: mcp-a',
		`  name: ${MCP_NAME}`,
		'  config:',
		'    transport: streamable-http',
		'    url: https://leak.example.com/mcp',
		'    headers:',
		'      Authorization: Bearer real-token',
		'    reconnect:',
		'      enabled: true',
		'      delayMs: 500',
		'    enabled: true',
	]
	const f = parseBlockFields(block)
	assert.equal(f.url, 'https://leak.example.com/mcp', 'url 丢失 —— 保存后会改写 MCP 连接目标')
	// 注意: 行级启停不是 config 内的 `enabled:`, 而是块级 `disabled:`
	// (buildRowLines 的 enabled 是独立入参)。所以这里断言的是
	// 「reconnect 子级那个 enabled 不许被当成 header」, 而不是 out.enabled。
	assert.equal(f.disabled, false, '块级 disabled 不应被嵌套键污染')
	assert.deepEqual(
		Object.keys(f.headers).sort(),
		['Authorization'],
		`headers 混入了非 header 键: ${Object.keys(f.headers).join(', ')}`
	)
	assert.equal(f.headers.Authorization, 'Bearer real-token', '真实 header 值本身不能丢')
})

test('P0-B: headers 在 url 之前时 url 同样不得丢失', async () => {
	const { parseBlockFields } = (await import(new URL('./lib/index.js', import.meta.url).href)).__internals
	const block = [
		'- id: mcp-a',
		`  name: ${MCP_NAME}`,
		'  config:',
		'    transport: streamable-http',
		'    headers:',
		'      Authorization: Bearer t',
		'    toolCallTimeoutMs: 30000',
		'    url: https://after.example.com/mcp',
	]
	const f = parseBlockFields(block)
	assert.equal(f.url, 'https://after.example.com/mcp', 'map 后的 url 必须被解析为顶层字段')
	assert.deepEqual(Object.keys(f.headers).sort(), ['Authorization'])
})

test('P0-B: env map 后的未知键同样不得被吞', async () => {
	const { parseBlockFields } = (await import(new URL('./lib/index.js', import.meta.url).href)).__internals
	const block = [
		'- id: mcp-a',
		`  name: ${MCP_NAME}`,
		'  config:',
		'    transport: stdio',
		'    command: uvx',
		'    env:',
		'      API_KEY: sk-x',
		'    cwd: /tmp/work',
		'    args:',
		'      - --flag',
	]
	const f = parseBlockFields(block)
	assert.deepEqual(f.env, { API_KEY: 'sk-x' }, `env 混入了 ${Object.keys(f.env).join(', ')}`)
	assert.equal(f.cwd, '/tmp/work', 'cwd 丢失')
	assert.deepEqual(f.args, ['--flag'], 'args 丢失')
})

test('P0-B: 未知嵌套块本身必须保留在 extraLines(回写不丢配置)', async () => {
	const { parseBlockFields } = (await import(new URL('./lib/index.js', import.meta.url).href)).__internals
	const block = [
		'- id: mcp-a',
		`  name: ${MCP_NAME}`,
		'  config:',
		'    transport: streamable-http',
		'    url: https://x.example.com/mcp',
		'    headers:',
		'      Authorization: Bearer t',
		'    reconnect:',
		'      enabled: true',
	]
	const f = parseBlockFields(block)
	const joined = f.extraLines.join('\n')
	assert.ok(/reconnect/.test(joined), 'reconnect 块应保留在 extraLines')
	assert.ok(/delayMs|enabled: true/.test(joined), 'reconnect 的子键应保留在 extraLines')
})

test('源码: 注释必须在校验/计数前被剥离(防复发)', () => {
	// scanMcpBlocks 与 parseBlockFields 都不能用含注释的原文做括号计数。
	// 用 stripComment 预处理是修复手段; 此断言锁定「确实调用了它」。
	const scan = SRC.slice(SRC.indexOf('function scanMcpBlocks'), SRC.indexOf('function assignFlow'))
	const parse = SRC.slice(SRC.indexOf('function parseBlockFields'), SRC.indexOf('function parseFrontmatter'))
	assert.ok(/stripComment/.test(scan), 'scanMcpBlocks 应先用 stripComment 再做括号计数')
	assert.ok(/stripComment/.test(parse), 'parseBlockFields 应先用 stripComment 再做括号计数')
})
