/**
 * 运行时自愈 —— dsh 每次启动时检测 OAuth seam 补丁, 缺失则自动补。
 *
 * 为什么不用 postinstall: npm 12 起默认阻止依赖的 install scripts
 * (需 `npm install-scripts approve`), 且 pnpm 11 遇 scripts.postinstall 会以
 * ERR_PNPM_IGNORED_BUILDS 把 `dsh plugin add` 卡到 exit 1(见 P0-1)。
 * 本文件由插件的 apply() 调用, 跑在 dsh 进程内, 不受包管理器策略影响。
 *
 * 安全约束(改动的是第三方包 @deepseek-ai/dsh-mcp-client):
 *   1. 幂等 —— 已 patch 则只读不写(启动开销 = 一次文件读取)。
 *   2. 必留备份 —— patch 前写 .bak-selfheal[-<ts>], 内容与上游原版逐字节一致。
 *   3. 原子写 —— 写临时文件后 renameSync(), 断电/半写不会留损坏 bundle。
 *   4. 写后校验 —— 逐锚点确认, 任一不符立即恢复原文件。
 *   5. 跨进程锁 —— O_EXCL 排他, 陈旧锁(>STALE_LOCK_MS)可夺, 避免并发互踩。
 *   6. 永不抛异常 —— 调用方是 dsh 启动路径, 失败只返回状态。
 *   7. 不输出凭据 —— 只报路径/sha256 前缀/状态词(铁律 6)。
 *   8. 环境变量可关 —— DSH_MCP_SKILL_HUB_NO_SELF_HEAL=1 时只检测不补。
 *
 * 0.3.0 起(四路并行审计后加固):
 *   P0-2 异常状态(anchor-missing / not-applicable / corrupt)必须发声
 *   P1-1 原子写 + P1-3 完整性检查(空文件/NUL/半写切断不再静默放过)
 *   P1-2 跨进程锁 + P1-4 备份失配修复 + P1-5 execSync 异步化
 *   P1-6 anchorMissing 判定不再依赖 anyTo
 *   P2-1 patch 元数据 sidecar + P2-2 symlink 归一化
 */

import { existsSync, readFileSync, writeFileSync, copyFileSync, renameSync, unlinkSync, openSync, closeSync, statSync, lstatSync, realpathSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const HERE = dirname(fileURLToPath(import.meta.url))
const req = createRequire(join(HERE, 'index.js'))

/** 三处结构特征 —— 与 scripts/patch-installed.sh / verify-patch-applied.sh 同口径。 */
export const ANCHORS = [
	{
		id: 'P1',
		name: 'createTransport 签名接受 authProvider',
		from: 'function createTransport(config) {',
		to: 'function createTransport(config, authProvider) {',
	},
	{
		id: 'P2',
		name: 'StreamableHTTPClientTransport 透传 authProvider',
		from: 'case "streamable-http": return new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers } });',
		to: 'case "streamable-http": return new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers }, authProvider });',
	},
	{
		id: 'P3+P4',
		name: '调用点从 ctx.get("mcpAuth") 取 provider 并传入',
		from: 'transport = createTransport(config);',
		to: 'const authProvider = ctx.get("mcpAuth", false)?.getAuthProvider(config.serverName, config);\n\t\t\ttransport = createTransport(config, authProvider);',
	},
]

const STALE_LOCK_MS = 30_000
const BAK_SELFHEAL = '.bak-selfheal'
const SIDECAR_SUFFIX = '.patch-state.json'

/**
 * P1-7 锚点容错: 上游若被 prettier 重排(长行拆多行/缩进变化), 整行 from 会失配。
 * 为每个锚点定义一个**短特征片段** + 插入方式, 作为归一化兜底:
 *   - P1/P2 是"行内追加": 找到含 needle 的那一行, 在行尾(去空白后)追加 insert
 *   - P3+P4 是"行前插入": 找到含 needle 的那一行, 在行首(保留缩进)前插 insert
 * needle 取上游不大可能改写的稳定 token。
 */
const FALLBACKS = [
	{ id: 'P1', needle: 'function createTransport(config)', insert: ', authProvider', mode: 'append' },
	{ id: 'P2', needle: 'requestInit: { headers: config.headers }', insert: ', authProvider', mode: 'append' },
	{ id: 'P3+P4', needle: 'transport = createTransport(config);', insert: 'const authProvider = ctx.get("mcpAuth", false)?.getAuthProvider(config.serverName, config);\n', mode: 'prepend' },
]

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

/** 归一化: 去 TAB/空格差异 + 折叠换行(P1-7 锚点容错)。 */
function normalize(s) {
	return s.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim()
}
const NORM_ANCHORS = ANCHORS.map((a) => ({ ...a, fromNorm: normalize(a.from), toNorm: normalize(a.to) }))

/**
 * 定位 dsh 的 mcp-client bundle。多路径探测, 不硬编码。
 * 异步(P1-5): execFile 替代 execSync, 避免冻结 dsh 的事件循环。
 * P2-2: 返回 realpath, 使日志/备份/写入指向同一真实文件。
 */
export async function findBundle(env = process.env) {
	const tries = []

	if (env.DSH_MCP_CLIENT_BUNDLE && existsSync(env.DSH_MCP_CLIENT_BUNDLE)) {
		tries.push(['env', env.DSH_MCP_CLIENT_BUNDLE])
	}
	// 测试专用开关: 只信 env 注入的路径, 不探测真实环境(用于模拟「bundle 不存在」)。
	// 命名不带 postinstall —— postinstall 方案已在 0.3.0 废弃(P0-1), 别再误导。
	if (env.DSH_SELF_HEAL_NO_FALLBACK) return null

	// require.resolve 不 spawn 进程, 排在 npm prefix 之前(P2-4)
	for (const base of [HERE, process.cwd()]) {
		try {
			const pkg = req.resolve('@deepseek-ai/dsh-mcp-client/package.json', { paths: [base] })
			tries.push([`resolve:${base}`, join(dirname(pkg), 'lib/index.js')])
		} catch { /* 不在依赖树 */ }
	}

	try {
		const { stdout } = await execFileAsync('npm', ['prefix', '-g'], { timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] })
		const prefix = String(stdout || '').trim()
		if (prefix) {
			tries.push(['npm-prefix', join(prefix, 'lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js')])
			tries.push(['npm-prefix-flat', join(prefix, 'node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js')])
		}
	} catch { /* npm 不可用: 安全降级到下面的硬编码兜底 */ }

	if (process.platform === 'linux' || process.platform === 'android') {
		tries.push(['termux', '/data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js'])
		tries.push(['linux', '/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js'])
	}
	tries.push(['local', '/usr/local/lib/node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js'])

	for (const [via, p] of tries) {
		if (!p || !existsSync(p)) continue
		try {
			const st = lstatSync(p)
			if (st.isSymbolicLink()) continue          // P2-2: 不跟随 symlink
			return { path: realpathSync(p), via }
		} catch { continue }
	}
	return null
}

/**
 * 完整性检查(P1-3): 判断 bundle 是否像一份完好的编译产物。
 * 返回 null(完好) 或 原因串。
 *
 * 为什么不能只数花括号: 实测把原版切到 40% 时花括号恰好仍配对,
 * 旧判据漏过 → 半写 bundle 被当正常, OAuth 静默死。故补两条:
 *   - sidecar 若记录了上次 patch 后的 sha, 完全一致即判完好
 *   - 末行必须是 `};`(上游原版/已 patch 版都以 export 语句收尾);
 *     实测切到 40%/50%/60%/90% 时末行分别是半词或未闭合注释, 都不是 `};`
 */
function corruptionReason(buf, bundlePath) {
	if (buf.length === 0) return '空文件(0 字节)'
	if (buf.length < 1024) return `文件过小(${buf.length} B), 不像编译产物`
	if (buf.includes(0)) return '含 NUL 字节, 疑似半写/二进制损坏'
	const text = buf.toString('utf8')
	if (!text.includes('createTransport')) return '不含 createTransport, 不是 mcp-client bundle'

	const open = (text.match(/\{/g) || []).length
	const close = (text.match(/\}/g) || []).length
	const parenOpen = (text.match(/\(/g) || []).length
	const parenClose = (text.match(/\)/g) || []).length
	if (Math.abs(open - close) > Math.max(8, Math.floor(open * 0.02))) {
		return `花括号严重不配对({=${open} }=${close}), 疑似截断`
	}
	if (Math.abs(parenOpen - parenClose) > Math.max(8, Math.floor(parenOpen * 0.02))) {
		return `圆括号严重不配对((${parenOpen} )=${parenClose}), 疑似截断`
	}
	// 悬空结尾: 上游原版与已 patch 的 bundle 都以 `};` 收尾(export 语句)。
	// 实测切到 40%/50%/60%/90% 时花括号恰好配对, 但末行分别是半词
	// `const refs = await attac` / 未闭合注释 `/** Consecutive failed...` /
	// `/** Valid \`server` —— 都不是 `};`。故"末行非 };"即视为截断信号。
	const tail = text.slice(-200).replace(/\s+$/, '')
	const lastLine = tail.slice(tail.lastIndexOf('\n') + 1).trim()
	if (lastLine !== '' && !/\};$/.test(lastLine)) {
		return `结尾不是预期的 \`};\`(末行 "${lastLine.slice(0, 40)}"), 疑似写入被截断`
	}
	// sidecar 一致性: 上次 patch 后记录的 sha 与当前完全一致 → 直接判完好
	// (不等同于「没 sidecar 就判坏」; 那只是没有可比对象, 继续后面的判定)。
	if (bundlePath) {
		try {
			const sc = JSON.parse(readFileSync(bundlePath + SIDECAR_SUFFIX, 'utf8'))
			if (sc && typeof sc.bundleShaAfter === 'string' && sha256(buf) === sc.bundleShaAfter) return null
		} catch { /* 无 sidecar / 读不到: 跳过 */ }
	}
	return null
}

/**
 * 检查 bundle 的 patch 状态。
 * 返回 { patched, missing, anchorMissing, corrupt }
 */
export function inspectBundle(bundlePath) {
	const buf = readFileSync(bundlePath)
	const corrupt = corruptionReason(buf, bundlePath)
	const text = buf.toString('utf8')
	const norm = normalize(text)

	const missing = []
	let anchorMissing = null
	let anyFrom = false
	let anyTo = false

	for (const a of NORM_ANCHORS) {
		const hasFrom = text.includes(a.from) || norm.includes(a.fromNorm)
		const hasTo = text.includes(a.to) || norm.includes(a.toNorm)
		if (hasFrom) anyFrom = true
		if (hasTo) anyTo = true
		if (hasTo) continue
		missing.push(a.id)
		// P1-6: 不依赖 anyTo。第一个"from 也不命中"的锚点即为漂移点
		// (not-applicable 场景下 anyFrom/anyTo 均假, 由调用方另行判定)
		if (anchorMissing === null && !hasFrom && (anyFrom || anyTo)) anchorMissing = a.id
	}

	if (!anyFrom && !anyTo) {
		return { patched: false, missing: [], anchorMissing: null, corrupt, notApplicable: true }
	}
	return { patched: missing.length === 0, missing, anchorMissing, corrupt, notApplicable: false }
}

// ── 跨进程锁(P1-2) ──────────────────────────────────────────────
function acquireLock(bundlePath) {
	const lockPath = bundlePath + '.selfheal.lock'
	try {
		const fd = openSync(lockPath, 'wx')     // O_EXCL: 已存在则 EEXIST
		writeFileSync(fd, String(process.pid))
		closeSync(fd)
		return lockPath
	} catch (e) {
		if (e.code !== 'EEXIST') return null    // 其它错误不阻塞, 只是没锁
		// 陈旧锁可夺
		try {
			const st = statSync(lockPath)
			if (Date.now() - st.mtimeMs > STALE_LOCK_MS) {
				unlinkSync(lockPath)
				const fd = openSync(lockPath, 'wx')
				writeFileSync(fd, String(process.pid))
				closeSync(fd)
				return lockPath
			}
		} catch { /* 锁恰好消失: 视为无锁 */ }
		return null                              // 别人持锁中
	}
}
function releaseLock(lockPath) {
	if (!lockPath) return
	try { unlinkSync(lockPath) } catch { /* 已被夺 */ }
}

/** 读 dsh-mcp-client 的版本号(用于 sidecar 与备份命名)。 */
function mcpClientVersion(bundlePath) {
	try {
		const pkg = join(dirname(dirname(bundlePath)), 'package.json')
		const d = JSON.parse(readFileSync(pkg, 'utf8'))
		return typeof d.version === 'string' ? d.version : 'unknown'
	} catch { return 'unknown' }
}

/**
 * 执行 patch(幂等)。绝不抛异常。
 */
export async function applyPatch(bundlePath, opts = {}) {
	const log = opts.log || (() => {})
	let lockPath = null
	try {
		const original = readFileSync(bundlePath)
		const text = original.toString('utf8')
		const norm = normalize(text)

		const applied = []
		const skipped = []
		let anyFrom = false
		let anyTo = false
		for (const a of NORM_ANCHORS) {
			if (text.includes(a.to) || norm.includes(a.toNorm)) { anyTo = true; skipped.push(a.id); continue }
			if (text.includes(a.from) || norm.includes(a.fromNorm)) anyFrom = true
		}
		if (!anyFrom && !anyTo) return { status: 'not-applicable', reason: 'bundle 不含预期的 createTransport 形态' }

		let next = text
		for (const a of NORM_ANCHORS) {
			if (next.includes(a.to)) continue
			// 先试整行 from 精确替换(上游未重排时走这条, 产物与手工补丁一致)
			let idx = next.indexOf(a.from)
			if (idx !== -1) {
				next = next.slice(0, idx) + a.to + next.slice(idx + a.from.length)
				applied.push(a.id)
				continue
			}
			// 归一化兜底(P1-7): 上游重排后整行 from 失配, 改用短特征片段
			const fb = FALLBACKS.find((f) => f.id === a.id)
			if (!fb) return { status: 'anchor-missing', anchor: a.id, reason: '锚点未命中(且无兜底规则)' }

			const nidx = next.indexOf(fb.needle)
			if (nidx === -1) return { status: 'anchor-missing', anchor: a.id, reason: '锚点未命中(含特征片段兜底)' }

			const lineEnd = next.indexOf('\n', nidx)
			const line = next.slice(nidx, lineEnd === -1 ? next.length : lineEnd)
			const indent = (line.match(/^[ \t]*/) || [''])[0]
			let replacement
			if (fb.mode === 'append') {
				// 幂等: 该行已含 authProvider 则跳过
				if (line.includes('authProvider')) continue
				replacement = line.replace(/[ \t]*$/, '') + fb.insert
			} else {
				if (next.slice(Math.max(0, nidx - 400), nidx).includes('getAuthProvider')) continue
				replacement = indent + fb.insert + line
			}
			next = next.slice(0, nidx) + replacement + next.slice(nidx + line.length)
			applied.push(a.id)
		}

		if (applied.length === 0) return { status: 'already', applied: [], skipped }

		lockPath = acquireLock(bundlePath)
		if (!lockPath && !opts.force) {
			// 别人正在 patch: 直接复检, 可能已完成
			const re = inspectBundle(bundlePath)
			if (re.patched) return { status: 'already', applied: [], skipped, via: 'concurrent' }
			return { status: 'locked', reason: '另一进程正在 patch, 本次跳过' }
		}

		// 备份(P1-4): 同源才复用固定名; 否则带时间戳, 避免升级后只剩最旧那份
		const before = sha256(original)
		const bakFixed = bundlePath + BAK_SELFHEAL
		let bak = bakFixed
		if (existsSync(bakFixed)) {
			try {
				if (sha256(readFileSync(bakFixed)) !== before) {
					const ts = new Date().toISOString().replace(/[:.]/g, '-')
					bak = `${bakFixed}-${ts}`
					log(`[dsh-mcp-skill-hub] 旧备份与当前 bundle 不同源(dsh 已升级?), 新备份命名 ${bak}`)
				}
			} catch { bak = `${bakFixed}-${Date.now()}` }
		}
		if (bak !== bakFixed || !existsSync(bakFixed)) copyFileSync(bundlePath, bak)
		writeFileSync(bak + '.sha256', before + '\n')

		// P1-1 原子写: tmp + rename
		const tmp = bundlePath + '.selfheal.tmp'
		writeFileSync(tmp, next)
		renameSync(tmp, bundlePath)

		// 写后校验
		const verify = readFileSync(bundlePath).toString('utf8')
		for (const a of ANCHORS) {
			// 整行替换路径: 必须含完整 to。
			// 兜底路径(上游重排): 只要求语义等价 —— 该锚点的 needle 附近
			// 已带上 authProvider(否则 verify-failed 会把正确的兜底成果回滚掉)。
			if (verify.includes(a.to)) continue
			const fb = FALLBACKS.find((f) => f.id === a.id)
			if (fb) {
				const vi = verify.indexOf(fb.needle)
				if (vi !== -1) {
					const vEnd = verify.indexOf('\n', vi)
					const vLine = verify.slice(vi, vEnd === -1 ? verify.length : vEnd)
					if (fb.mode === 'append' && vLine.includes('authProvider')) continue
					if (fb.mode === 'prepend' && verify.slice(Math.max(0, vi - 400), vi).includes('getAuthProvider')) continue
				}
			}
			writeFileSync(bundlePath, original)
			return { status: 'verify-failed', anchor: a.id, reason: '写后校验失败, 已恢复' }
		}

		// P2-1 sidecar: 记录 patch 元数据, 供升级检测与回滚前校验
		try {
			writeFileSync(bundlePath + SIDECAR_SUFFIX, JSON.stringify({
				mcpClientVersion: mcpClientVersion(bundlePath),
				bundleShaBefore: before,
				bundleShaAfter: sha256(Buffer.from(next, 'utf8')),
				patchedAt: new Date().toISOString(),
				anchors: applied,
				pluginVersion: opts.pluginVersion || 'unknown',
				backup: bak,
			}, null, 2) + '\n')
		} catch { /* sidecar 失败不影响 patch 本身 */ }

		return {
			status: 'patched',
			applied,
			skipped,
			bak,
			before: before.slice(0, 16),
			after: sha256(Buffer.from(next, 'utf8')).slice(0, 16),
			mcpClientVersion: mcpClientVersion(bundlePath),
		}
	} catch (e) {
		return { status: 'error', reason: String(e?.message || e) }
	} finally {
		releaseLock(lockPath)
	}
}

/**
 * 自愈入口 —— dsh 启动时调用。
 *
 * @param {object}  [opts]
 * @param {boolean} [opts.autoFix=true]  false = 只检测不补(体检模式)
 * @param {function}[opts.log]           日志函数, 默认 console.log
 * @param {function}[opts.alarm]         异常状态告警函数, 默认写 stderr
 * @returns {Promise<{ok:boolean, status:string, detail:object}>}
 */
export async function selfHealOauthSeam(opts = {}) {
	const log = opts.log || console.log
	// P0-2: 异常状态必须"发声", 不能静默 return ok:true
	const alarm = opts.alarm || ((msg) => { try { process.stderr.write(msg + '\n') } catch { /* ignore */ } })

	if (process.env.DSH_MCP_SKILL_HUB_NO_SELF_HEAL) {
		return { ok: true, status: 'disabled', detail: {} }
	}

	const found = await findBundle()
	if (!found) {
		return { ok: true, status: 'bundle-not-found', detail: {} }
	}

	let state
	try {
		state = inspectBundle(found.path)
	} catch (e) {
		return { ok: true, status: 'read-failed', detail: { via: found.via, path: found.path, reason: String(e?.message || e) } }
	}

	// P1-3/P0-2: bundle 损坏必须发声(半写/截断曾让 OAuth 静默死且无现场)。
	// 只对"曾是 mcp-client bundle 但坏了"报 corrupt; 完全不像 bundle 的
	// (空文件/任意 JS)仍走 not-applicable —— 那通常是路径探测错了, 不是损坏。
	const looksLikeBundle = (() => {
		try {
			const t = readFileSync(found.path, 'utf8')
			return t.includes('createTransport') || t.includes('StreamableHTTPClientTransport')
		} catch { return false }
	})()
	if (state.corrupt && looksLikeBundle) {
		alarm(`[dsh-mcp-skill-hub] OAuth seam 自愈中止: bundle 可能已损坏 —— ${state.corrupt}`)
		alarm(`[dsh-mcp-skill-hub] bundle: ${found.path}; 请先还原备份再跑 scripts/patch-installed.sh --apply`)
		return { ok: true, status: 'corrupt', detail: { via: found.via, path: found.path, corrupt: state.corrupt } }
	}

	if (state.patched) {
		return { ok: true, status: 'already', detail: { via: found.via, path: found.path } }
	}

	if (!opts.autoFix) {
		return { ok: true, status: 'needs-patch', detail: { via: found.via, path: found.path, missing: state.missing } }
	}

	const r = await applyPatch(found.path, { log, force: opts.force, pluginVersion: opts.pluginVersion })
	const detail = { via: found.via, path: found.path, ...r }

	switch (r.status) {
		case 'patched':
			log(`[dsh-mcp-skill-hub] OAuth seam 已自动修复 (${r.applied.join(', ')}); 备份 ${r.bak}`)
			log('[dsh-mcp-skill-hub] 重启 dsh profile 后 MCP OAuth 即可用')
			return { ok: true, status: 'patched', detail }
		case 'already':
			return { ok: true, status: 'already', detail }
		case 'locked':
			log('[dsh-mcp-skill-hub] OAuth seam 自愈: 另一进程正在 patch, 本次跳过')
			return { ok: true, status: 'already', detail }
		case 'not-applicable':
			alarm(`[dsh-mcp-skill-hub] OAuth seam 自愈跳过: 该文件不是预期的 mcp-client bundle (${found.via}: ${found.path})`)
			return { ok: true, status: 'not-applicable', detail }
		case 'anchor-missing':
			alarm(`[dsh-mcp-skill-hub] OAuth seam 锚点漂移(锚点 ${r.anchor} 未命中) —— dsh 可能已升级, 补丁未应用, MCP OAuth 将不可用`)
			alarm(`[dsh-mcp-skill-hub] bundle: ${found.path}; 手工执行 scripts/verify-patch-applied.sh 查看详情`)
			return { ok: true, status: 'anchor-missing', detail }
		case 'verify-failed':
			alarm(`[dsh-mcp-skill-hub] OAuth seam 自愈失败: ${r.reason}`)
			return { ok: true, status: 'verify-failed', detail }
		case 'error':
			alarm(`[dsh-mcp-skill-hub] OAuth seam 自愈异常: ${r.reason}`)
			alarm('[dsh-mcp-skill-hub] 不影响 dsh 启动; 手工执行 scripts/patch-installed.sh --apply')
			return { ok: true, status: 'error', detail }
		default:
			alarm(`[dsh-mcp-skill-hub] OAuth seam 自愈未知状态 ${r.status}`)
			return { ok: true, status: r.status, detail }
	}
}

export default { ANCHORS, findBundle, inspectBundle, applyPatch, selfHealOauthSeam }
