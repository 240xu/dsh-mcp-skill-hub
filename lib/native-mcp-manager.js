/**
 * 原生 MCP 会话管理器: 决定接管哪些行、维持连接、失败时退避重连。
 *
 * 为什么从 index.js 搬出来: 重连是有状态的逻辑(定时器、代次、幂等停止),
 * 藏在 apply() 里既无法单测, 也容易被 HMR 重入搞乱。这里保持纯依赖注入,
 * 由 index.js 提供 ctx / 行读取器 / 日志。
 *
 * 与 dsh-mcp-client 的分工(必须遵守, 否则工具会被注册两次):
 *   本插件只接管 patch 中 `disabled: true` 的 streamable-http 行;
 *   若某行在配置里被点名接管但 dsh 侧仍 enabled, **拒绝接管**并告警。
 */

import { createNativeSession } from './native-mcp.js'
import { backoffDelay, describeRetry, isRetriable, RETRY_DEFAULTS } from './native-retry.js'

/**
 * @param {object} args
 * @param {object} args.ctx            dsh Context(inject 必须含 tools)
 * @param {() => Array} args.rows      返回 patch 行(每项含 id/enabled/config)
 * @param {string[]} [args.takeover]   显式点名要接管的行 id
 * @param {(id, config) => object} [args.providerFor] 取该行的 OAuth provider
 * @param {object} [args.retry]        退避参数(baseMs/maxMs/maxAttempts)
 * @param {(m: string) => void} [args.log]
 * @param {string} [args.clientName]
 * @param {string} [args.clientVersion]
 */
export function createNativeManager({
	ctx,
	rows,
	takeover,
	providerFor,
	retry = {},
	log,
	clientName = 'dsh-mcp-skill-hub',
	clientVersion = '0.0.0',
}) {
	const cfg = { ...RETRY_DEFAULTS, ...retry }
	const say = (m) => { try { log ? log(m) : ctx?.logger?.warn?.(m) } catch {} }

	/** id -> { session, timers:Set, generation, retrying, attempt, lastError } */
	const entries = new Map()
	const explicit = new Set((takeover || []).map(String))
	/** 每次 stopAll 递增; 所有异步回调都必须核对代次, 否则旧的重连会复活。 */
	let generation = 0

	const candidates = () => {
		let list = []
		try { list = rows() || [] } catch { return [] }
		return list.filter((r) => r?.config?.transport === 'streamable-http' && !!r?.config?.url)
	}

	/** 是否应接管: 必须 dsh 侧已 disabled, 否则双注册。 */
	const shouldTakeOver = (row) => {
		const wanted = explicit.has(String(row.id)) || row.enabled === false
		if (!wanted) return false
		if (row.enabled !== false) {
			say(`[native-mcp] row ${row.id} is listed in nativeTakeover but still enabled in dsh; ` +
				`refusing to take over (duplicate tool registration would make calls flaky)`)
			return false
		}
		return true
	}

	const entryOf = (id) => {
		let e = entries.get(id)
		if (!e) {
			e = { session: null, timer: null, generation, retrying: false, attempt: 0, lastError: '' }
			entries.set(id, e)
		}
		return e
	}

	const clearTimer = (e) => {
		if (e.timer) { clearTimeout(e.timer); e.timer = null }
		e.retrying = false
	}

	const dropSession = async (e) => {
		const s = e.session
		e.session = null
		if (s) { try { await s.close() } catch {} }
	}

	/** 尝试建立连接; 失败则按策略排下一次重试。 */
	async function attempt(row, { autoRetry = true } = {}) {
		const id = String(row.id)
		const e = entryOf(id)
		const gen = e.generation
		await dropSession(e)
		if (gen !== generation) return
		let provider
		try { provider = providerFor?.(id, row.config) } catch {}
		const session = createNativeSession({
			ctx,
			serverName: row.config.serverName || id,
			serverUrl: row.config.url,
			...(provider ? { authProvider: provider } : {}),
			clientName,
			clientVersion,
			logger: say,
		})
		e.session = session
		try {
			await session.connect()
			if (gen !== generation) { await session.close().catch(() => {}); return }
			clearTimer(e)
			e.attempt = 0
			e.lastError = ''
			return { ok: true }
		} catch (err) {
			e.lastError = String((err && err.message) || err)
			await dropSession(e)
			if (gen !== generation) return { ok: false }
			if (!autoRetry || !isRetriable(err)) {
				clearTimer(e)
				return { ok: false, error: err }
			}
			const delay = backoffDelay(e.attempt, cfg)
			e.attempt += 1
			e.retrying = true
			say(`[native-mcp] ${id} retry ${describeRetry({ attempt: e.attempt - 1, nextDelayMs: delay, error: err })}`)
			if (e.timer) clearTimeout(e.timer)
			e.timer = setTimeout(() => {
				e.timer = null
				if (gen !== generation) return
				// 行可能在这期间被删掉或被重新启用
				const fresh = candidates().find((r) => String(r.id) === id)
				if (!fresh || !shouldTakeOver(fresh)) { clearTimer(e); return }
				attempt(fresh).catch(() => {})
			}, delay)
			// 定时器不该拖住进程退出(测试与 dsh 重启都需要能及时结束)
			try { e.timer.unref?.() } catch {}
			return { ok: false, error: err }
		}
	}

	return {
		/** 启动全部接管行。串行执行, 避免同时打太多上游。 */
		async startAll() {
			const active = []
			const failed = []
			for (const row of candidates()) {
				if (!shouldTakeOver(row)) continue
				const r = await attempt(row)
				if (r.ok) active.push(String(row.id))
				else failed.push(String(row.id))
			}
			return { active, failed }
		},

		/** token 变新后重连(授权完成 / 主动续期成功)。 */
		async reconnect(id) {
			const key = String(id)
			const e = entries.get(key)
			if (e) { clearTimer(e); e.attempt = 0; e.lastError = '' }
			const row = candidates().find((r) => String(r.id) === key)
			if (!row || !shouldTakeOver(row)) {
				await this.stop(key)
				return
			}
			await attempt(row)
		},

		async stop(id) {
			const key = String(id)
			const e = entries.get(key)
			if (!e) return
			e.generation = ++generation
			clearTimer(e)
			await dropSession(e)
			entries.delete(key)
		},

		async stopAll() {
			generation += 1
			const all = [...entries.values()]
			entries.clear()
			for (const e of all) {
				e.generation = generation
				clearTimer(e)
				await dropSession(e)
			}
		},

		listActive() {
			return [...entries.entries()].filter(([, e]) => e.session && !e.retrying).map(([id]) => id)
		},

		listRetrying() {
			return [...entries.entries()].filter(([, e]) => e.retrying).map(([id, e]) => ({ id, attempt: e.attempt, lastError: e.lastError }))
		},

		listFailed() {
			return [...entries.entries()]
				.filter(([, e]) => !e.session && !e.retrying)
				.map(([id, e]) => ({ id, error: e.lastError }))
		},

		/** 诊断: 每个被接管会话已注册的工具名与注册失败详情。 */
		listTools() {
			const out = {}
			for (const [id, e] of entries) {
				out[id] = {
					registered: e.session?.registeredNames || [],
					failures: e.session?.registrationFailures || [],
				}
			}
			return out
		},

		/** 汇总状态, 供 /state 一次取全。 */
		status() {
			return {
				available: true,
				active: this.listActive(),
				retrying: this.listRetrying(),
				failed: this.listFailed(),
				tools: this.listTools(),
			}
		},
	}
}
