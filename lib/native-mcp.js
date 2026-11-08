/**
 * 原生 MCP 连接层 —— 不走 dsh-mcp-client 的 patch, 直接用公开 API。
 *
 * 为什么存在(2026-11-08 竞品调研后的架构修正):
 *   旧方案改写官方 `@deepseek-ai/dsh-mcp-client` 的编译产物, 把 authProvider
 *   从 config 透传到 SDK。代价是: 每次 dsh 升级都要重新打补丁, 卸载还要还原。
 *
 *   实际上不需要: 官方 SDK 的 `StreamableHTTPClientTransport` 本就接受
 *   `authProvider`, 而 dsh-mcp-client 公开导出了 `createMcpToolDefinition`。
 *   自己起 Client → 自己列工具 → 自己 ctx.tools.register, 全程只用公开 API。
 *
 * 边界: 本模块只管连接与工具注册。OAuth 交互流程、凭据存储、设置页 UI 仍由
 * 既有模块承担(oauth-provider.js / auth-store.js / client.js)。
 *
 * 铁律 6: 错误信息只含 name 与 host, 绝不含 token / query / fragment。
 */

import { createHash } from 'node:crypto'

/** 与 dsh 的 ToolRuntime 一致的公开名约束。 */
const NAME_MAX = 64
const SAFE = /[^A-Za-z0-9_-]/g

/** 端点的人类可读标签: 只保留 host, 丢掉 path/query/fragment(可能带凭据)。 */
export function safeEndpointLabel(url) {
	try {
		const u = new URL(String(url))
		return `${u.protocol}//${u.host}`
	} catch {
		return '(invalid url)'
	}
}

/**
 * 生成模型可见的工具名 `mcp__<server>__<raw>`。
 *
 * 约束: 总长 <= 64, 字符集 [A-Za-z0-9_-]。归一化会让不同原始名撞到一起
 * (例如 `a.b` 与 `a_b`), 因此**只要发生过替换或截断**, 就追加一段基于
 * (server, raw) 原始身份哈希的后缀 —— 与 dsh 自己的命名约定同口径。
 */
export function publicToolName(serverName, rawName) {
	const s = String(serverName ?? '')
	const r = String(rawName ?? '')
	const clean = (v) => v.replace(SAFE, '_')
	const joined = `mcp__${clean(s)}__${clean(r)}`
	const lossy = joined !== `mcp__${s}__${r}` || joined.length > NAME_MAX
	if (!lossy) return joined
	const hash = createHash('sha256').update(`${s}\u0000${r}`).digest('hex').slice(0, 12)
	// 与 dsh 自己的 derivePublicName 同口径: 64 - 12 - 1 = 51 字符头 + `_` + hash
	const head = joined.slice(0, NAME_MAX - hash.length - 1)
	return `${head}_${hash}`
}

/** 把上游 tools/list 的结果规范成内部形状。坏条目直接丢弃而不是让整次同步失败。 */
export function normalizeListedTools(serverName, listed) {
	const out = []
	for (const t of Array.isArray(listed) ? listed : []) {
		const rawName = typeof t?.name === 'string' ? t.name : ''
		if (rawName === '') continue
		out.push({
			rawName,
			publicName: publicToolName(serverName, rawName),
			description: typeof t.description === 'string' ? t.description : '',
			inputSchema: t.inputSchema && typeof t.inputSchema === 'object'
				? t.inputSchema
				: { type: 'object', properties: {} },
			...(t.outputSchema !== undefined ? { outputSchema: t.outputSchema } : {}),
			...(t.taskRequired === true ? { taskRequired: true } : {}),
		})
	}
	return out
}

/** 组装 createMcpToolDefinition 的入参。call 一律转给 session, 由它持有 client。 */
export function buildToolOptions({ ctx, session, tool, serverName }) {
	return {
		name: tool.publicName,
		rawName: tool.rawName,
		description: tool.description,
		inputSchema: tool.inputSchema,
		...(tool.outputSchema !== undefined ? { outputSchema: tool.outputSchema } : {}),
		...(tool.taskRequired === true ? { taskRequired: true } : {}),
		call: (args, execution) => session.callTool(tool.rawName, args, execution),
		// serverName 不参与 ToolDefinition 形状, 仅用于诊断时拼错误信息
		...(serverName ? {} : {}),
	}
}

/**
 * 解析 dsh 自带的两个包。
 *
 * 关键: 插件不该把 @modelcontextprotocol/client 与 @deepseek-ai/dsh-mcp-client
 * 声明成自己的依赖 —— 那样会装出第二份 SDK, 导致 transport 类型判等失败、
 * 以及 OAuth provider 走另一套内部状态。必须**复用宿主那一份**。
 *
 * Termux 的全局安装布局是嵌套的:
 *   <prefix>/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-mcp-client
 *   <prefix>/lib/node_modules/@deepseek-ai/dsh/node_modules/@modelcontextprotocol/client
 * 因此不能靠 bare specifier(插件自己不在那条依赖树里), 必须先定位
 * dsh-mcp-client 的真实文件, 再以它为锚点用 createRequire 解析其余包。
 */
async function resolveHostModule(specifier) {
	const { createRequire } = await import('node:module')
	const { findBundle } = await import('./self-heal.mjs')
	// 锚点候选: 真实 bundle 路径 → 推测的包目录 → 常见全局前缀
	const anchors = []
	try {
		const found = await findBundle()
		const bundlePath = typeof found === 'string' ? found : found?.path
		if (bundlePath) {
			anchors.push(bundlePath)
			// 从 .../dsh-mcp-client/lib/index.js 回到包根
			anchors.push(bundlePath.replace(/\/lib\/index\.js$/, '/package.json'))
		}
	} catch {}
	anchors.push(
		'/data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-mcp-client/package.json',
		'/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-mcp-client/package.json',
		'/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-mcp-client/package.json',
	)
	for (const anchor of anchors) {
		try {
			const req = createRequire(anchor)
			return req(specifier)
		} catch {}
	}
	// 最后再试 bare specifier(开发态把宿主依赖 link 进插件时可用)
	try {
		const req = createRequire(import.meta.url)
		return req(specifier)
	} catch {}
	throw new Error(`cannot resolve ${specifier} from the host dsh installation`)
}

/** 延迟加载 SDK 与 dsh 的公开桥接函数(避免模块顶层就绑死路径)。 */
async function loadDeps(deps = {}) {
	const Client = deps.Client ?? await resolveHostModule('@modelcontextprotocol/client').then((m) => m.Client)
	const Transport = deps.StreamableHTTPClientTransport
		?? await resolveHostModule('@modelcontextprotocol/client').then((m) => m.StreamableHTTPClientTransport)
	const createDef = deps.createMcpToolDefinition
		?? await resolveHostModule('@deepseek-ai/dsh-mcp-client').then((m) => m.createMcpToolDefinition)
	if (typeof Client !== 'function') throw new Error('native-mcp: Client unavailable from host SDK')
	if (typeof Transport !== 'function') throw new Error('native-mcp: StreamableHTTPClientTransport unavailable from host SDK')
	if (typeof createDef !== 'function') throw new Error('native-mcp: createMcpToolDefinition unavailable from host dsh-mcp-client')
	return { Client, Transport, createDef }
}

/**
 * 建立一个到单个 MCP 服务器的原生会话。
 *
 * 生命周期: connect() → (tools 已注册) → close()。
 * close() 幂等, 且必定注销全部已注册工具 —— 否则 dsh 会留着指向已关闭
 * client 的悬挂 tool, 模型一调就报连接错误。
 */
export function createNativeSession({
	ctx,
	serverName,
	serverUrl,
	authProvider,
	clientName = 'dsh-mcp-skill-hub',
	clientVersion = '0.0.0',
	timeoutMs = 20000,
	logger = null,
	deps = {},
}) {
	const label = safeEndpointLabel(serverUrl)
	const log = logger ?? (() => {})
	const unregisters = []
	const registeredNames = []
	const failures = []
	let client = null
	let closed = false
	let connecting = null

	const fail = (stage, err) => {
		const msg = String((err && err.message) || err || 'unknown')
		// 只保留阶段与 host: upstream 的错误里可能带完整 URL(含 query token)
		const e = new Error(`[native-mcp:${serverName}@${label}] ${stage} failed: ${msg}`)
		e.cause = err
		return e
	}

	async function doConnect() {
		const { Client, Transport, createDef } = await loadDeps(deps)
		const transport = new Transport(new URL(String(serverUrl)), {
			...(authProvider ? { authProvider } : {}),
		})
		const c = new Client({ name: clientName, version: clientVersion })
		client = c
		try {
			await c.connect(transport)
		} catch (e) {
			try { await transport.close?.() } catch {}
			try { process.stderr.write(`[native-mcp:${serverName}] connect failed: ${String((e && e.message) || e).slice(0,160)}\n`) } catch {}
			throw fail('connect', e)
		}
		// 连接成功不单独刷日志: 注册摘要里已含"连上了多少工具", 重复且噪音。

		let listed
		try {
			listed = await c.listTools()
		} catch (e) {
			try { await c.close?.() } catch {}
			throw fail('tools/list', e)
		}
		const rawListed = listed?.tools
		log(`[native-mcp:${serverName}] tools/list -> ${Array.isArray(rawListed) ? rawListed.length : "non-array"} tool(s)`)
		const tools = normalizeListedTools(serverName, rawListed)
		log(`[native-mcp:${serverName}] normalized to ${tools.length} tool(s): ${tools.map((t) => t.publicName).join(",") || "(none)"}`)
		// 注册阶段: 部分工具注册失败不应让其余工具一起消失(与 dsh 的
		// registrationFailure: 'contain' 同口径), 但我们要知道发生了什么。
		for (const tool of tools) {
			try {
				const def = createDef(ctx, buildToolOptions({ ctx, session, tool, serverName }))
				const dispose = ctx.tools.register(def)
				unregisters.push(typeof dispose === 'function' ? dispose : () => {})
				registeredNames.push(tool.publicName)
			} catch (e) {
				// 注册失败是「工具静默消失」这种最难受故障的唯一线索, 必须留痕
				const detail = String((e && e.stack) || (e && e.message) || e).slice(0, 600)
				log(`[native-mcp:${serverName}] register ${tool.publicName} failed: ${detail}`)
				failures.push({ name: tool.publicName, error: String((e && e.message) || e) })
			}
		}
		try {
			process.stderr.write(`[native-mcp:${serverName}] registered ${registeredNames.length}/${tools.length}: ${registeredNames.join(",") || "(none)"}\n`)
		} catch {}
		return tools
	}

	const session = {
		serverName,
		get toolsCount() { return unregisters.length },
		get registeredNames() { return registeredNames.slice() },
		get registrationFailures() { return failures.slice() },
		get isOpen() { return !closed && client != null },
		/** 连接并注册工具。重复调用复用同一个 in-flight Promise。 */
		connect() {
			if (closed) return Promise.reject(fail('connect', new Error('session already closed')))
			if (!connecting) connecting = doConnect()
			return connecting
		},
		/** 供 ToolDefinition.call 转调。 */
		async callTool(rawName, args, execution) {
			if (!client) throw fail('tools/call', new Error('not connected'))
			const timeout = new AbortController()
			const timer = setTimeout(() => timeout.abort(), timeoutMs)
			try {
				const signal = execution?.signal
					? AbortSignal.any([execution.signal, timeout.signal])
					: timeout.signal
				return await client.callTool({ name: rawName, arguments: args }, { signal })
			} catch (e) {
				if (timeout.signal.aborted && !(execution?.signal?.aborted)) {
					throw fail('tools/call', new Error(`timed out after ${timeoutMs}ms`))
				}
				throw fail('tools/call', e)
			} finally {
				clearTimeout(timer)
			}
		},
		/** 幂等关闭: 先注销工具, 再关 client。 */
		async close() {
			if (closed) return
			closed = true
			for (const dispose of unregisters.splice(0)) {
				try { dispose() } catch {}
			}
			registeredNames.length = 0
			const c = client
			client = null
			if (c) { try { await c.close?.() } catch {} }
		},
	}

	return session
}
