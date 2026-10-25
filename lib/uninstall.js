/**
 * 卸载与还原 —— 「完整卸载 + 还原补丁」按钮的服务端半。
 *
 * 存在理由(用户 2026-10-25 要求): 本插件会改写 @deepseek-ai/dsh-mcp-client 的
 * bundle(npm 装好后没有任何配置能绕开这一步, 因为 SDK 的 provider 透传只能在
 * 编译产物里改), 所以「卸载」必须同时做两件事:
 *
 *   1. 还原 bundle —— 用 patch 前的必留备份覆盖回去, 覆盖前**重新校验**备份
 *      sha256 与记录的原版 sha 一致。先校验后覆盖的顺序是安全的根本: 若备份
 *      已损坏, 直接覆盖会把「半 patched」写死进 bundle 且再也拿不到原版。
 *   2. 移除插件 —— pnpm remove(软链开发态与副本发布态都适用; 软链态只删
 *      软链与依赖声明, 源码目录不受影响)。
 *
 * 死锁陷阱(为什么 worker 必须是独立文件):
 *   卸载由插件自己的 HTTP 路由触发, 而插件随后会被 pnpm 删掉、dsh 也会被重启。
 *   若 worker 代码活在插件进程内, 第二步就可能读到被删掉的文件 / 被重启打断。
 *   所以路由只把一段**自带全部逻辑的 CJS 源码**写到 ~/.dsh/ 下再 detached
 *   spawn, 自己立刻返回 202。worker 不 import 插件任何模块(有测试断言这一点)。
 *
 * 铁律 6: 本模块与 worker 都不接触凭据字段(accessToken/client_secret/
 * code_verifier), 只操作 sha256 与路径。
 */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
	copyFileSync,
	existsSync,
	lstatSync,
	readFileSync,
	readdirSync,
	readlinkSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

/** Hub API 前缀：与 lib/index.js 的 API 常量一致。 */
export const API = '/api/dsh-mcp-skill-hub'
/** 路由层鉴权令牌：UI 必须原样回传, 防止误触。 */
export const CONFIRM_TOKEN = 'UNINSTALL'
/** worker 落盘位置：必须在插件包外, 否则插件被删后 worker 自身也没了。 */
export const WORKER_RELATIVE = 'mcp-skill-hub-uninstall-worker.cjs'

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

/** 备份文件名两类：自愈写的 .bak-selfheal 与安装脚本写的 .bak-<ts>。 */
const BAK_SELFHEAL = '.bak-selfheal'
const BAK_TS = /\.bak-\d{8}T\d{6}Z$/

/**
 * 列出 bundle 的可信备份, 新的在前。
 *
 * 只收两类: `.bak-selfheal` 与 `.bak-<UTC ts>`。`.sha256` sidecar 是记录文件
 * 不是备份; 其它后缀(.unrelated 等)一律忽略, 避免把用户自己的副本当还原目标。
 *
 * @returns {Array<{path: string, kind: 'selfheal'|'timestamped', recordedSha: string|null, actualSha: string, mtimeMs: number, trustworthy: boolean}>}
 */
export function findPristineBackups(bundlePath) {
	const dir = dirname(bundlePath)
	let names = []
	try { names = readdirSync(dir) } catch { return [] }
	const out = []
	for (const name of names) {
		const full = join(dir, name)
		if (!name.startsWith(`${bundlePath.split('/').pop()}.bak`)) continue
		if (name.endsWith('.sha256')) continue
		let kind = null
		if (name.endsWith(BAK_SELFHEAL)) kind = 'selfheal'
		else if (BAK_TS.test(name)) kind = 'timestamped'
		if (!kind) continue
		let buf = null
		try { buf = readFileSync(full) } catch { continue }
		const actualSha = sha256(buf)
		// sidecar 记录的原版 sha: 首行首段
		let recordedSha = null
		try {
			const side = readFileSync(`${full}.sha256`, 'utf8')
			const m = /^([0-9a-f]{64})/.exec(side.trim())
			if (m) recordedSha = m[1]
		} catch {}
		let mtimeMs = 0
		try { mtimeMs = lstatSync(full).mtimeMs } catch {}
		out.push({
			path: full,
			kind,
			recordedSha,
			actualSha,
			mtimeMs,
			trustworthy: recordedSha !== null && recordedSha === actualSha,
		})
	}
	out.sort((a, b) => b.mtimeMs - a.mtimeMs)
	return out
}

/** 探测插件在 profile 里的安装形态：软链(开发态) / 副本(发布态)。 */
function detectInstallMode(profileDir, packageName) {
	const nm = join(profileDir, 'node_modules', packageName)
	let installMode = 'missing'
	let linkedPath = null
	try {
		const st = lstatSync(nm)
		if (st.isSymbolicLink()) {
			installMode = 'link'
			try { linkedPath = readlinkSync(nm) } catch {}
		} else if (st.isDirectory()) installMode = 'copy'
	} catch {}
	return { installMode, linkedPath, nodeModulesPath: nm }
}

/**
 * 生成卸载计划（纯函数：只读文件系统, 不写任何东西）。
 *
 * 计划里 `restoreTarget` 只在备份可信时非空 —— 这是「不得让用户点下去」
 * 的判据: 没有可信原版备份时, 覆盖 bundle 是不可逆的赌博。
 */
export function planUninstall({
	bundlePath,
	profileDir,
	packageName,
	dshPidFile = join(homedir(), '.dsh-web.pid'),
} = {}) {
	if (typeof bundlePath !== 'string' || bundlePath === '') throw new TypeError('planUninstall: bundlePath required')
	const blockers = []
	const exists = existsSync(bundlePath)
	let currentSha = null
	if (exists) {
		try { currentSha = sha256(readFileSync(bundlePath)) } catch {}
	}
	const backups = findPristineBackups(bundlePath)
	const trusted = backups.filter((b) => b.trustworthy)
	const restoreTarget = trusted.length ? { path: trusted[0].path, sha: trusted[0].actualSha, kind: trusted[0].kind } : null

	if (!exists) blockers.push('bundle 不存在（dsh-mcp-client 未安装？）')
	if (!trusted.length) {
		blockers.push(
			backups.length
				? `有 ${backups.length} 个备份但 sha256 与记录不符，无法确认是上游原版`
				: '没有找到原版备份（.bak-selfheal / .bak-<ts>），无法安全还原'
		)
	}

	// bundle 是否已打补丁：与可信备份逐字节相同即为未 patch
	const patched = exists && restoreTarget ? currentSha !== restoreTarget.sha : null

	let dshPid = null
	try {
		const raw = readFileSync(dshPidFile, 'utf8').trim()
		if (/^\d+$/.test(raw)) dshPid = Number(raw)
	} catch {}

	const plugin = detectInstallMode(profileDir ?? '', packageName ?? '')
	if (plugin.installMode === 'missing') blockers.push(`profile 中未见 ${packageName}（可能已卸载）`)

	const steps = [
		{ id: 'restore-bundle', label: '还原 mcp-client bundle 至上游原版' },
		{ id: 'verify-restore', label: '校验还原后 sha256 与记录一致' },
	]
	if (plugin.installMode !== 'missing') steps.push({ id: 'remove-plugin', label: `移除插件 ${packageName}` })
	if (dshPid) steps.push({ id: 'restart-dsh', label: `重启 dsh（pid ${dshPid}）使还原生效` })

	return {
		canRestore: blockers.length === 0,
		blockers,
		bundle: { path: bundlePath, exists, currentSha, patched },
		backups: backups.map((b) => ({ path: b.path, kind: b.kind, trustworthy: b.trustworthy, sha: b.actualSha })),
		restoreTarget,
		plugin: { profileDir: profileDir ?? null, packageName, ...plugin },
		dsh: { pid: dshPid, pidFile: dshPidFile },
		steps,
	}
}

/**
 * 组装 worker 参数：白名单字段, 且 confirm 令牌只活在路由层。
 * （worker 由路由在鉴权之后才 spawn, 不需要也不可能再鉴权一次。）
 */
export function buildWorkerArgs(input = {}) {
	const out = {}
	const str = (v) => (typeof v === 'string' && v !== '' ? v : null)
	const set = (k, v) => { if (v !== null && v !== undefined) out[k] = v }
	set('bundlePath', str(input.bundlePath))
	set('backupPath', str(input.backupPath))
	set('pristineSha', str(input.pristineSha))
	set('profileDir', str(input.profileDir))
	set('packageName', str(input.packageName))
	set('logPath', str(input.logPath))
	set('removePlugin', input.removePlugin === true)
	set('restartDsh', input.restartDsh === true)
	set('dshPid', Number.isFinite(input.dshPid) ? Number(input.dshPid) : null)
	return out
}

/**
 * 生成 worker 源码（独立 CJS, 不 import 插件）。
 *
 * 安全不变量(有测试逐条断言):
 *   - 只依赖 node 内置模块
 *   - 先校验备份 sha256, 不符则**不碰 bundle**
 *   - 原子替换：同目录临时文件 + renameSync
 *   - 每步写一行 JSON 到日志, 末步汇总 ok
 */
export function buildWorkerSource() {
	return `'use strict'
/**
 * dsh-mcp-skill-hub 卸载 worker —— 由插件路由 detached spawn, 不 import 插件。
 * 步骤: restore-bundle → verify-restore → remove-plugin → restart-dsh
 * 退出码: 0 全部成功 / 2 前置或校验失败(未改动 bundle) / 1 其它
 */
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const crypto = require('node:crypto')

const args = JSON.parse(process.argv[2] || '{}')
const logPath = args.logPath
const lines = []
const log = (step, ok, extra) => {
  const rec = Object.assign({ step, ok, at: new Date().toISOString() }, extra || {})
  lines.push(JSON.stringify(rec))
  try { fs.appendFileSync(logPath, lines.join('\\n') + '\\n') } catch {}
  lines.length = 0
}
const fail = (code, msg) => { log('abort', false, { error: String(msg) }); process.exit(code) }
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

if (!args.bundlePath || !args.backupPath || !args.pristineSha) fail(2, 'missing required args')
let backupBuf
try { backupBuf = fs.readFileSync(args.backupPath) } catch (e) { fail(2, 'backup unreadable: ' + e.message) }
const backupSha = sha256(backupBuf)
if (backupSha !== args.pristineSha) {
  fail(2, 'backup sha256 mismatch: expected ' + args.pristineSha.slice(0, 12) + ' got ' + backupSha.slice(0, 12))
}
log('restore-bundle', true, { backup: args.backupPath, sha: backupSha.slice(0, 16) })

// 原子替换: 同目录临时文件 + rename(同文件系统内 rename 是原子的)
const tmp = args.bundlePath + '.uninstall-tmp'
try {
  fs.writeFileSync(tmp, backupBuf)
  fs.renameSync(tmp, args.bundlePath)
} catch (e) { try { fs.rmSync(tmp, { force: true }) } catch {}; fail(2, 'replace failed: ' + e.message) }

let afterSha = null
try { afterSha = sha256(fs.readFileSync(args.bundlePath)) } catch {}
if (afterSha !== args.pristineSha) fail(2, 'post-restore sha mismatch')
log('verify-restore', true, { sha: afterSha.slice(0, 16) })

if (args.removePlugin && args.profileDir && args.packageName) {
  try {
    const out = execFileSync('pnpm', ['remove', args.packageName], {
      cwd: args.profileDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000,
    })
    log('remove-plugin', true, { bytes: String(out || '').length })
  } catch (e) {
    // bundle 已还原成功, 插件移除失败不应判整体失败 —— 记下并继续, 让用户可手工补刀
    log('remove-plugin', false, { error: String((e && e.message) || e).slice(0, 200) })
  }
}

if (args.restartDsh && args.dshPid) {
  try {
    process.kill(args.dshPid, 'SIGTERM')
    log('restart-dsh', true, { pid: args.dshPid })
  } catch (e) {
    log('restart-dsh', false, { error: String((e && e.message) || e).slice(0, 200) })
  }
}
log('done', true)
process.exit(0)
`
}

/** 解析 worker 日志（JSON 行）, 忽略噪声与截断行。 */
export function parseWorkerLog(text) {
	const out = []
	for (const line of String(text || '').split('\n')) {
		const s = line.trim()
		if (!s.startsWith('{')) continue
		try {
			const rec = JSON.parse(s)
			if (typeof rec.step === 'string') out.push(rec)
		} catch {}
	}
	return out
}

/**
 * 注册 3 条卸载路由（全部继承 loopback 围栏）：
 *   GET  .../uninstall/plan  只读预览
 *   POST .../uninstall/run   需 confirm 令牌, spawn detached worker, 立即 202
 *   GET  .../uninstall/status  读 worker 日志（插件重启后 UI 重新加载时可回看）
 */
export function registerUninstallRoutes({ route, plan, spawn: spawnFn, writeJson, workerDir }) {
	if (typeof route !== 'function') throw new TypeError('registerUninstallRoutes: deps.route must be a function')
	if (typeof plan !== 'function') throw new TypeError('registerUninstallRoutes: deps.plan must be a function')
	if (typeof writeJson !== 'function') throw new TypeError('registerUninstallRoutes: deps.writeJson must be a function')
	const doSpawn = typeof spawnFn === 'function' ? spawnFn : spawn
	const dir = typeof workerDir === 'string' && workerDir !== '' ? workerDir : join(homedir(), '.dsh')

	const readBody = (req) => new Promise((resolve) => {
		const chunks = []
		req.on('data', (c) => chunks.push(c))
		req.on('end', () => {
			const raw = Buffer.concat(chunks).toString('utf8')
			try { resolve(raw ? JSON.parse(raw) : {}) } catch { resolve({}) }
		})
		req.on('error', () => resolve({}))
	})

	return [
		route(`${API}/uninstall/plan`, 'GET', async (_req, res) => {
			let p
			try { p = await plan() } catch (e) { writeJson(res, 500, { error: String(e?.message || e) }); return }
			writeJson(res, 200, p)
		}),
		route(`${API}/uninstall/run`, 'POST', async (req, res) => {
			const body = await readBody(req)
			if (body?.confirm !== CONFIRM_TOKEN) {
				writeJson(res, 400, { error: `confirm must be "${CONFIRM_TOKEN}"` })
				return
			}
			let p
			try { p = await plan() } catch (e) { writeJson(res, 500, { error: String(e?.message || e) }); return }
			if (!p || p.canRestore !== true) {
				writeJson(res, 409, { error: 'uninstall blocked', blockers: p?.blockers || ['plan unavailable'] })
				return
			}
			const logPath = join(dir, 'mcp-skill-hub-uninstall.log')
			const workerPath = join(dir, WORKER_RELATIVE)
			const argv = [
				JSON.stringify(buildWorkerArgs({
					bundlePath: p.bundle?.path,
					backupPath: p.restoreTarget?.path,
					pristineSha: p.restoreTarget?.sha,
					profileDir: p.plugin?.profileDir,
					packageName: p.plugin?.packageName,
					removePlugin: p.plugin?.installMode !== 'missing',
					restartDsh: body?.restartDsh !== false && !!p.dsh?.pid,
					dshPid: p.dsh?.pid,
					logPath,
				})),
			]
			try {
				// worker 源码每次重新落盘: 插件升级后旧 worker 不会残留混用
				writeFileSync(workerPath, buildWorkerSource())
				const child = doSpawn(process.execPath, [workerPath, ...argv], {
					detached: true,
					stdio: 'ignore',
				})
				try { child.unref?.() } catch {}
				writeJson(res, 202, { status: 'started', pid: child?.pid ?? null, logPath, steps: p.steps })
			} catch (e) {
				writeJson(res, 500, { error: String(e?.message || e) })
			}
		}),
		route(`${API}/uninstall/status`, 'GET', async (_req, res) => {
			let text = ''
			try { text = readFileSync(logPath, 'utf8') } catch {}
			writeJson(res, 200, { steps: parseWorkerLog(text), logPath })
		}),
	]
}

/** 供 index.js 复用：把 worker 源码与参数准备好（不 spawn）。 */
export function prepareWorker({ planResult, workerDir, restartDsh = true }) {
	const dir = typeof workerDir === 'string' && workerDir !== '' ? workerDir : join(homedir(), '.dsh')
	const logPath = join(dir, 'mcp-skill-hub-uninstall.log')
	const workerPath = join(dir, WORKER_RELATIVE)
	writeFileSync(workerPath, buildWorkerSource())
	return {
		workerPath,
		logPath,
		argv: [
			JSON.stringify(buildWorkerArgs({
				bundlePath: planResult?.bundle?.path,
				backupPath: planResult?.restoreTarget?.path,
				pristineSha: planResult?.restoreTarget?.sha,
				profileDir: planResult?.plugin?.profileDir,
				packageName: planResult?.plugin?.packageName,
				removePlugin: planResult?.plugin?.installMode !== 'missing',
				restartDsh: restartDsh === true && !!planResult?.dsh?.pid,
				dshPid: planResult?.dsh?.pid,
				logPath,
			})),
		],
	}
}

// 测试注入点: 允许在隔离目录里造软链而不污染真实 HOME
export const __test = { symlinkSync, copyFileSync, rmSync, existsSync, writeFileSync, readFileSync, renameSync }
