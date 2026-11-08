/**
 * 原生 MCP 会话管理器的重连策略(纯逻辑, 无 IO —— 便于先红后绿)。
 *
 * 为什么要重连: 实测量到 `connect failed: This operation was aborted`(网络抖动),
 * 该行就一直是 failed 直到下次重启 dsh。官方 mcp-client 是有重连的, 若我们
 * 没有, 迁移 OAuth 行反而是降级 —— 一次启动抖动会让工具整段消失且不自愈。
 *
 * 设计要点:
 *   - **鉴权错误不重试**。401/403 重试只会刷上游, 且授权必须人工介入;
 *     重试反而会掩盖「需要授权」这个状态。
 *   - 指数退避 + 抖动, 上限封顶, 避免多行同时重连打爆上游。
 *   - 退避只跑在**当前这次失败之后**, 成功后立即归零。
 */

/** 默认退避参数(毫秒)。测试可注入更小的值。 */
export const RETRY_DEFAULTS = Object.freeze({
	baseMs: 2000,
	maxMs: 5 * 60 * 1000,
	// 2s,4s,8s,16s,32s,64s,128s,256s,300s,300s...
	maxAttempts: Infinity,
})

/**
 * 是否值得重试。
 *
 * 判定顺序很重要: 先看是否鉴权类错误(不重试), 再看是否明显永久错误。
 * 未知错误倾向于**重试** —— 网络层的瞬时故障占绝大多数, 而永久性错误
 * 重试几次也无害(有退避上限), 比误判成永久后静默更可接受。
 */
export function isRetriable(err) {
	if (!err) return true
	// 鉴权: 需要人工介入, 重试无意义。
	// 必须**穿透 cause 链**: SDK 拿到 401 会先尝试 OAuth discovery, 失败后把
	// 原始 401 包成 `fetch failed`, 顶层就没有 status 了。只看顶层会把这种
	// 「其实需要授权」的情况误判成网络抖动而无限重试。
	for (let e = err, depth = 0; e && depth < 6; e = e.cause ?? e.error, depth += 1) {
		const st = Number(e.status ?? e.statusCode ?? e.response?.status)
		if (st === 401 || st === 403) return false
		const nm = String(e.name || e.constructor?.name || '')
		if (nm === 'UnauthorizedError' || nm === 'InsufficientScopeError') return false
	}
	const status = Number(err.status ?? err.statusCode ?? err.response?.status)
	// 4xx(除 401/403 已处理): 请求本身不合法, 重试不会改变结果
	if (Number.isFinite(status) && status >= 400 && status < 500) return false
	// 配置类错误: 永远重试不出来
	const msg = String(err.message || err)
	if (/invalid url|ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(msg)) return false
	if (/archived|html|does not support|unsupported content type/i.test(msg)) return false
	return true
}

/**
 * 第 n 次(从 0 开始)重试前应等多久。
 *
 * 指数退避 + 全抖动: 抖动是为了让同时失败的多行错开, 否则它们会以同一节奏
 * 齐步重连(惊群)。上界封顶避免无限增长的等待。
 */
export function backoffDelay(attempt, { baseMs = RETRY_DEFAULTS.baseMs, maxMs = RETRY_DEFAULTS.maxMs, random = Math.random } = {}) {
	const n = Math.max(0, Number(attempt) || 0)
	// 先算指数上界, 再取抖动: 这样第 0 次落在 [0, baseMs), 不会一上来就等太久。
	// random() 理论上可能返回 1(测试里就会), 故用 min 夹住, 保证不越过封顶值。
	const ceiling = Math.min(maxMs, baseMs * Math.pow(2, n))
	const jittered = Math.floor(random() * ceiling)
	return Math.min(jittered, ceiling - 1)
}

/** 人类可读的退避说明, 供 /state 与日志使用。 */
export function describeRetry({ attempt, nextDelayMs, error }) {
	const errMsg = String((error && error.message) || error || '').slice(0, 120)
	const secs = Math.round((Number(nextDelayMs) || 0) / 100) / 10
	return `attempt ${attempt + 1} in ${secs}s: ${errMsg}`
}
