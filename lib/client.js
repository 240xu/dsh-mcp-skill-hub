/**
 * dsh-mcp-skill-hub — client half (web).
 * 设置页新分区「MCP 与技能」:双 Tab 管理 MCP 服务器与技能文件。
 * 数据来自本插件 host 半的 loopback API(/api/dsh-mcp-skill-hub/*)。
 */
window.__ModuleLoader__.load({
	id: "dsh-mcp-skill-hub/client",
	factory: (require) => {
		// CJS→ESM 打包前言：本文件引用 `exports.apply` / `exports.inject`，
		// 而 package.json 是 "type":"module" —— ESM 作用域里没有 `exports`，
		// 缺这段会直接 ReferenceError: exports is not defined，
		// 表现为 web boot: "1 entry did not activate"。
		// 对照 @240xu/dsh-websearch/lib/client.js：每个正常加载的客户端插件都有。
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");
		const react_jsx_runtime = require("react/jsx-runtime");

		const NS = "mcp-skill-hub.settings";
		const API = "/api/dsh-mcp-skill-hub";

		//#region i18n
		const zh = {
			nav: "MCP 与技能",
			tabMcp: "MCP 服务器", tabSkills: "技能",
			addServer: "＋ 新增服务器", refresh: "刷新",
			hotBadge: "热生效", hmrHint: "本 profile 已启用 hmr,MCP 改动立即生效", restartBanner: "配置将写入 profile,重启 dsh 后生效(可在插件设置里启用 hmr 获得热生效)",
			live: "运行中", notLive: "未运行", transportHttp: "http", transportStdio: "stdio",
			edit: "编辑", del: "删除", confirmDeleteMcp: "删除 MCP 行?该行将从 cordis.patch.yml 移除。",
			confirmDeleteSkill: "删除该技能?文件将移入 .trash/,可手工恢复。",
			saved: "已保存", appliedHot: "已热生效", appliedWatch: "已写入,等待热重载", appliedRestart: "已写入,重启后生效",
			newSkill: "＋ 新建技能", editSkill: "编辑技能", skillName: "名称", scope: "写入位置",
			scopeUser: "用户 ~/.dsh/skills", scopeProject: "项目", description: "描述", whenToUse: "触发时机(可选)",
			content: "正文(Markdown)", save: "保存", cancel: "取消",
			serverName: "serverName", url: "URL", command: "命令", args: "参数(每行一条)",
			env: "环境变量(每行 KEY=VALUE)", cwd: "工作目录(可选)", headers: "Headers(每行 KEY=VALUE)",
			enabled: "启用", modelInvocable: "模型可调用", readOnlySource: "内建/运行时技能只读",
			noServers: "没有 MCP 服务器,点击右上角新增。", noSkills: "没有加载任何技能。",
			apiFail: "API 不可用:", parseFail: "以下行无法解析(非标准写法),只读展示:",
			confirmDelete: "确认删除", trashNote: "已移入 .trash:",
			nameLocked: "名称创建后锁定(改名=删旧建新)",
			authorize: "授权", authStatus: "授权状态",
			authNotAuth: "未授权", authPending: "授权中", authOk: "已授权", authExpired: "授权已超时,请重新点击授权",
			authAlready: "API Token 已可用", authNeed: "需要 OAuth 授权", authBusy: "处理中…",
			authFailed: "授权失败", authLogout: "取消授权", authHint: "用 OAuth 授权后可用 Cloudflare 账号访问;保留的静态 API Token 仍可继续使用。",
			authRowHint: "该服务器需要 OAuth 授权后才能使用。",
			authProbeFailed: "无法确认该服务器是否需要授权(网络不可达),可点击授权手动尝试。",
			seamAnchorMissing: "OAuth 补丁与当前 dsh 版本不匹配(补丁已失效)。请执行 verify-patch-applied.sh 查看详情,OAuth 功能暂不可用。",
			seamNotApplicable: "未找到 dsh 的 mcp-client bundle,OAuth 补丁无法应用。",
			seamCorrupt: "dsh 的 mcp-client bundle 可能已损坏(写入被截断)。请先从备份还原,再执行 patch-installed.sh --apply。",
			seamVerifyFailed: "OAuth 补丁写入后校验失败,已自动还原原文件。请手工执行 patch-installed.sh --apply。",
			seamNeedsPatch: "OAuth 补丁缺失,正在等待自动应用。",
			seamReadFailed: "读取 dsh 的 mcp-client bundle 失败。",
			seamError: "OAuth 补丁自愈失败,功能暂不可用。请手工执行 patch-installed.sh --apply。"
		};
		const en = {
			nav: "MCP & Skills",
			tabMcp: "MCP servers", tabSkills: "Skills",
			addServer: "＋ Add server", refresh: "Refresh",
			hotBadge: "hot-apply", hmrHint: "hmr is enabled in this profile; MCP changes apply immediately", restartBanner: "Changes are written to the profile and need a dsh restart (enable hmr in this profile for hot-apply)",
			live: "live", notLive: "not running", transportHttp: "http", transportStdio: "stdio",
			edit: "Edit", del: "Delete", confirmDeleteMcp: "Delete this MCP row? It will be removed from cordis.patch.yml.",
			confirmDeleteSkill: "Delete this skill? The file moves into .trash/ (recoverable).",
			saved: "Saved", appliedHot: "applied live", appliedWatch: "written, awaiting hot reload", appliedRestart: "written, restart required",
			newSkill: "＋ New skill", editSkill: "Edit skill", skillName: "Name", scope: "Write to",
			scopeUser: "User ~/.dsh/skills", scopeProject: "Project", description: "Description", whenToUse: "When to use (optional)",
			content: "Body (Markdown)", save: "Save", cancel: "Cancel",
			serverName: "serverName", url: "URL", command: "Command", args: "Args (one per line)",
			env: "Env (KEY=VALUE per line)", cwd: "Working dir (optional)", headers: "Headers (KEY=VALUE per line)",
			enabled: "Enabled", modelInvocable: "Model-invocable", readOnlySource: "Bundled/runtime skills are read-only",
			noServers: "No MCP servers yet — add one.", noSkills: "No skills loaded.",
			apiFail: "API unavailable:", parseFail: "Unparsed rows (non-standard shape), shown read-only:",
			confirmDelete: "Confirm delete", trashNote: "Moved to .trash:",
			nameLocked: "Name is locked after creation (rename = delete & recreate)",
			authorize: "Authorize", authStatus: "Auth status",
			authNotAuth: "Not authorized", authPending: "Authorizing", authOk: "Authorized", authExpired: "Authorization timed out — click Authorize again",
			authAlready: "API Token already works", authNeed: "OAuth authorization required", authBusy: "Working…",
			authFailed: "Auth failed", authLogout: "Revoke", authHint: "Authorize with OAuth to use your Cloudflare account; any static API Token kept in the row still works.",
			authRowHint: "This server needs OAuth authorization before it can be used.",
			authProbeFailed: "Could not verify whether this server needs authorization (network unreachable). You can click Authorize to try manually.",
			seamAnchorMissing: "The OAuth patch no longer matches the installed dsh version and has stopped working. Run verify-patch-applied.sh for details; MCP OAuth is unavailable until then.",
			seamNotApplicable: "Could not locate dsh's mcp-client bundle, so the OAuth patch cannot be applied.",
			seamCorrupt: "dsh's mcp-client bundle may be corrupted (write truncated). Restore from backup, then run patch-installed.sh --apply.",
			seamVerifyFailed: "Post-write verification of the OAuth patch failed; the original file was restored. Run patch-installed.sh --apply manually.",
			seamNeedsPatch: "The OAuth patch is missing and waiting to be applied automatically.",
			seamReadFailed: "Failed to read dsh's mcp-client bundle.",
			seamError: "OAuth patch self-heal failed; the feature is unavailable. Run patch-installed.sh --apply manually."
		};
		//#endregion

		//#region 基础设施
		function createStore(initial) {
			let snap = initial;
			const listeners = new Set();
			return {
				getSnapshot: () => snap,
				subscribe: (l) => (listeners.add(l), () => listeners.delete(l)),
				set: (next) => { snap = next; listeners.forEach((l) => l()); }
			};
		}
		async function api(method, path, body) {
			const opt = { method, headers: {} };
			if (body !== undefined) { opt.headers["content-type"] = "application/json"; opt.body = JSON.stringify(body); }
			const res = await fetch(API + path, opt);
			let data;
			try { data = await res.json(); } catch {}
			if (!res.ok) throw new Error((data && data.error) || ("HTTP " + res.status));
			return data;
		}
		class HubController {
			constructor() {
				this.store = createStore({
					ready: false, error: "", busy: false, tab: "mcp",
					hmr: false, profile: null, toast: "",
					mcp: [], mcpAvailable: true, mcpError: "", patchMtimeMs: 0,
					skills: [], registryOk: true, projectRoots: []
				});
			}
			getSnapshot() { return this.store.getSnapshot(); }
			subscribe(l) { return this.store.subscribe(l); }
			set(patch) { this.store.set({ ...this.store.getSnapshot(), ...patch }); }
			say(msg) { this.set({ toast: msg }); setTimeout(() => { if (this.getSnapshot().toast === msg) this.set({ toast: "" }); }, 3500); }
			/**
			 * 注入 locale 感知的翻译函数。
			 *
			 * 2026-10-22 修: controller 原先直接用 tFallback(恒返 zh), 而 React 组件
			 * 用 props.t(跟随 ctx.locale)。→ 英文用户看到英文 UI + 中文 toast。
			 * apply 时用 ctx.locale.bind(NS) 注入; 未注入时退回 tFallback。
			 */
			setT(t) { if (typeof t === "function") this.t = t; }
			tr(key) { return (this.t || tFallback)(key); }
			async load() {
				try {
					const r = await api("GET", "/state");
					this.set({
						ready: true, error: "", profile: r.profile, hmr: !!r.hmr,
						mcp: r.mcp || [], mcpAvailable: r.mcpAvailable !== false,
						mcpError: r.mcpError || "", patchMtimeMs: r.patchMtimeMs || 0,
						skills: r.skills || [], registryOk: r.registryOk !== false,
						projectRoots: r.projectRoots || []
					});
				} catch (e) { this.set({ ready: true, error: String((e && e.message) || e) }); }
			}
			async post(path, body) {
				// 用计数器而非布尔: 两个并发 post 时, 先完成的那个若把 busy 置回 false,
				// UI 会误以为空闲(实际另一个请求还在飞) → 用户重复提交。
				const n = (this._inflight || 0) + 1;
				this._inflight = n;
				this.set({ busy: n > 0 });
				try {
					const r = await api("POST", path, body);
					await this.load();
					const applied = r.applied;
					this.say(applied === "hot" ? this.tr("appliedHot") : applied === "watch" ? this.tr("appliedWatch") : this.tr("appliedRestart"));
					return r;
				} finally {
					this._inflight = Math.max(0, (this._inflight || 1) - 1);
					this.set({ busy: this._inflight > 0 });
				}
			}
		}
		function tFallback(key) { return (zh[key] || key); }
		//#endregion

		//#region 通用控件
		const Toggle = ({ checked, onChange, disabled, title }) =>
			react_jsx_runtime.jsx("button", {
				type: "button", className: "dsh-hub-switch" + (checked ? " on" : ""),
				disabled: !!disabled, title: title || "", "aria-pressed": !!checked,
				onClick: (e) => { e.preventDefault(); if (!disabled) onChange(!checked); },
				children: react_jsx_runtime.jsx("span", { className: "dsh-hub-knob" })
			});
		/**
		 * 内联 SVG 图标(lucide 风格, currentColor)。
		 * 教义: 零 emoji —— 状态/动作一律用图标 + 文字, 不用 pictograph。
		 */
		const Icon = ({ name, size = 14 }) => {
			const paths = {
				// zap: 热生效
				zap: "M13 2L3 14h9l-1 8 10-12h-9l1-8z",
				// alert-triangle
				warn: "M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z M12 9v4 M12 17h.01",
				// x
				x: "M18 6L6 18M6 6l12 12",
			};
			const d = paths[name];
			if (!d) return null;
			return react_jsx_runtime.jsx("svg", {
				width: size, height: size, viewBox: "0 0 24 24", fill: "none",
				stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round",
				style: { flex: "none", verticalAlign: "-2px" },
				"aria-hidden": true, focusable: false,
				dangerouslySetInnerHTML: { __html: d.split(" M").map((seg, i) => `<path d="${i === 0 ? seg : "M" + seg}"/>`).join("") },
			});
		};
		const Badge = ({ children, tone }) =>
			react_jsx_runtime.jsx("span", { className: "dsh-hub-badge" + (tone ? " " + tone : ""), children });
		/**
		 * OAuth 授权状态徽章。
		 *
		 * 设计原则(用户反馈「所有 MCP 都挂授权按钮很莫名」后重做):
		 *   只有「已经有授权相关状态」的行才显示徽章。
		 *   not_authenticated 不在这里显示 —— 它由 needsAuth 判定后
		 *   另起一行的黄字提示 + 单个授权按钮承担。
		 *   already-works 不显示(静态 Token 已够用, 无需任何 OAuth 信息)。
		 */
		const AuthBadge = ({ status, t }) => {
			if (!status) return null;
			const map = {
				pending: ["warn", t("authPending")],
				authenticated: ["ok", t("authOk")],
				expired: ["warn", t("authExpired")],
				failed: ["danger", t("authFailed")]
			};
			const entry = map[status];
			if (!entry) return null;
			return react_jsx_runtime.jsx(Badge, { tone: entry[0], children: entry[1] });
		};
		const Btn = ({ children, onClick, kind, disabled, title }) =>
			react_jsx_runtime.jsx("button", {
				type: "button", className: "dsh-hub-btn" + (kind ? " " + kind : ""),
				onClick, disabled: !!disabled, title: title || "", children
			});
		/**
		 * OAuth seam 补丁健康横幅(P1-8)。
		 *
		 * 背景: dsh 升级会把 bundle 换回上游原版, 补丁失效。以前这完全静默 ——
		 * UI 照显示「已授权」, 而 MCP OAuth 已全废。现在 /oauth/status 回报 seam
		 * 状态, 非 patched/already 时在这里出红色横幅。
		 *
		 * 不显示的状态: not-checked / disabled(用户主动关闭) / bundle-not-found
		 * (本机没装 dsh 的 mcp-client, 探不到是正常的)。
		 */
		const SeamBanner = ({ seam, t }) => {
			if (!seam || !seam.status) return null;
			const silent = ["not-checked", "disabled", "bundle-not-found", "already", "patched", "locked"];
			if (silent.includes(seam.status)) return null;
			const msg = {
				"anchor-missing": t("seamAnchorMissing"),
				"not-applicable": t("seamNotApplicable"),
				corrupt: t("seamCorrupt"),
				"verify-failed": t("seamVerifyFailed"),
				"needs-patch": t("seamNeedsPatch"),
				"read-failed": t("seamReadFailed"),
				error: t("seamError"),
			}[seam.status] || t("seamError");
			return react_jsx_runtime.jsx("div", { className: "dsh-hub-banner danger", children: msg });
		};
		function Modal({ title, onClose, children }) {
			return react_jsx_runtime.jsx("div", {
				className: "dsh-hub-modal-overlay", onMouseDown: (e) => { if (e.target === e.currentTarget) onClose(); },
				children: react_jsx_runtime.jsxs("div", { className: "dsh-hub-modal", children: [
					react_jsx_runtime.jsxs("div", { className: "dsh-hub-modal-head", children: [
						react_jsx_runtime.jsx("b", { children: title }),
						react_jsx_runtime.jsx("button", { type: "button", className: "dsh-hub-btn", onClick: onClose, children: react_jsx_runtime.jsx(Icon, { name: "x", size: 14 }) })
					] }),
					children
				] })
			});
		}
		const Field = ({ label, children }) =>
			react_jsx_runtime.jsxs("label", { className: "dsh-hub-field", children: [
				react_jsx_runtime.jsx("span", { className: "dsh-hub-label", children: label }), children
			] });
		//#endregion

		//#region MCP Tab
		function targetSummary(row) {
			const c = row.config || {};
			if (c.transport === "streamable-http") return c.url || "";
			const args = (c.args || []).join(" ");
			return [c.command, args].filter(Boolean).join(" ");
		}
		/**
		 * 判定该行是否「需要授权」—— 学 opencode 的 MCPStatus 口径:
		 *   以 /oauth/status 的 **needsAuth 字段**为第一依据(服务端真实探测结论),
		 *   不拿 authStatus 猜。
		 *
		 * authStatus(store 状态)只用来处理「授权流程进行中/失败/超时」——
		 * 这些时候用户已经在授权流程里, 必须保留入口让他能继续或重试:
		 *   expired            授权超时, 需重新授权
		 *   failed             授权流程失败, 需重试
		 *   pending            授权进行中(保留入口让用户能看到进度)
		 *
		 * needsAuth 字段(服务端探测结论):
		 *   true               探测确认 401 → 需要授权
		 *   'unknown'          探测不可达 → 不猜但也不隐藏(黄字标「探测失败」)
		 *   false              明确不需要 → 不显示
		 *   undefined          尚未探测到(轮询未回) → 不显示
		 *
		 * 注意: 不用 not_authenticated 判 needs_auth: 它只表示「没有 token」,
		 * 公开服务(context7/exa/parallel)也是这个状态但不需要授权。
		 */
		const needsAuth = (row, authStatus, needsAuthMap) => {
			if (!row?.editable) return false;
			if (row.config?.transport !== "streamable-http") return false;
			const s = authStatus?.[row.id];
			// 授权流程已在走/失败/超时 → 保留入口
			if (s === "expired" || s === "failed" || s === "pending") return true;
			// 否则以服务端探测结论为准
			const n = needsAuthMap?.[row.id];
			return n === true || n === "unknown";
		};
		function McpTab({ state, t, actions }) {
			const [editing, setEditing] = react.useState(null); // {id?, server}
			const [confirmRow, setConfirmRow] = react.useState(null);
			/** row.id → auth status（由 /oauth/status 轮询得来）。 */
			const [authStatus, setAuthStatus] = react.useState({});
		/** row.id → /oauth/status 的 needsAuth 字段（true/false/'unknown'）。 */
		const [needsAuthMap, setNeedsAuthMap] = react.useState({});
		/** OAuth seam 补丁状态（P1-8）。null=尚未探到。 */
		const [seamState, setSeamState] = react.useState(null);
			const [authBusy, setAuthBusy] = react.useState(null);
			const rows = state.mcp || [];
			const unknown = rows.filter((r) => !r.editable);
			const httpRows = rows.filter((r) => r.config?.transport === "streamable-http");
			// 轮询本 tab 内 http 行的授权状态：只读、低频（10s），不打扰其它 tab。
			react.useEffect(() => {
				let alive = true;
				const poll = async () => {
					for (const row of httpRows) {
						try {
							const res = await api("GET", "/oauth/status?id=" + encodeURIComponent(row.id));
							if (!alive) return;
							setAuthStatus((prev) => (prev[row.id] === res.status ? prev : { ...prev, [row.id]: res.status }));
							setNeedsAuthMap((prev) => (prev[row.id] === res.needsAuth ? prev : { ...prev, [row.id]: res.needsAuth }));
							// P1-8: seam 补丁状态。非 patched/already 时面板顶部出红色横幅 ——
							// 此前 dsh 升级后补丁失效是静默的, 用户只看到「已授权」而功能全废。
							if (res.seam && res.seam.status) {
								setSeamState((prev) => (prev?.status === res.seam.status ? prev : res.seam));
							}
						} catch { /* 单个行失败不影响其它行 */ }
					}
				};
				poll();
				const timer = setInterval(poll, 10000);
				return () => { alive = false; clearInterval(timer); };
			}, [httpRows.map((r) => r.id).join(",")]);
			const startAuth = async (row) => {
				setAuthBusy(row.id);
				try {
					const res = await api("POST", "/oauth/start", { id: row.id });
					if (res.status === "already-works") {
						setAuthStatus((prev) => ({ ...prev, [row.id]: "already-works" }));
					} else if (res.authUrl) {
						window.open(res.authUrl, "_blank", "noopener,noreferrer");
						setAuthStatus((prev) => ({ ...prev, [row.id]: "pending" }));
					}
				} catch (e) {
					setAuthStatus((prev) => ({ ...prev, [row.id]: "failed" }));
				} finally { setAuthBusy(null); }
			};
			return react_jsx_runtime.jsxs("div", { className: "dsh-hub-list", children: [
				react_jsx_runtime.jsxs("div", { className: "dsh-hub-toolbar", children: [
					react_jsx_runtime.jsx(Btn, { onClick: () => setEditing({ id: null, server: { serverName: "", transport: "streamable-http", url: "", command: "", args: [], env: {}, headers: {}, cwd: "" }, enabled: true }), children: t("addServer") }),
					react_jsx_runtime.jsx(Btn, { onClick: actions.reload, disabled: state.busy, children: t("refresh") }),
					state.hmr
						? react_jsx_runtime.jsxs("span", { className: "dsh-hub-badge ok", title: t("hmrHint"), children: [
							react_jsx_runtime.jsx(Icon, { name: "zap", size: 12 }),
							t("hotBadge")
						] })
						: null
				] }),
				!state.mcpAvailable && react_jsx_runtime.jsx("div", { className: "dsh-hub-banner warn", children: t("apiFail") + " " + (state.mcpError || "patch 不可读") }),
				SeamBanner({ seam: seamState, t }),
				unknown.length > 0 && react_jsx_runtime.jsx("div", { className: "dsh-hub-banner warn", children: t("parseFail") + " " + unknown.map((r) => r.id).join(", ") }),
				rows.length === 0 && react_jsx_runtime.jsx("div", { className: "dsh-hub-empty", children: t("noServers") }),
				rows.map((row) => react_jsx_runtime.jsxs("div", { className: "dsh-hub-row", children: [
					react_jsx_runtime.jsx("span", { className: "dsh-hub-dot" + (row.enabled ? " on" : "") }),
					react_jsx_runtime.jsxs("span", { className: "dsh-hub-name", children: [row.id, " ", react_jsx_runtime.jsx(Badge, { children: (row.config?.transport === "stdio" ? t("transportStdio") : t("transportHttp")) })] }),
					react_jsx_runtime.jsx("span", { className: "dsh-hub-desc", children: targetSummary(row) }),
					row.live && react_jsx_runtime.jsx(Badge, { tone: "ok", children: t("live") }),
					!row.enabled && react_jsx_runtime.jsx(Badge, { tone: "dim", children: t("notLive") }),
					// 判定标准学 opencode: 只有真的 needs_auth 才显示授权入口,
					// 不预先给每个 http 行都挂授权按钮。
					row.config?.transport === "streamable-http" && row.editable && AuthBadge({ status: authStatus[row.id], t }),
					row.editable && react_jsx_runtime.jsx(Toggle, {
						checked: row.enabled, disabled: state.busy,
						onChange: () => actions.toggleMcp(row), title: t("enabled")
					}),
					row.editable && (confirmRow === row.id
						? react_jsx_runtime.jsxs(react.Fragment, { children: [
							react_jsx_runtime.jsx(Btn, { kind: "danger", onClick: () => { actions.deleteMcp(row); setConfirmRow(null); }, children: t("confirmDelete") }),
							react_jsx_runtime.jsx(Btn, { onClick: () => setConfirmRow(null), children: t("cancel") })
						] })
						: react_jsx_runtime.jsx(Btn, { kind: "danger", onClick: () => setConfirmRow(row.id), children: t("del") })),
					// 未授权行: 另起一行, 黄字提示 + 单个授权按钮。
					// 必须在 rows.map 回调内(row 作用域), 与主行同 key 前缀。
					row.config?.transport === "streamable-http" && row.editable && needsAuth(row, authStatus, needsAuthMap) && react_jsx_runtime.jsx("div", { className: "dsh-hub-row dsh-hub-auth-row", key: row.id + ":auth", children: [
						// 探测不可达时黄字改为「探测失败」文案(不猜, 但给用户授权入口)。
						react_jsx_runtime.jsx("span", { className: "dsh-hub-auth-warn", children: needsAuthMap?.[row.id] === "unknown" ? t("authProbeFailed") : t("authRowHint") }),
						react_jsx_runtime.jsx(Btn, {
							onClick: () => startAuth(row), disabled: state.busy || authBusy === row.id,
							title: t("authHint"), children: authBusy === row.id ? t("authBusy") : t("authorize")
						})
					] })
				] }, row.id)),
				editing && react_jsx_runtime.jsx(McpEditor, {
					t, editing, state, onClose: () => setEditing(null),
					onSave: async (server, id, enabled) => { await actions.saveMcp(server, id, enabled); setEditing(null); }
				})
			] });
		}
		function McpEditor({ t, editing, onClose, onSave }) {
			const s0 = editing.server || {};
			const [serverName, setName] = react.useState(s0.serverName || "");
			const [transport, setTransport] = react.useState(s0.transport || "streamable-http");
			const [url, setUrl] = react.useState(s0.url || "");
			const [command, setCommand] = react.useState(s0.command || "");
			const [cwd, setCwd] = react.useState(s0.cwd || "");
			const [argsText, setArgsText] = react.useState((s0.args || []).join("\n"));
			const [envText, setEnvText] = react.useState(Object.entries(s0.env || {}).map(([k, v]) => k + "=" + v).join("\n"));
			const [headersText, setHeadersText] = react.useState(Object.entries(s0.headers || {}).map(([k, v]) => k + "=" + v).join("\n"));
			const [enabled, setEnabled] = react.useState(editing.enabled !== false);
			const [err, setErr] = react.useState("");
			const parseKv = (text) => {
				const out = {};
				for (const line of String(text || "").split("\n")) {
					const l = line.trim();
					if (!l) continue;
					const i = l.indexOf("=");
					if (i > 0) out[l.slice(0, i).trim()] = l.slice(i + 1).trim();
				}
				return out;
			};
			const save = async () => {
				setErr("");
				const server = {
					serverName: serverName.trim(), transport,
					url: url.trim(), command: command.trim(), cwd: cwd.trim(),
					args: argsText.split("\n").map((x) => x.trim()).filter(Boolean),
					env: parseKv(envText), headers: parseKv(headersText)
				};
				if (!/^[A-Za-z0-9_-]{1,32}$/.test(server.serverName)) return setErr("serverName 需匹配 [A-Za-z0-9_-]{1,32}");
				if (transport === "streamable-http" && !/^https?:\/\//i.test(server.url)) return setErr("URL 必填且以 http(s):// 开头");
				if (transport === "stdio" && !server.command) return setErr("stdio 需要命令");
				try { await onSave(server, editing.id, enabled); }
				catch (e) { setErr(String((e && e.message) || e)); }
			};
			return react_jsx_runtime.jsxs(Modal, { title: editing.id ? "MCP · " + editing.id : t("addServer"), onClose, children: [
				react_jsx_runtime.jsxs("div", { className: "dsh-hub-grid2", children: [
					react_jsx_runtime.jsx(Field, { label: t("serverName"), children: react_jsx_runtime.jsx("input", { className: "dsh-hub-input", value: serverName, disabled: !!editing.id, onChange: (e) => setName(e.target.value), placeholder: "context7" }) }),
					react_jsx_runtime.jsx(Field, { label: "transport", children: react_jsx_runtime.jsxs("select", { className: "dsh-hub-select", value: transport, onChange: (e) => setTransport(e.target.value), children: [
						react_jsx_runtime.jsx("option", { value: "streamable-http", children: "streamable-http" }),
						react_jsx_runtime.jsx("option", { value: "stdio", children: "stdio" })
					] }) })
				] }),
				transport === "streamable-http"
					? react_jsx_runtime.jsx(Field, { label: t("url"), children: react_jsx_runtime.jsx("input", { className: "dsh-hub-input", value: url, onChange: (e) => setUrl(e.target.value), placeholder: "https://mcp.example.com/mcp" }) })
					: react_jsx_runtime.jsxs(react.Fragment, { children: [
						react_jsx_runtime.jsx(Field, { label: t("command"), children: react_jsx_runtime.jsx("input", { className: "dsh-hub-input", value: command, onChange: (e) => setCommand(e.target.value), placeholder: "/path/to/command" }) }),
						react_jsx_runtime.jsx(Field, { label: t("args"), children: react_jsx_runtime.jsx("textarea", { className: "dsh-hub-textarea", style: { minHeight: 60 }, value: argsText, onChange: (e) => setArgsText(e.target.value) }) }),
						react_jsx_runtime.jsx(Field, { label: t("env"), children: react_jsx_runtime.jsx("textarea", { className: "dsh-hub-textarea", style: { minHeight: 60 }, value: envText, onChange: (e) => setEnvText(e.target.value) }) }),
						react_jsx_runtime.jsx(Field, { label: t("cwd"), children: react_jsx_runtime.jsx("input", { className: "dsh-hub-input", value: cwd, onChange: (e) => setCwd(e.target.value) }) })
					] }),
				transport === "streamable-http" && react_jsx_runtime.jsx(Field, { label: t("headers"), children: react_jsx_runtime.jsx("textarea", { className: "dsh-hub-textarea", style: { minHeight: 60 }, value: headersText, onChange: (e) => setHeadersText(e.target.value) }) }),
				react_jsx_runtime.jsxs("div", { className: "dsh-hub-rowline", children: [
					react_jsx_runtime.jsx("span", { className: "dsh-hub-label", children: t("enabled") }),
					react_jsx_runtime.jsx(Toggle, { checked: enabled, onChange: setEnabled })
				] }),
				err && react_jsx_runtime.jsx("div", { className: "dsh-hub-err", children: err }),
				react_jsx_runtime.jsxs("div", { className: "dsh-hub-actions", children: [
					react_jsx_runtime.jsx(Btn, { onClick: onClose, children: t("cancel") }),
					react_jsx_runtime.jsx(Btn, { kind: "primary", onClick: save, children: t("save") })
				] })
			] });
		}
		//#endregion

		//#region 技能 Tab
		const SOURCE_ORDER = { user: 0, project: 1, custom: 2, bundled: 3, runtime: 4 };
		function SkillsTab({ state, t, actions }) {
			const [editing, setEditing] = react.useState(null); // {mode:'create'|'edit', skill?}
			const [confirmPath, setConfirmPath] = react.useState(null);
			const skills = state.skills || [];
			const groups = [];
			for (const s of skills) {
				let g = groups.find((x) => x.source === s.source);
				if (!g) { g = { source: s.source, items: [] }; groups.push(g); }
				g.items.push(s);
			}
			groups.sort((a, b) => (SOURCE_ORDER[a.source] ?? 9) - (SOURCE_ORDER[b.source] ?? 9));
			return react_jsx_runtime.jsxs("div", { className: "dsh-hub-list", children: [
				react_jsx_runtime.jsxs("div", { className: "dsh-hub-toolbar", children: [
					react_jsx_runtime.jsx(Btn, { onClick: () => setEditing({ mode: "create" }), children: t("newSkill") }),
					react_jsx_runtime.jsx(Btn, { onClick: actions.reload, disabled: state.busy, children: t("refresh") })
				] }),
				!state.registryOk && react_jsx_runtime.jsx("div", { className: "dsh-hub-banner warn", children: t("apiFail") + " skills registry" }),
				skills.length === 0 && react_jsx_runtime.jsx("div", { className: "dsh-hub-empty", children: t("noSkills") }),
				groups.map((g) => react_jsx_runtime.jsxs(react.Fragment, { children: [
					react_jsx_runtime.jsx("div", { className: "dsh-hub-group-title", children: g.source + " (" + g.items.length + ")" }),
					g.items.map((s) => react_jsx_runtime.jsxs("div", { className: "dsh-hub-row", children: [
						react_jsx_runtime.jsx("span", { className: "dsh-hub-name", children: s.name }),
						react_jsx_runtime.jsx("span", { className: "dsh-hub-desc", title: s.path || "", children: s.description || (s.path || "") }),
						s.whenToUse ? react_jsx_runtime.jsx("span", { className: "dsh-hub-when", title: s.whenToUse, children: s.whenToUse }) : null,
						react_jsx_runtime.jsx("span", { className: "dsh-hub-label", style: { whiteSpace: "nowrap" }, children: t("modelInvocable") }),
						react_jsx_runtime.jsx(Toggle, {
							checked: s.modelInvocable, disabled: !s.editable || state.busy,
							title: s.editable ? "" : t("readOnlySource"),
							onChange: () => actions.toggleSkill(s)
						}),
						s.editable && react_jsx_runtime.jsx(Btn, { onClick: () => setEditing({ mode: "edit", skill: s }), children: t("edit") }),
						s.editable && (confirmPath === s.path
							? react_jsx_runtime.jsxs(react.Fragment, { children: [
								react_jsx_runtime.jsx(Btn, { kind: "danger", onClick: () => { actions.deleteSkill(s); setConfirmPath(null); }, children: t("confirmDelete") }),
								react_jsx_runtime.jsx(Btn, { onClick: () => setConfirmPath(null), children: t("cancel") })
							] })
							: react_jsx_runtime.jsx(Btn, { kind: "danger", onClick: () => setConfirmPath(s.path), children: t("del") }))
					] }, s.name + ":" + (s.path || "")))
				] }, g.source)),
				editing && react_jsx_runtime.jsx(SkillEditor, {
					t, state, editing, onClose: () => setEditing(null),
					onSaved: () => setEditing(null)
				})
			] });
		}
		function SkillEditor({ t, state, editing, onClose, onSaved }) {
			const isEdit = editing.mode === "edit";
			const s = editing.skill || {};
			const [name, setName] = react.useState(isEdit ? s.name : "");
			const [scope, setScope] = react.useState("user");
			const [description, setDescription] = react.useState(isEdit ? s.description : "");
			const [whenToUse, setWhenToUse] = react.useState(isEdit ? s.whenToUse : "");
			const [content, setContent] = react.useState("");
			const [loading, setLoading] = react.useState(isEdit);
			const [err, setErr] = react.useState("");
			react.useEffect(() => {
				if (!isEdit) return;
				let alive = true;
				api("GET", "/skills/read?path=" + encodeURIComponent(s.path))
					.then((r) => { if (!alive) return; setDescription(r.description || ""); setWhenToUse(r.whenToUse || ""); setContent(r.content || ""); })
					.catch((e) => setErr(String((e && e.message) || e)))
					.finally(() => { if (alive) setLoading(false); });
				return () => { alive = false; };
			}, []);
			const save = async () => {
				setErr("");
				try {
					if (isEdit) {
						await api("POST", "/skills/update", { path: s.path, name: s.name, description, whenToUse, content });
					} else {
						if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name.trim()) || name.trim().length > 64) { setErr("技能名需为 kebab-case(小写字母/数字/单个连字符,如 my-skill)"); return; }
						await api("POST", "/skills/create", { name: name.trim(), scope, description, whenToUse, content });
					}
					await window.__dshHubReload?.();
					onSaved();
				} catch (e) { setErr(String((e && e.message) || e)); }
			};
			return react_jsx_runtime.jsxs(Modal, { title: isEdit ? t("editSkill") : t("newSkill"), onClose, children: [
				loading && react_jsx_runtime.jsx("div", { className: "dsh-hub-empty", children: "…" }),
				react_jsx_runtime.jsxs("div", { className: "dsh-hub-grid2", children: [
					react_jsx_runtime.jsx(Field, { label: t("skillName") + (isEdit ? "(" + t("nameLocked") + ")" : ""), children: react_jsx_runtime.jsx("input", { className: "dsh-hub-input", value: name, disabled: isEdit, onChange: (e) => setName(e.target.value), placeholder: "my-skill" }) }),
					!isEdit && react_jsx_runtime.jsx(Field, { label: t("scope"), children: react_jsx_runtime.jsxs("select", { className: "dsh-hub-select", value: scope, onChange: (e) => setScope(e.target.value), children: [
						react_jsx_runtime.jsx("option", { value: "user", children: t("scopeUser") }),
						react_jsx_runtime.jsx("option", { value: "project", children: t("scopeProject") + ((state.projectRoots && state.projectRoots[0]) ? " " + state.projectRoots[0] : "") })
					] }) })
				] }),
				react_jsx_runtime.jsx(Field, { label: t("description"), children: react_jsx_runtime.jsx("input", { className: "dsh-hub-input", value: description, onChange: (e) => setDescription(e.target.value) }) }),
				react_jsx_runtime.jsx(Field, { label: t("whenToUse"), children: react_jsx_runtime.jsx("input", { className: "dsh-hub-input", value: whenToUse, onChange: (e) => setWhenToUse(e.target.value) }) }),
				react_jsx_runtime.jsx(Field, { label: t("content"), children: react_jsx_runtime.jsx("textarea", { className: "dsh-hub-textarea", style: { minHeight: 200 }, value: content, onChange: (e) => setContent(e.target.value) }) }),
				err && react_jsx_runtime.jsx("div", { className: "dsh-hub-err", children: err }),
				react_jsx_runtime.jsxs("div", { className: "dsh-hub-actions", children: [
					react_jsx_runtime.jsx(Btn, { onClick: onClose, children: t("cancel") }),
					react_jsx_runtime.jsx(Btn, { kind: "primary", onClick: save, disabled: loading, children: t("save") })
				] })
			] });
		}
		//#endregion

		//#region 设置分区
		let controller = null;
		function McpSkillHubSection(props) {
			const state = props.useHub((s) => s);
			const t = props.t || tFallback;
			react.useEffect(() => { controller.load(); }, []);
			window.__dshHubReload = () => controller.load();
			const actions = {
				reload: () => controller.load(),
				setTab: (tab) => controller.set({ tab }),
				toggleMcp: (row) => controller.post("/mcp/toggle", { id: row.id, enabled: !row.enabled, expectedMtimeMs: controller.getSnapshot().patchMtimeMs }),
				deleteMcp: (row) => controller.post("/mcp/delete", { id: row.id, expectedMtimeMs: controller.getSnapshot().patchMtimeMs }),
				saveMcp: (server, id, enabled) => controller.post("/mcp/upsert", { id: id || null, server, enabled, expectedMtimeMs: controller.getSnapshot().patchMtimeMs }),
				toggleSkill: (s) => controller.post("/skills/toggle", { path: s.path, modelInvocable: !s.modelInvocable })
					.catch((e) => controller.say(String((e && e.message) || e))),
				deleteSkill: (s) => controller.post("/skills/delete", { path: s.path })
					.then((r) => controller.say(t("trashNote") + " " + (r.trash || "")))
					.catch((e) => controller.say(String((e && e.message) || e)))
			};
			if (!state.ready) return react_jsx_runtime.jsx("div", { className: "dsh-hub-wrap", children: "…" });
			if (state.error) return react_jsx_runtime.jsxs("div", { className: "dsh-hub-wrap", children: [
				react_jsx_runtime.jsx("div", { className: "dsh-hub-banner warn", children: t("apiFail") + " " + state.error }),
				react_jsx_runtime.jsx("div", { children: react_jsx_runtime.jsx(Btn, { onClick: actions.reload, children: t("refresh") }) })
			] });
			return react_jsx_runtime.jsxs("div", { className: "dsh-hub-wrap", children: [
				react_jsx_runtime.jsxs("div", { className: "dsh-hub-tabs", role: "tablist", children: [
					react_jsx_runtime.jsx("button", { type: "button", role: "tab", "aria-selected": state.tab === "mcp", className: "dsh-hub-tab" + (state.tab === "mcp" ? " active" : ""), onClick: () => actions.setTab("mcp"), children: t("tabMcp") + " (" + state.mcp.length + ")" }),
					react_jsx_runtime.jsx("button", { type: "button", role: "tab", "aria-selected": state.tab === "skills", className: "dsh-hub-tab" + (state.tab === "skills" ? " active" : ""), onClick: () => actions.setTab("skills"), children: t("tabSkills") + " (" + state.skills.length + ")" })
				] }),
				!state.hmr
					? react_jsx_runtime.jsxs("div", { className: "dsh-hub-banner warn", children: [
						react_jsx_runtime.jsx(Icon, { name: "warn", size: 14 }),
						react_jsx_runtime.jsx("span", { children: t("restartBanner") })
					] })
					: null,
				state.toast && react_jsx_runtime.jsx("div", { className: "dsh-hub-banner ok", children: state.toast }),
				state.tab === "mcp"
					? react_jsx_runtime.jsx(McpTab, { state, t, actions })
					: react_jsx_runtime.jsx(SkillsTab, { state, t, actions })
			] });
		}
		//#endregion

		//#region 样式
		const CSS = `
/* ── 视觉基线 ─────────────────────────────────────────────
   全部走 dsh 的 --dsw-alias-* 设计变量(浅/深色由宿主切换, 我们不感知)。
   token 分工沿用 dsh 自己的 alert 惯例:
     文字 = state-warn-label / label-error / state-error-primary
     背景 = state-*-tertiary(浅色为 100 级, 深色为 900 级)
     边框 = state-*-secondary
   兜底值只在 token 缺失时生效(例如脱离 dsh 单独渲染), 必须与 var() 成对出现。
   ───────────────────────────────────────────────────── */

.dsh-hub-wrap{display:flex;flex-direction:column;gap:10px;font-size:13px;color:var(--dsw-alias-label-primary,inherit)}
/* 键盘焦点可见(可访问性): 不用 outline:none, 保留高对比焦点环。焦点色跟随宿主品牌色。 */
.dsh-hub-wrap button:focus-visible,.dsh-hub-wrap input:focus-visible,.dsh-hub-wrap textarea:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#6366f1);outline-offset:1px}

/* tab: 分段控件, 选中态用交互底色而非实心块(设置面板不宜过重) */
.dsh-hub-tabs{display:flex;gap:8px;align-items:center}
.dsh-hub-tab{padding:4px 12px;border-radius:var(--dsw-radius-sm,8px);border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));background:transparent;color:var(--dsw-alias-label-secondary,inherit);cursor:pointer;font:inherit;transition:background .12s,border-color .12s,color .12s}
.dsh-hub-tab:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12));color:var(--dsw-alias-label-primary,inherit)}
.dsh-hub-tab.active{background:var(--dsw-alias-interactive-bg-active,rgba(128,128,128,.2));border-color:var(--dsw-alias-border-l3,rgba(128,128,128,.45));color:var(--dsw-alias-label-primary,inherit)}
.dsh-hub-toolbar{display:flex;gap:8px;align-items:center}
.dsh-hub-list{display:flex;flex-direction:column;gap:6px}

/* 行 = 设置卡片(与宿主 settings card 同源: fill + stroke) */
.dsh-hub-row{display:flex;align-items:center;gap:8px;padding:7px 10px;border:1px solid var(--dsw-alias-settings-card-stroke,var(--dsw-alias-border-l1,rgba(128,128,128,.25)));border-radius:var(--dsw-radius-sm,8px);background:var(--dsw-alias-settings-card-fill,transparent);flex-wrap:wrap}
.dsh-hub-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-dimmed,rgba(128,128,128,.5));flex:none}
.dsh-hub-dot.on{background:var(--dsw-alias-state-success-primary,#22c55e)}
.dsh-hub-name{font-weight:600;white-space:nowrap;color:var(--dsw-alias-label-primary,inherit)}
.dsh-hub-desc{color:var(--dsw-alias-label-secondary,inherit);font-size:13px;flex:1;min-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-hub-when{color:var(--dsw-alias-label-tertiary,inherit);font-size:12px;font-style:italic;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* 徽章: 状态色走 token, 文字色与边框同源 */
.dsh-hub-badge{font-size:12px;padding:1px 6px;border-radius:var(--dsw-radius-xs,4px);border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));color:var(--dsw-alias-label-secondary,inherit);white-space:nowrap}
.dsh-hub-badge.ok{border-color:var(--dsw-alias-state-success-secondary,#22c55e);color:var(--dsw-alias-state-success-primary,#22c55e)}
.dsh-hub-badge.warn{border-color:var(--dsw-alias-state-warn-secondary,#eab308);color:var(--dsw-alias-state-warn-label,#eab308)}
.dsh-hub-badge.danger{border-color:var(--dsw-alias-state-error-secondary,#ef4444);color:var(--dsw-alias-label-error,var(--dsw-alias-state-error-primary,#ef4444))}
.dsh-hub-badge.dim{color:var(--dsw-alias-label-dimmed,inherit)}}

/* 未授权提示行: 缩进对齐主行, 虚线边框 + warn tertiary 底 + warn label 文字 */
.dsh-hub-auth-row{margin-left:16px;border-style:dashed;border-color:var(--dsw-alias-state-warn-secondary,rgba(234,179,8,.4));background:var(--dsw-alias-state-warn-tertiary,rgba(234,179,8,.06))}
.dsh-hub-auth-warn{color:var(--dsw-alias-state-warn-label,#eab308);font-size:13px;flex:1;min-width:160px;display:flex;align-items:center;gap:6px}

/* 横幅: 图标 + 文字横排(教义: 状态靠图标加文字, 不靠单色) */
.dsh-hub-banner{padding:6px 10px;border-radius:var(--dsw-radius-sm,8px);font-size:12px;display:flex;align-items:center;gap:6px;line-height:1.5}
.dsh-hub-banner.warn{background:var(--dsw-alias-state-warn-tertiary,rgba(234,179,8,.12));border:1px solid var(--dsw-alias-state-warn-secondary,rgba(234,179,8,.4));color:var(--dsw-alias-state-warn-label,#eab308)}
.dsh-hub-banner.ok{background:var(--dsw-alias-state-success-tertiary,rgba(34,197,94,.1));border:1px solid var(--dsw-alias-state-success-secondary,rgba(34,197,94,.35));color:var(--dsw-alias-state-success-primary,#22c55e)}
.dsh-hub-banner.danger{background:var(--dsw-alias-state-error-secondary,rgba(239,68,68,.12));border:1px solid var(--dsw-alias-state-error-secondary,rgba(239,68,68,.45));color:var(--dsw-alias-label-error,var(--dsw-alias-state-error-primary,#ef4444))}
.dsh-hub-empty{color:var(--dsw-alias-label-dimmed,inherit);padding:14px 4px;font-size:12px}
.dsh-hub-group-title{font-size:12px;font-weight:700;color:var(--dsw-alias-label-tertiary,inherit);margin-top:8px;text-transform:uppercase;letter-spacing:.06em}

/* 开关: 跟随 dsh 的 switch 尺寸与 thumb token */
.dsh-hub-switch{width:40px;height:24px;border-radius:var(--dsw-radius-md,12px);border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));background:var(--dsw-alias-fill-l2,rgba(128,128,128,.25));position:relative;cursor:pointer;padding:0;flex:none}
.dsh-hub-switch.on{background:var(--dsw-alias-state-success-primary,#22c55e);border-color:var(--dsw-alias-state-success-primary,#22c55e)}
.dsh-hub-switch:disabled{opacity:.4;cursor:not-allowed}
.dsh-hub-knob{position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:var(--dsw-alias-switch-thumb,#fff);transition:left .15s}
.dsh-hub-switch.on .dsh-hub-knob{left:18px}

/* 按钮: 默认 ghost, 主动作 primary, 破坏性动作 error 色(教义: token by intent) */
.dsh-hub-btn{padding:4px 12px;border-radius:var(--dsw-radius-sm,8px);border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));background:transparent;color:var(--dsw-alias-label-secondary,inherit);cursor:pointer;font:inherit;font-size:12px;transition:background .12s,border-color .12s,color .12s}
.dsh-hub-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12));color:var(--dsw-alias-label-primary,inherit)}
.dsh-hub-btn.danger{color:var(--dsw-alias-label-error,var(--dsw-alias-state-error-primary,#ef4444));border-color:var(--dsw-alias-state-error-secondary,rgba(239,68,68,.4))}
.dsh-hub-btn.danger:hover{background:var(--dsw-alias-interactive-bg-hover-danger,rgba(239,68,68,.1))}
.dsh-hub-btn.primary{background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary,#6366f1));border-color:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary,#6366f1));color:var(--dsw-alias-label-primary-foreground,#fff)}
.dsh-hub-btn.primary:hover{background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-brand-primary,#6366f1));border-color:var(--dsw-alias-button-primary-hover,var(--dsw-alias-brand-primary,#6366f1))}
.dsh-hub-btn:disabled{opacity:.45;cursor:not-allowed}

/* 模态: 用宿主层级底色, 不用自造深色 */
.dsh-hub-modal-overlay{position:fixed;inset:0;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.45));backdrop-filter:var(--dsw-mask-blur,blur(2px));display:flex;align-items:center;justify-content:center;z-index:1000}
.dsh-hub-modal{background:var(--dsw-alias-bg-layer-2,#1b1b1f);color:var(--dsw-alias-label-primary,inherit);border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));border-radius:var(--dsw-radius-md,12px);padding:16px;width:min(580px,92vw);max-height:85vh;overflow:auto;display:flex;flex-direction:column;gap:10px}
.dsh-hub-modal-head{display:flex;justify-content:space-between;align-items:center;gap:8px}
.dsh-hub-field{display:block}
.dsh-hub-label{font-size:12px;color:var(--dsw-alias-label-tertiary,inherit);display:block;margin-bottom:3px}
.dsh-hub-input,.dsh-hub-textarea{width:100%;box-sizing:border-box;padding:6px 8px;border-radius:var(--dsw-radius-sm,8px);border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));background:var(--dsw-alias-bg-layer-1,transparent);color:var(--dsw-alias-label-primary,inherit);font:inherit}
.dsh-hub-textarea{font-family:ui-monospace,SFMono-Regular,monospace;font-size:12px;min-height:80px;resize:vertical}
.dsh-hub-grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.dsh-hub-actions{display:flex;justify-content:flex-end;gap:8px}
.dsh-hub-rowline{display:flex;align-items:center;gap:8px}
.dsh-hub-err{color:var(--dsw-alias-label-error,var(--dsw-alias-state-error-primary,#ef4444));font-size:12px}
`;
		function injectStyle() {
			if (document.querySelector("style[data-plugin='dsh-mcp-skill-hub']")) return;
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-mcp-skill-hub";
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}
		//#endregion

		const clientInject = ["slots", "locale"];
		function apply(ctx) {
			injectStyle();
			// 词典只在 effect 内注册一次:locale.register 对同一 ns+locale 重复注册会抛
			// ("already has locale"),裸调用会让 effect 内的注册必然失败。
			controller = new HubController();
			// 把 locale 感知的 t 注入 controller: 否则 controller 内的 toast 提示
			// 只能用 tFallback(恒 zh), 英文用户会看到英文 UI + 中文 toast。
			// bind 返回的 t 已按当前 locale 选词典, 与 React 组件的 props.t 同源。
			try { controller.setT(ctx.locale.bind(NS)); } catch { /* locale 不可用时退回 tFallback */ }
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), NS + ": dictionaries");
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "mcp-skill-hub",
				order: 17,
				label: () => { try { const v = ctx.locale.bind(NS)("nav"); return v || "MCP & Skills"; } catch { return "MCP & Skills"; } },
				locale: NS,
				// children 不可省: settings shell 只渲染声明了子 slot 的 section。
				// 无 children 的 section 会被当作空壳跳过(实测: label 被调用说明
				// 导航枚举到了, 但组件从未被渲染)。
				// Hub 只有一个 tab 组, 故声明单个 single 子 slot。
				children: { "settings.mcp-skill-hub.body": {
					kind: "single",
					scope: "root"
				} },
				inject: () => ({
					hooks: { hub: controller },
					reload: () => controller.load(),
					setTab: (tab) => controller.set({ tab }),
					toggleMcp: (row) => controller.post("/mcp/toggle", { id: row.id, enabled: !row.enabled, expectedMtimeMs: controller.getSnapshot().patchMtimeMs }),
					deleteMcp: (row) => controller.post("/mcp/delete", { id: row.id, expectedMtimeMs: controller.getSnapshot().patchMtimeMs }),
					saveMcp: (server, id, enabled) => controller.post("/mcp/upsert", { id: id || null, server, enabled, expectedMtimeMs: controller.getSnapshot().patchMtimeMs }),
					toggleSkill: (s) => controller.post("/skills/toggle", { path: s.path, modelInvocable: !s.modelInvocable }),
					deleteSkill: (s) => controller.post("/skills/delete", { path: s.path })
				})
			}, McpSkillHubSection));
		}

		exports.apply = apply;
		exports.inject = clientInject;
		// 注意: 缺这行 = factory 返回 undefined = 启动报
		//    "invalid plugin, expect function or object with an apply method, received undefined"
		//    对照 @240xu/dsh-websearch/lib/client.js：exports 写完必须把 module.exports 返回。
		return module.exports;
	}
});
