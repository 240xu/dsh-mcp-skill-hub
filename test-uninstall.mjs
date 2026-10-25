/**
 * 卸载与还原回归 —— 「完整卸载 + 还原补丁」按钮的 TDD 用例(铁律 9)。
 *
 * 背景: 用户要求「安装会改官方配置文件, 卸载应做一个按钮, 让它安全回退到
 * 原来官方的配置」。本插件确实会改写 @deepseek-ai/dsh-mcp-client 的 bundle
 * (npm 装好后无配置可绕过), 因此卸载必须两步都做:
 *
 *   1. 还原 bundle —— 用 patch 前的必留备份(.bak-selfheal / .bak-<ts>)覆盖回去,
 *      覆盖前重新校验备份 sha256 与记录的原版 sha 一致, 不一致就**不动 bundle**。
 *      (先校验后覆盖, 否则备份损坏会把「半 patched」写死进 bundle。)
 *   2. 移除插件 —— pnpm remove(软链开发态与副本发布态都适用)。
 *
 * 另有一个死锁陷阱: 卸载动作由插件自己的 HTTP 路由触发, 而插件随后会被删掉、
 * dsh 也会被重启 —— 所以 worker 必须是**脱离插件**的独立文件(spawn detached),
 * 路由只负责响应「已启动」。
 *
 * 运行: node --test test-uninstall.mjs
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const mod = await import(new URL('./lib/uninstall.js', import.meta.url).href)

const sha256 = (s) => createHash('sha256').update(s).digest('hex')
/** 备份文件与其 sidecar 记录必须自洽: 记录值 = 文件真实 sha, 否则 backup 不可信。 */
const PRISTINE_TEXT = 'pristine-content'
const PRISTINE = sha256(PRISTINE_TEXT)

function tmp() {
	return mkdtempSync(join(tmpdir(), 'hub-uninstall-'))
}

function fakeBundle(dir, content) {
	const pkg = join(dir, 'lib')
	mkdirSync(pkg, { recursive: true })
	const bundle = join(pkg, 'index.js')
	writeFileSync(bundle, content)
	return bundle
}

test('模块可加载且导出被测函数', async () => {
	for (const fn of ['findPristineBackups', 'planUninstall', 'buildWorkerArgs', 'buildWorkerSource', 'parseWorkerLog']) {
		assert.equal(typeof mod[fn], 'function', `导出缺失: ${fn}`)
	}
	assert.equal(typeof mod.registerUninstallRoutes, 'function', 'registerUninstallRoutes 缺失')
})

// ── findPristineBackups ───────────────────────────────────────────────

test('findPristineBackups: 识别两类备份, 排除 sidecar 与无关文件, 按 mtime 新的在前', () => {
	const d = tmp()
	const bundle = fakeBundle(d, 'patched')
	const old = `${bundle}.bak-20260101T000000Z`
	const neo = `${bundle}.bak-20261025T000000Z`
	const self = `${bundle}.bak-selfheal`
	writeFileSync(old, PRISTINE_TEXT)
	writeFileSync(neo, PRISTINE_TEXT)
	writeFileSync(self, PRISTINE_TEXT)
	// sidecar 记录的是真实 sha(与备份内容自洽), 否则备份被判不可信
	writeFileSync(`${old}.sha256`, `${PRISTINE}  ${old}\n`)
	writeFileSync(`${neo}.sha256`, `${PRISTINE}  ${neo}\n`)
	writeFileSync(`${self}.sha256`, `${PRISTINE}  ${self}\n`)
	writeFileSync(`${bundle}.unrelated`, 'x')
	// 让 mtime 与语义上的「新」一致, 使排序断言稳定
	const { utimesSync } = require('node:fs')
	utimesSync(old, new Date(1e12), new Date(1e12))
	utimesSync(neo, new Date(2e12), new Date(2e12))
	utimesSync(self, new Date(15e11), new Date(15e11))

	const got = mod.findPristineBackups(bundle)
	assert.equal(got.length, 3, '应找到 3 个备份(排除 .sha256 sidecar 与 .unrelated)')
	for (const b of got) {
		assert.equal(b.kind === 'selfheal' || b.kind === 'timestamped', true, `未知备份类型: ${b.kind}`)
		assert.equal(b.recordedSha, PRISTINE, '应读出 sidecar 记录的原版 sha')
		assert.equal(b.trustworthy, true, '内容与记录自洽 → 可信')
	}
	assert.deepEqual(got.map((b) => b.path), [neo, self, old], '应按 mtime 新的在前')
	rmSync(d, { recursive: true, force: true })
})

test('findPristineBackups: 无备份时返回空数组(不抛)', () => {
	const d = tmp()
	const bundle = fakeBundle(d, 'patched')
	assert.deepEqual(mod.findPristineBackups(bundle), [])
	rmSync(d, { recursive: true, force: true })
})

// ── planUninstall ─────────────────────────────────────────────────────

function planFixture(over = {}) {
	const d = tmp()
	const bundle = fakeBundle(d, over.bundleContent ?? 'patched')
	const backup = `${bundle}.bak-20261025T000000Z`
	if (over.withBackup !== false) {
		writeFileSync(backup, PRISTINE_TEXT)
		writeFileSync(`${backup}.sha256`, `${PRISTINE}  ${backup}\n`)
	}
	const profileDir = join(d, 'profile')
	mkdirSync(profileDir, { recursive: true })
	const linked = join(profileDir, 'node_modules', 'dsh-mcp-skill-hub')
	if (over.link !== false) {
		mkdirSync(join(profileDir, 'node_modules'), { recursive: true })
		require('node:fs').symlinkSync(over.linkTarget ?? '/somewhere/dsh-mcp-skill-hub', linked)
	}
	const plan = mod.planUninstall({
		bundlePath: bundle,
		profileDir,
		packageName: 'dsh-mcp-skill-hub',
		...over.planOpts,
	})
	return { d, bundle, backup, plan }
}

test('planUninstall: 给出还原目标与完整计划, 无阻断项', () => {
	const { plan, backup } = planFixture()
	assert.equal(plan.canRestore, true)
	assert.deepEqual(plan.blockers, [])
	assert.equal(plan.restoreTarget.path, backup)
	assert.equal(plan.restoreTarget.sha, PRISTINE)
	assert.equal(plan.bundle.patched, true)
	assert.equal(plan.plugin.installMode, 'link')
	assert.equal(plan.plugin.packageName, 'dsh-mcp-skill-hub')
	assert.ok(Array.isArray(plan.steps) && plan.steps.length >= 2, '至少两步: 还原 bundle + 移除插件')
})

test('planUninstall: 无备份 → canRestore=false 且带阻断项(不得让用户点下去)', () => {
	const { plan } = planFixture({ withBackup: false })
	assert.equal(plan.canRestore, false)
	assert.equal(plan.restoreTarget, null)
	assert.ok(plan.blockers.length >= 1)
	assert.match(plan.blockers.join(' '), /备份/)
})

test('planUninstall: bundle 已是原版(未打过补丁)时如实报告', () => {
	const { plan } = planFixture({ bundleContent: PRISTINE_TEXT })
	// 备份内容就是 PRISTINE_TEXT, 与 bundle 相同 → 未 patch
	assert.equal(plan.bundle.patched, false)
	assert.equal(plan.canRestore, true)
})

test('planUninstall: 备份 sha 与 bundle 侧记录不符时如实暴露(不静默采用)', () => {
	const d = tmp()
	const bundle = fakeBundle(d, 'patched')
	const backup = `${bundle}.bak-20261025T000000Z`
	writeFileSync(backup, 'corrupt-content')
	writeFileSync(`${backup}.sha256`, `${'c'.repeat(64)}  ${backup}\n`)
	const plan = mod.planUninstall({ bundlePath: bundle, profileDir: d, packageName: 'dsh-mcp-skill-hub' })
	// 计划仍可算, 但 restoreTarget 不得指向这个不可信备份
	assert.equal(plan.restoreTarget, null, '备份内容与记录 sha 不符, 不得作为还原目标')
	assert.ok(plan.blockers.some((b) => /sha/.test(b)), `应有 sha 不符的阻断项, 实得: ${JSON.stringify(plan.blockers)}`)
	rmSync(d, { recursive: true, force: true })
})

// ── worker 源与参数 ───────────────────────────────────────────────────

test('buildWorkerArgs: 只携带白名单字段, confirm 令牌不透传给 worker', () => {
	const args = mod.buildWorkerArgs({
		bundlePath: '/b/index.js',
		backupPath: '/b/index.js.bak-1',
		pristineSha: PRISTINE,
		profileDir: '/p',
		packageName: 'dsh-mcp-skill-hub',
		removePlugin: true,
		restartDsh: true,
		logPath: '/tmp/x.log',
		confirm: 'UNINSTALL',
		evil: 'should-not-pass',
	})
	assert.equal(args.bundlePath, '/b/index.js')
	assert.equal(args.pristineSha, PRISTINE)
	assert.equal(args.removePlugin, true)
	assert.equal(args.restartDsh, true)
	assert.equal('confirm' in args, false, 'confirm 只用于路由层鉴权, 不进 worker')
	assert.equal('evil' in args, false, '不得透传未列白字段')
})

test('buildWorkerSource: 独立 CJS, 不 import 插件, 含安全闸门', () => {
	const src = mod.buildWorkerSource()
	assert.match(src, /require\(['"]node:fs['"]\)/, 'worker 只应依赖 node 内置模块')
	assert.doesNotMatch(src, /lib\/uninstall\.js|from ['"]\.\/.*['"]/, 'worker 不得引用插件模块(插件随后会被删)')
	assert.match(src, /pristineSha/, '必须按 sha 校验')
	assert.match(src, /renameSync/, '必须原子替换(临时文件 + rename)')
	assert.match(src, /SIGTERM|kill\(/, '重启 dsh 用信号而非再次 spawn')
	assert.match(src, /process\.argv\[2\]/, '参数经 argv 传入')
	assert.doesNotMatch(src, /accessToken|client_secret|code_verifier/, 'worker 不得接触凭据字段')
})

// ── worker 端到端(真跑) ───────────────────────────────────────────────

function runWorker(args) {
	const dir = tmp()
	const worker = join(dir, 'worker.cjs')
	writeFileSync(worker, mod.buildWorkerSource())
	const log = join(dir, 'worker.log')
	const full = { logPath: log, removePlugin: false, restartDsh: false, ...args }
	let code = 0
	try {
		execFileSync(process.execPath, [worker, JSON.stringify(full)], {
			stdio: 'pipe', timeout: 60000, encoding: 'utf8',
		})
	} catch (e) {
		code = typeof e.status === 'number' ? e.status : -1
	}
	const logText = existsSync(log) ? readFileSync(log, 'utf8') : ''
	return { code, log: logText, steps: mod.parseWorkerLog(logText), dir }
}

test('worker 端到端: 备份可信 → 还原 + 校验 + 记录步骤', () => {
	const d = tmp()
	const bundle = fakeBundle(d, 'patched-content')
	const backup = `${bundle}.bak-20261025T000000Z`
	writeFileSync(backup, PRISTINE_TEXT)
	writeFileSync(`${backup}.sha256`, `${PRISTINE}  ${backup}\n`)
	const r = runWorker({ bundlePath: bundle, backupPath: backup, pristineSha: PRISTINE, profileDir: d })
	assert.equal(r.code, 0, `worker 应成功退出, 日志: ${r.log}`)
	assert.equal(readFileSync(bundle, 'utf8'), PRISTINE_TEXT, 'bundle 应被还原为原版')
	const ids = r.steps.map((s) => s.step)
	assert.ok(ids.includes('restore-bundle'), `应有 restore-bundle 步骤, 实得 ${JSON.stringify(r.steps)}`)
	assert.equal(r.steps.at(-1).ok, true, '末步应为成功')
	for (const s of r.steps) assert.equal(s.ok, true, `步骤 ${s.step} 应成功: ${JSON.stringify(s)}`)
	rmSync(d, { recursive: true, force: true })
	rmSync(r.dir, { recursive: true, force: true })
})

test('worker 端到端: 备份 sha 不符 → 拒绝覆盖, bundle 保持原样', () => {
	const d = tmp()
	const bundle = fakeBundle(d, 'patched-content')
	const backup = `${bundle}.bak-20261025T000000Z`
	writeFileSync(backup, 'corrupt-content')
	writeFileSync(`${backup}.sha256`, `${PRISTINE}  ${backup}\n`) // 记录是 PRISTINE, 实际不是
	const r = runWorker({ bundlePath: bundle, backupPath: backup, pristineSha: PRISTINE, profileDir: d })
	assert.notEqual(r.code, 0, '备份不可信必须失败退出')
	assert.equal(readFileSync(bundle, 'utf8'), 'patched-content', 'bundle 不得被不可信备份覆盖')
	assert.match(r.log, /sha|mismatch|不符/, '日志应说明是 sha 校验失败')
	rmSync(d, { recursive: true, force: true })
	rmSync(r.dir, { recursive: true, force: true })
})

test('worker 端到端: 备份文件缺失 → 失败且不创建半成品', () => {
	const d = tmp()
	const bundle = fakeBundle(d, 'patched-content')
	const r = runWorker({
		bundlePath: bundle,
		backupPath: `${bundle}.bak-does-not-exist`,
		pristineSha: PRISTINE,
		profileDir: d,
	})
	assert.notEqual(r.code, 0)
	assert.equal(readFileSync(bundle, 'utf8'), 'patched-content')
	assert.ok(existsSync(`${bundle}.tmp`) === false || existsSync(`${bundle}.tmp`) === false, '不得留下临时文件')
	rmSync(d, { recursive: true, force: true })
	rmSync(r.dir, { recursive: true, force: true })
})

test('parseWorkerLog: 解析 JSON 行, 忽略噪声行', () => {
	const log = [
		'noise line',
		JSON.stringify({ step: 'restore-bundle', ok: true, at: 1 }),
		JSON.stringify({ step: 'verify-restore', ok: true, at: 2 }),
		'{"step":"truncated"',
	].join('\n')
	const steps = mod.parseWorkerLog(log)
	assert.equal(steps.length, 2)
	assert.deepEqual(steps.map((s) => s.step), ['restore-bundle', 'verify-restore'])
})

// ── 路由层 ────────────────────────────────────────────────────────────

function routeHarness(over = {}) {
	const routes = []
	const seen = []
	const writeJson = (res, status, body) => {
		res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
		res.end(JSON.stringify(body))
	}
	const route = (path, method, handler) => ({
		kind: 'exact',
		path,
		handler: async (req, res) => {
			if ((req?.socket?.remoteAddress ?? '127.0.0.1') !== '127.0.0.1') return writeJson(res, 403, { error: 'forbidden' })
			if (req.method !== method) return writeJson(res, 405, { error: 'method not allowed' })
			try { await handler(req, res) } catch (e) {
				if (!res.headersSent) writeJson(res, e?.status || 500, { error: String(e?.message || e) })
			}
		},
	})
	const registered = mod.registerUninstallRoutes({
		route,
		plan: () => over.plan ?? {
			canRestore: true,
			blockers: [],
			steps: [],
			bundle: { path: '/b/index.js', exists: true, patched: true },
			restoreTarget: { path: '/b/index.js.bak-1', sha: PRISTINE },
			plugin: { profileDir: '/p', packageName: 'dsh-mcp-skill-hub', installMode: 'link' },
			dsh: { pid: 4242 },
		},
		// 与真实 child_process.spawn 同签名: (cmd, argv, opts)
		spawn: (cmd, argv, opts) => { seen.push({ cmd, argv, opts }); return { pid: 4242 } },
		writeJson,
		...over.regOpts,
	})
	routes.push(...registered)
	return { routes, seen, writeJson }
}

async function callRoute(routes, method, path, body) {
	const { EventEmitter } = require('node:events')
	const req = new EventEmitter()
	req.method = method
	req.socket = { remoteAddress: '127.0.0.1' }
	req.url = path
	const chunks = body == null ? [] : [Buffer.from(JSON.stringify(body))]
	// 异步派发, 模拟真实 req 的 data/end 时序(先 data 后 end)
	process.nextTick(() => {
		for (const c of chunks) req.emit('data', c)
		req.emit('end')
	})
	let out = { status: 0, body: null }
	const res = {
		writeHead(status) { out.status = status },
		end(text) { out.body = text ? JSON.parse(text) : null },
		headersSent: false,
	}
	const r = routes.find((x) => x.path === path)
	if (!r) throw new Error(`route not found: ${path}`)
	await r.handler(req, res)
	return out
}

test('路由: GET plan 返回只读预览, 不产生副作用', async () => {
	const { routes, seen } = routeHarness()
	const out = await callRoute(routes, 'GET', '/api/dsh-mcp-skill-hub/uninstall/plan')
	assert.equal(out.status, 200)
	assert.equal(out.body.canRestore, true)
	assert.deepEqual(seen, [], 'GET plan 不得 spawn worker')
})

test('路由: POST run 缺少 confirm 令牌 → 400 且不 spawn', async () => {
	const { routes, seen } = routeHarness()
	const out = await callRoute(routes, 'POST', '/api/dsh-mcp-skill-hub/uninstall/run', {})
	assert.equal(out.status, 400)
	assert.match(String(out.body.error), /confirm/)
	assert.deepEqual(seen, [], '缺 confirm 不得 spawn')
})

test('路由: POST run confirm 错误 → 400', async () => {
	const { routes, seen } = routeHarness()
	const out = await callRoute(routes, 'POST', '/api/dsh-mcp-skill-hub/uninstall/run', { confirm: 'yes' })
	assert.equal(out.status, 400)
	assert.deepEqual(seen, [])
})

test('路由: POST run 计划有阻断项 → 409 且不 spawn', async () => {
	const { routes, seen } = routeHarness({ plan: { canRestore: false, blockers: ['没有可用备份'], steps: [], restoreTarget: null } })
	const out = await callRoute(routes, 'POST', '/api/dsh-mcp-skill-hub/uninstall/run', { confirm: 'UNINSTALL' })
	assert.equal(out.status, 409)
	assert.deepEqual(seen, [], '有阻断项不得 spawn')
})

test('路由: POST run 合法 → 202 并 spawn detached worker, 返回 logPath', async () => {
	const { routes, seen } = routeHarness()
	const out = await callRoute(routes, 'POST', '/api/dsh-mcp-skill-hub/uninstall/run', { confirm: 'UNINSTALL' })
	assert.equal(out.status, 202)
	assert.equal(out.body.status, 'started')
	assert.equal(seen.length, 1, '应 spawn 一次 worker')
	// 与真实 child_process.spawn 同形状: (node, [workerPath, argsJson], {detached:true})
	assert.equal(seen[0].cmd, process.execPath, '应由 node 执行')
	assert.equal(seen[0].opts.detached, true, '必须 detached, 否则插件被删时 worker 一起死')
	assert.match(seen[0].argv[0], /uninstall-worker/, 'worker 应写在插件包外')
	assert.equal(typeof out.body.logPath, 'string')
	assert.ok(out.body.logPath.length > 0)
	// argv[1] 是 JSON 参数, 必须含 bundlePath 且不含 confirm
	const argv2 = JSON.parse(seen[0].argv[1])
	assert.equal('confirm' in argv2, false)
	assert.equal(argv2.bundlePath, '/b/index.js')
})

/**
 * 回归: plan 可能是 async 的(生产里 findBundle 是 async, 见 lib/index.js 的注入)。
 * 2026-10-25 实测踩中: 路由同步调 plan() 拿到 Promise, planUninstall 的类型闸门
 * 报「bundlePath required」, 整条卸载计划不可用。此后路由必须 await。
 */
test('路由: plan 为 async 时也能正常工作(回归: 未 await 会 500)', async () => {
	const seen = []
	const writeJson = (res, status, body) => { res.writeHead(status, {}); res.end(JSON.stringify(body)) }
	const route = (path, method, handler) => ({
		kind: 'exact', path,
		handler: async (req, res) => {
			if (req?.socket?.remoteAddress !== '127.0.0.1') return writeJson(res, 403, { error: 'forbidden' })
			if (req.method !== method) return writeJson(res, 405, { error: 'method not allowed' })
			await handler(req, res)
		},
	})
	const routes = mod.registerUninstallRoutes({
		route,
		plan: async () => {
			await new Promise((r) => setTimeout(r, 5))
			return {
				canRestore: true, blockers: [], steps: [{ id: 'restore-bundle' }],
				bundle: { path: '/async/b/index.js' }, restoreTarget: { path: '/async/bak', sha: PRISTINE },
				plugin: { installMode: 'copy', profileDir: '/p', packageName: 'x' }, dsh: { pid: 9 },
			}
		},
		spawn: (cmd, argv, opts) => { seen.push({ cmd, argv, opts }); return { pid: 9 } },
		writeJson,
	})
	const planOut = await callRoute(routes, 'GET', '/api/dsh-mcp-skill-hub/uninstall/plan')
	assert.equal(planOut.status, 200, `async plan 的 GET 不应 500: ${JSON.stringify(planOut.body)}`)
	assert.equal(planOut.body.bundle.path, '/async/b/index.js')
	const runOut = await callRoute(routes, 'POST', '/api/dsh-mcp-skill-hub/uninstall/run', { confirm: 'UNINSTALL' })
	assert.equal(runOut.status, 202, `async plan 的 POST 应 202: ${JSON.stringify(runOut.body)}`)
	assert.equal(seen.length, 1)
	assert.equal(JSON.parse(seen[0].argv[1]).bundlePath, '/async/b/index.js', '参数应由 async plan 的结果填充')
})

test('路由: 非 loopback 一律 403(围栏不可绕过)', async () => {
	const routes = []
	const writeJson = (res, status, body) => { res.writeHead(status, {}); res.end(JSON.stringify(body)) }
	const route = (path, method, handler) => ({
		kind: 'exact', path,
		handler: async (req, res) => {
			if (req?.socket?.remoteAddress !== '127.0.0.1') return writeJson(res, 403, { error: 'forbidden' })
			if (req.method !== method) return writeJson(res, 405, { error: 'method not allowed' })
			await handler(req, res)
		},
	})
	routes.push(...mod.registerUninstallRoutes({
		route,
		plan: () => ({ canRestore: true, blockers: [], steps: [], bundle: { path: '/b' }, restoreTarget: { path: '/x', sha: PRISTINE }, plugin: { installMode: 'link' }, dsh: { pid: 1 } }),
		spawn: () => ({ pid: 1 }), writeJson,
	}))
	const { EventEmitter } = require('node:events')
	const req = new EventEmitter()
	req.method = 'GET'
	req.socket = { remoteAddress: '10.0.0.9' }
	let status = 0
	const res = { writeHead(s) { status = s }, end() {}, headersSent: false }
	await routes[0].handler(req, res)
	assert.equal(status, 403)
})
