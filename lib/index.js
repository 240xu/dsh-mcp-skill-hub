/**
 * dsh-mcp-skill-hub — host half (node).
 *
 * Loopback API for the settings section "MCP 与技能":
 *   - MCP servers: read / create / update / toggle / delete the
 *     `@deepseek-ai/dsh-mcp-client` composition rows in the active profile's
 *     cordis.patch.yml, via a targeted line-block editor that preserves the
 *     rest of the file byte-for-byte (comments included).
 *   - Skills: list through ctx.skills, create / read / update / toggle /
 *     delete skill files under writable roots (user / project / custom).
 *
 * Zero npm dependencies. Every write is atomic (tmp + rename).
 */
import { join, dirname, basename, sep } from "node:path";
import { homedir } from "node:os";
import {
	readFileSync, writeFileSync, renameSync, existsSync, mkdirSync,
	readdirSync, statSync, realpathSync
} from "node:fs";
import { registerOAuthRoutes } from "./oauth-server.js";
import { createAuthProvider, CALLBACK_PATH } from "./oauth-provider.js";
import { authStorePath, loadAuthStore } from "./auth-store.js";
import { selfHealOauthSeam, findBundle } from "./self-heal.mjs";
import { registerUninstallRoutes, planUninstall } from "./uninstall.js";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/** 本插件版本(写进 patch sidecar, 便于回溯「哪一版打的补丁」)。读失败不致命。 */
let PLUGIN_VERSION = "unknown";
try {
	const __req = createRequire(fileURLToPath(import.meta.url));
	PLUGIN_VERSION = __req("../package.json").version || "unknown";
} catch { /* 打包/测试环境下取不到, 保持 unknown */ }

const name = "dsh-mcp-skill-hub";
const MCP_PKG = "@deepseek-ai/dsh-mcp-client";
const API = "/api/dsh-mcp-skill-hub";

/**
 * OAuth seam 补丁的运行时可观测状态(P1-8)。
 * 由 scheduleOauthSeamSelfHeal() 填充, 经 /oauth/status 暴露给 UI(红色横幅),
 * 使「dsh 升级后补丁失效」不再是静默故障。
 *
 * 注意: 这里只经 /oauth/status 暴露, **不经 /state**。0.3.4 逐字审核发现
 * 原注释声称「经 /oauth/status 与 /state 暴露」, 但 stateHandler 从未带 seam
 * 字段 —— 属于注释与代码不符, 已按实际行为改正注释。
 *
 * status ∈ not-checked | already | patched | needs-patch | anchor-missing
 *          | not-applicable | corrupt | verify-failed | disabled
 *          | bundle-not-found | read-failed | error
 * (不含 locked: self-heal 把「另一进程正在 patch」映射为 already 后上报,
 *  故 locked 永远不会出现在这里。)
 *
 * checkedAt: 上次自愈检查的 Unix ms。随 /oauth/status 的 seam 字段下发,
 * 便于 UI 显示「上次检查时间」、以及排查「状态是不是根本没更新过」。
 */
const SEAM_STATE = { status: "not-checked", detail: {}, checkedAt: 0 };
/** Host services this plugin requires. */
const inject = ["webServer", "skills"];

//#region 小工具
class HttpError extends Error {
	constructor(status, message) { super(message); this.status = status; }
}
function writeJson(res, status, body) {
	const data = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	res.end(data);
}
function readJson(req, limit = 1 << 20) {
	return new Promise((resolve, reject) => {
		let size = 0;
		const chunks = [];
		req.on("data", (c) => {
			size += c.length;
			if (size > limit) { reject(new HttpError(413, "payload too large")); req.destroy(); return; }
			chunks.push(c);
		});
		req.on("end", () => {
			if (!chunks.length) return resolve({});
			try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
			catch { reject(new HttpError(400, "invalid json body")); }
		});
		req.on("error", reject);
	});
}
function queryParam(req, key) {
	try { return new URL(req.url, "http://localhost").searchParams.get(key); }
	catch { return null; }
}
//#endregion

//#region 安全围栏:loopback 或已配对设备
function isLoopbackRequest(req) {
	const a = req?.socket?.remoteAddress || "";
	return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
}
function isAllowed(ctx, req) {
	if (isLoopbackRequest(req)) return true;
	let pairing;
	try { pairing = ctx.get("remoteWebUiPairing", false); } catch { pairing = undefined; }
	try {
		if (pairing && typeof pairing.isPairedDevice === "function") return pairing.isPairedDevice(req) === true;
	} catch {}
	return false;
}
//#endregion

//#region YAML 标量(零依赖,覆盖本插件需要的子集)
function yamlScalar(v) {
	const s = String(v ?? "");
	if (s === "") return "''";
	if (s.includes("\n") || s.includes("\r")) {
		// 单引号跨行会被 YAML 折叠且可致解析失败;双引号 + 转义是唯一安全形态。
		return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t") + '"';
	}
	// 裸标量必须排除 ": "(冒号+空格,映射指示符)、行尾冒号与 YAML 指示符首字符;
	// 字符类本身不含 # ? ! & * | > % @ ` { } [ ] , ' " 等危险符号。
	if (/^[A-Za-z0-9_][A-Za-z0-9_./:@+ -]*$/.test(s) && !/^(true|false|null|yes|no|on|off)$/i.test(s)
		&& !/:\s/.test(s) && !s.endsWith(":")) return s;
	return "'" + s.replace(/'/g, "''") + "'";
}
function unquote(s) {
	const t = String(s ?? "").trim();
	if (t.length >= 2 && ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"')))) {
		if (t.startsWith('"')) {
			return t.slice(1, -1).replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
		}
		return t.slice(1, -1).replace(/''/g, "'");
	}
	return t;
}
/** Strip a trailing ` #comment` that sits outside quotes. */
function stripComment(s) {
	let inS = false, inD = false;
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (c === "'" && !inD) inS = !inS;
		else if (c === '"' && !inS) inD = !inD;
		else if (c === "#" && !inS && !inD && i > 0 && /\s/.test(s[i - 1])) return s.slice(0, i).trim();
	}
	return s.trim();
}
function parseBool(s) { return /^(true|yes|on|1)$/i.test(String(s ?? "").trim()); }
function splitFlowItems(s) {
	const parts = [];
	let buf = "", inS = false, inD = false;
	for (const ch of s) {
		if (ch === "'" && !inD) inS = !inS;
		else if (ch === '"' && !inS) inD = !inD;
		if (ch === "," && !inS && !inD) { parts.push(buf); buf = ""; }
		else buf += ch;
	}
	if (buf.trim() !== "") parts.push(buf);
	return parts.map((p) => p.trim()).filter((p) => p !== "");
}
//#endregion

//#region profile 定位
function resolveProfileDir(self) {
	const dshHome = process.env.DSH_HOME || join(homedir(), ".dsh");
	const root = join(dshHome, "profiles");
	const candidates = [];
	if (process.env.DSH_PROFILE) candidates.push(process.env.DSH_PROFILE);
	const argv = process.argv || [];
	const flagIdx = argv.indexOf("--profile");
	if (flagIdx >= 0 && argv[flagIdx + 1]) candidates.push(argv[flagIdx + 1]);
	const eq = argv.find((a) => typeof a === "string" && a.startsWith("--profile="));
	if (eq) candidates.push(eq.slice("--profile=".length));
	const bare = argv.slice(2).find((a) => typeof a === "string" && a !== "" && !a.startsWith("-"));
	if (bare) candidates.push(bare);
	try {
		for (const d of readdirSync(root)) {
			if (existsSync(join(root, d, "node_modules", self))) candidates.push(d);
		}
	} catch {}
	candidates.push("web");
	const seen = new Set();
	for (const c of candidates) {
		if (!c || seen.has(c)) continue;
		seen.add(c);
		const dir = join(root, c);
		if (existsSync(join(dir, "cordis.patch.yml")) && existsSync(join(dir, "package.json"))) return dir;
	}
	return null;
}
//#endregion

//#region MCP 组合行:块扫描 / 字段解析
/**
 * Scan the patch file lines for mcp-client rows.
 * A row starts at a line `- id: …` (indent ≥ 0: both the top-level list form
 * and nested `insert` list forms are valid patch shapes) whose next ≤4
 * non-empty lines contain `name: '@deepseek-ai/dsh-mcp-client'`. The block
 * ends before the next line at the same-or-shallower indent (flow collections
 * `[...]` tracked so multi-line args/env never break the scan).
 */
function scanMcpBlocks(lines) {
	const nameRe = new RegExp("name:\\s*['\\\"]" + MCP_PKG.replace(/[/@]/g, (c) => "\\" + c) + "['\\\"]");
	const blocks = [];
	let depth = 0;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		// P0-A(0.3.4): 括号计数必须基于「剥掉注释后」的文本。
		// 原实现用原文计数, 于是 `# TODO[ revisit` 这类**注释里未闭合的括号**
		// 会把 depth 永久抬高 → before > 0 → 后续所有 `- id:` 行被 continue
		// 跳过 → 所有 MCP 行从 UI 消失且无法增删改。
		// 注意 stripComment 要求 # 前面有空白才算注释起点(避免误伤 token 里的 #),
		// 所以整行都是注释(# 在列 0)时要单独判空。
		const scan = /^\s*#/.test(line) ? "" : stripComment(line);
		const opens = (scan.match(/[[{]/g) || []).length - (scan.match(/[\]}]/g) || []).length;
		const before = depth;
		depth += opens;
		if (before > 0) continue;
		const m = line.match(/^(\s*)- id:\s*(.+?)\s*$/);
		if (!m) continue;
		let ok = false;
		for (let j = i + 1, seen = 0; j < lines.length && seen < 4; j++, seen++) {
			const l = lines[j];
			if (l.trim() === "") continue;
			if (nameRe.test(l)) { ok = true; break; }
			if (/^\s*- id:/.test(l)) break;
		}
		if (!ok) continue;
		const indent = m[1].length;
		let end = lines.length;
		let d2 = depth;
		for (let j = i + 1; j < lines.length; j++) {
			const l = lines[j];
			if (d2 === 0 && l.trim() !== "" && l.match(/^\s*/)[0].length <= indent) { end = j; break; }
			// 同 P0-A: 结束判定也基于剥注释后的文本, 注释里的括号不得参与计数。
			const sc = /^\s*#/.test(l) ? "" : stripComment(l);
			d2 += (sc.match(/[[{]/g) || []).length - (sc.match(/[\]}]/g) || []).length;
		}
		blocks.push({ start: i, end, indent, id: unquote(m[2]) });
	}
	return blocks;
}
function assignFlow(out, key, text) {
	const t = text.trim();
	if (key === "args") {
		out.args = splitFlowItems(t.replace(/^\[/, "").replace(/\]\s*$/, "")).map(unquote);
	} else {
		const inner = t.replace(/^[{]/, "").replace(/[}]\s*$/, "");
		for (const item of splitFlowItems(inner)) {
			const m = item.match(/^([^:]+):\s*(.*)$/);
			if (m) out[key][unquote(m[1])] = unquote(m[2]);
		}
	}
}
/** Extract config fields from one block's lines (best effort; unknown shapes → strict=false). */
function parseBlockFields(blockLines) {
	const out = {
		serverName: undefined, transport: undefined, url: undefined,
		command: undefined, cwd: undefined, args: [], env: {}, headers: {},
		disabled: false,
		// config 块内 Hub 不认识的原始行(如 toolCallTimeoutMs / reconnect / 注释),
		// 按原缩进原样带回写,避免整块重建时丢失用户配置。
		extraLines: []
	};
	let inConfig = false, configIndent = -1;
	let currentList = null, currentMap = null;
	let flow = null;
	for (let i = 1; i < blockLines.length; i++) {
		const raw = blockLines[i];
		if (raw.trim() === "") continue;
		if (/^(\s*)disabled:\s*/.test(raw)) {
			out.disabled = parseBool(raw.replace(/^(\s*)disabled:\s*/, ""));
			continue;
		}
		const ind = raw.match(/^\s*/)[0].length;
		if (!inConfig) {
			if (/^(\s*)config:\s*(#.*)?$/.test(raw)) { inConfig = true; configIndent = ind; }
			continue;
		}
		if (ind <= configIndent) { inConfig = false; currentList = currentMap = null; continue; }
		// 注释行(无论是否处于已知列表内)原样保留。
		if (/^\s*#/.test(raw)) { out.extraLines.push(raw); continue; }
		if (!flow && (currentList || currentMap)) {
			const t0 = raw.trim();
			if (t0.startsWith("[") || t0.startsWith("{")) {
				const d0 = (raw.match(/[[{]/g) || []).length - (raw.match(/[\]}]/g) || []).length;
				if (d0 > 0) { flow = { key: currentList || currentMap, depth: d0, buf: t0 }; continue; }
				assignFlow(out, currentList || currentMap, t0); continue;
			}
		}
		if (flow) {
			flow.buf += " " + raw.trim();
			flow.depth += (raw.match(/[[{]/g) || []).length - (raw.match(/[\]}]/g) || []).length;
			if (flow.depth <= 0) { assignFlow(out, flow.key, flow.buf); flow = null; }
			continue;
		}
		const km = raw.match(/^(\s*)([A-Za-z0-9_-]+):\s*(.*)$/);
		if (!km) {
			const li = raw.match(/^(\s*)-\s*(.+)$/);
			if (currentList && li) out[currentList].push(unquote(stripComment(li[2])));
			else if (!currentList && !currentMap) out.extraLines.push(raw);
			continue;
		}
		const key = km[2];
		const val = stripComment(km[3]);
		if (key === "args" || key === "env" || key === "headers") {
			if (val === "") {
				if (key === "args") { currentList = "args"; currentMap = null; }
				else { currentMap = key; currentList = null; }
				continue;
			}
			if (val.startsWith("[") || val.startsWith("{")) {
				const d0 = (val.match(/[[{]/g) || []).length - (val.match(/[\]}]/g) || []).length;
				if (d0 > 0) flow = { key, depth: d0, buf: val };
				else assignFlow(out, key, val);
				continue;
			}
		}
		// P0-B(0.3.4): map 子键的判据必须同时看**缩进**, 不能只看 currentMap 是否置位。
		// 原实现只要 currentMap 非空就把任何 `k: v` 收进 env/headers, 于是 config 内的
		// 下一个顶层标量键(reconnect: / enabled: / url:)会被吞进 map:
		//   - out.url / out.enabled 丢失 → 保存时改写 MCP 连接目标、启停状态错乱
		//   - reconnect 等未知块的子键错位成 headers 的子键
		// map 子键的缩进必然 > configIndent + 2(map 自己占一格, 子键再进一格);
		// 回到 config 直接子级(ind <= configIndent + 2)就说明 map 已结束。
		const mapChildIndent = configIndent + 2;
		if ((currentMap === "env" || currentMap === "headers") && ind > mapChildIndent) {
			out[currentMap][key] = unquote(val);
			continue;
		}
		// 到这里说明当前键是 config 的直接子级: map/list 态已结束, 必须清零,
		// 否则后续未知键会继续漏进上一个 map(这正是 P0-B 的传播路径)。
		if (currentMap || currentList) { currentMap = currentList = null; }
		switch (key) {
			case "serverName": out.serverName = unquote(val); break;
			case "transport": out.transport = unquote(val); break; // eslint-disable-line
			case "url": out.url = unquote(val); break;
			case "command": out.command = unquote(val); break;
			case "cwd": out.cwd = unquote(val); break;
			default:
				// 未知 config 字段(toolCallTimeoutMs / reconnect / …)原样带回写。
				// 仅收集标量形态;嵌套结构由其后继行通过上面的非列表分支进入。
				out.extraLines.push(raw);
				break;
		}
	}
	return out;
}
//#endregion

//#region MCP 组合行:写操作
function buildRowLines(id, server, enabled, indent) {
	const I = " ".repeat(indent);
	const F = " ".repeat(indent + 2);
	const C = " ".repeat(indent + 4);
	const L = [];
	L.push(`${I}- id: ${id}`);
	L.push(`${F}name: '${MCP_PKG}'`);
	if (!enabled) L.push(`${F}disabled: true`);
	L.push(`${F}config:`);
	L.push(`${C}serverName: ${yamlScalar(server.serverName)}`);
	L.push(`${C}transport: ${yamlScalar(server.transport)}`);
	if (server.transport === "streamable-http") {
		if (server.url) L.push(`${C}url: ${yamlScalar(server.url)}`);
		// 只按 key 是否为空过滤:显式空串值(如 LD_PRELOAD: '' 的防御性清空)必须保留。
		const keys = Object.keys(server.headers || {}).filter((k) => k.trim() !== "");
		if (keys.length) {
			L.push(`${C}headers:`);
			for (const k of keys) L.push(`${C}  ${yamlScalar(k)}: ${yamlScalar(server.headers[k])}`);
		}
	} else {
		if (server.command) L.push(`${C}command: ${yamlScalar(server.command)}`);
		if (server.cwd) L.push(`${C}cwd: ${yamlScalar(server.cwd)}`);
		if ((server.args || []).length) {
			L.push(`${C}args:`);
			for (const a of server.args) L.push(`${C}  - ${yamlScalar(a)}`);
		}
		const ekeys = Object.keys(server.env || {}).filter((k) => k.trim() !== "");
		if (ekeys.length) {
			L.push(`${C}env:`);
			for (const k of ekeys) L.push(`${C}  ${yamlScalar(k)}: ${yamlScalar(server.env[k])}`);
		}
	}
	// 原有 config 内未知字段/注释原样带回写(编辑不再丢配置,且保留嵌套相对缩进)。
	// 缩进由 opUpsertMcp 的 relocateExtraLines 负责平移到本行的 config 基线。
	for (const line of server.extraLines || []) {
		if (typeof line !== "string" || line.trim() === "") continue;
		L.push(line);
	}
	return L;
}
function atomicWrite(file, content) {
	const tmp = `${file}.dsh-hub-${process.pid}.tmp`;
	writeFileSync(tmp, content);
	renameSync(tmp, file);
}
function loadPatchLines(patchPath) {
	return readFileSync(patchPath, "utf8").split("\n");
}
function assertFresh(patchPath, expectedMtimeMs) {
	if (expectedMtimeMs === undefined || expectedMtimeMs === null) return;
	let mtime;
	try { mtime = statSync(patchPath).mtimeMs; } catch { throw new HttpError(404, "patch file missing: " + patchPath); }
	if (Math.abs(mtime - Number(expectedMtimeMs)) > 50) {
		throw new HttpError(409, "patch 文件已被外部修改,请刷新后重试");
	}
}
function uniqueId(lines, base) {
	let id = base, n = 2;
	const taken = (v) => lines.some((l) => new RegExp(`^\\s*- id:\\s*${v}\\s*$`).test(l));
	while (taken(id)) id = `${base}-${n++}`;
	return id;
}
function maskSecrets(map) {
	const out = {};
	for (const k of Object.keys(map || {})) {
		out[k] = /key|token|auth|secret|password/i.test(k) ? "•••" : map[k];
	}
	return out;
}
/** Merge "•••" sentinels back to the values of the row being replaced. */
function unmaskFrom(existing, incoming) {
	const out = {};
	for (const k of Object.keys(incoming || {})) {
		const v = incoming[k];
		out[k] = (v === "•••" && existing && existing[k] !== undefined) ? existing[k] : v;
	}
	return out;
}
/** Non-blank, non-comment, indent-0 content at/after startIdx? */
function detectTopLevelContentAfter(lines, startIdx) {
	for (let i = startIdx; i < lines.length; i++) {
		const l = lines[i];
		if (l.trim() === "" || /^\s*#/.test(l)) continue;
		if (/^\s/.test(l)) continue;
		return true;
	}
	return false;
}
/** Indent for rows of a new / joined `- insert:` section (0|2|4 are all valid). */
function detectInsertIndent(lines, blocks) {
	const insRe = /^\s*- insert:\s*(#.*)?$/;
	let insIdx = -1;
	for (let i = 0; i < lines.length; i++) if (insRe.test(lines[i])) insIdx = i;
	if (insIdx >= 0) {
		for (const b of blocks) {
			if (b.start <= insIdx) continue;
			let otherInsert = false;
			for (let j = insIdx + 1; j < b.start; j++) if (insRe.test(lines[j])) { otherInsert = true; break; }
			if (!otherInsert) return b.indent;
		}
	}
	// insert 列表内的行必然 indent > 0;顶层独立行(indent 0)不参与众数,
	// 否则会为 insert 段选出零缩进(产出 {"insert":null})。
	const counts = new Map();
	for (const b of blocks) {
		if (b.indent <= 0) continue;
		counts.set(b.indent, (counts.get(b.indent) || 0) + 1);
	}
	let best = 4, bestN = 0;
	for (const [ind, n] of counts) if (n > bestN || (n === bestN && ind > best)) { best = ind; bestN = n; }
	return best;
}
/** Indent of the first content line under a row's `config:` (-1 when absent). */
function configContentBase(blockLines) {
	let cfg = -1;
	for (let i = 0; i < blockLines.length; i++) {
		const l = blockLines[i];
		if (cfg < 0) {
			const m = l.match(/^(\s*)config:\s*(#.*)?$/);
			if (m) cfg = m[1].length;
			continue;
		}
		if (l.trim() === "" || /^\s*#/.test(l)) continue;
		const ind = l.match(/^\s*/)[0].length;
		return ind > cfg ? ind : -1;
	}
	return -1;
}
/**
 * Re-anchor a row's extraLines onto a rebuilt row: buildRowLines emits config
 * content at row indent + 4, so the offset must follow the source content base.
 */
function relocateExtraLines(extraLines, srcBase, dstBase) {
	if (!Array.isArray(extraLines) || !extraLines.length) return extraLines;
	if (typeof srcBase !== "number" || srcBase < 0) return extraLines;
	const delta = dstBase - srcBase;
	if (delta === 0) return extraLines;
	return extraLines.map((l) => {
		if (typeof l !== "string" || l.trim() === "") return l;
		const ind = l.match(/^\s*/)[0].length;
		return " ".repeat(Math.max(0, ind + delta)) + l.trimStart();
	});
}
/** Drop trailing blank lines, then any `[]` empty-flow-seq placeholder (PROFILE_PATCH_TEMPLATE). */
function dropTrailingEmptySeq(lines) {
	const dropBlanks = () => { while (lines.length && lines[lines.length - 1].trim() === "") lines.pop(); };
	dropBlanks();
	while (lines.length && /^\s*\[\s*\]\s*$/.test(lines[lines.length - 1])) { lines.pop(); dropBlanks(); }
}
function readMcpRows(patchPath, ctx) {
	const lines = loadPatchLines(patchPath);
	const blocks = scanMcpBlocks(lines);
	let entries = [];
	try { entries = [...(ctx.get("loader", false)?.entries?.() || [])]; } catch {}
	const isLive = (rowId) => entries.some((e) => e?.options?.id === rowId && e?.fiber != null);
	// 未 mask 的静态 headers/env。刻意**不放进 rows**:
	// 0.3.4 逐字审核发现它们原本是 row.rawHeaders / row.rawEnv, 而 /state 处理器
	// 直接 `out.mcp = r.rows` 把整行塞进响应体 —— 于是任何能打 loopback API 的
	// 调用方(含已配对设备)都能从 /state 读到明文 API Token。
	// 现改为随返回值单列一张按 row id 索引的表, 只有 /oauth/* 探测路径按需取用。
	const rowsRaw = new Map();
	const rows = blocks.map((b) => {
		const f = parseBlockFields(lines.slice(b.start, b.end));
		const strict = !!(f.serverName && f.transport);
		rowsRaw.set(b.id, { headers: f.headers || {}, env: f.env || {} });
		return {
			id: b.id,
			enabled: !f.disabled,
			live: isLive(b.id),
			source: strict ? "user-patch" : "unknown",
			editable: strict,
			config: {
				serverName: f.serverName, transport: f.transport, url: f.url,
				command: f.command, cwd: f.cwd, args: f.args,
				env: maskSecrets(f.env), headers: maskSecrets(f.headers)
			},
		};
	});
	return { rows, mtimeMs: statSync(patchPath).mtimeMs, rawSecrets: rowsRaw };
}
function opToggleMcp(patchPath, id, enabled) {
	const lines = loadPatchLines(patchPath);
	const b = scanMcpBlocks(lines).find((x) => x.id === id);
	if (!b) throw new HttpError(404, "未找到 MCP 行: " + id);
	const seg = lines.slice(b.start, b.end);
	if (enabled) {
		const out = seg.filter((l) => !/^(\s*)disabled:\s*/.test(l));
		lines.splice(b.start, b.end - b.start, ...out);
	} else if (!seg.some((l) => /^(\s*)disabled:\s*/.test(l))) {
		const nameIdx = seg.findIndex((l) => /^(\s*)name:/.test(l));
		seg.splice(nameIdx + 1, 0, " ".repeat(b.indent + 2) + "disabled: true");
		lines.splice(b.start, b.end - b.start, ...seg);
	}
	atomicWrite(patchPath, lines.join("\n"));
}
function opUpsertMcp(patchPath, idOrNull, server, enabled) {
	const lines = loadPatchLines(patchPath);
	const blocks = scanMcpBlocks(lines);
	const existing = idOrNull ? blocks.find((x) => x.id === idOrNull) : undefined;
	if (idOrNull && !existing) throw new HttpError(404, "未找到 MCP 行: " + idOrNull);
	// serverName 唯一性(排除自身)
	const others = blocks.filter((x) => x.id !== idOrNull)
		.map((x) => parseBlockFields(lines.slice(x.start, x.end)).serverName)
		.filter(Boolean);
	if (others.includes(server.serverName)) throw new HttpError(409, "serverName 已存在: " + server.serverName);
	// "•••" 哨兵回填真实值
	if (existing) {
		const prevLines = lines.slice(existing.start, existing.end);
		const prev = parseBlockFields(prevLines);
		server = {
			...server,
			env: unmaskFrom(prev.env, server.env),
			headers: unmaskFrom(prev.headers, server.headers),
			// 原块内未知字段/注释带回写,编辑不再丢配置。
			// 同块重建时 indent 不变,跨缩进时整体平移到新 config 基线。
			extraLines: relocateExtraLines(
				prev.extraLines || [],
				configContentBase(prevLines),
				existing.indent + 4
			)
		};
	}
	const id = existing ? existing.id : uniqueId(lines, "mcp-" + server.serverName);
	const insertIndent = existing ? existing.indent : detectInsertIndent(lines, blocks);
	const seg = buildRowLines(id, server, enabled, insertIndent);
	if (existing) {
		lines.splice(existing.start, existing.end - existing.start, ...seg);
	} else {
		// 原地追加的前提：最后一个 MCP 块本身在某个 insert 列表内，且其后到文件尾
		// 没有顶层内容。否则挂上去的裸列表项会落到顶层 item 区，产出无法解析的 patch。
		const last = blocks[blocks.length - 1];
		const canAppend = last && last.indent > 0 && !detectTopLevelContentAfter(lines, last.end);
		if (canAppend) {
			lines.splice(last.end, 0, "", ...seg);
		} else {
			// 找得到 insert 段时: 只有当新行缩进与该段已有 MCP 行一致才插入,
			// 否则另起一段,避免同文件出现两种 insert 缩进风格。
			const insIdx = lines.findIndex((l) => /^- insert:\s*(#.*)?$/.test(l));
			const segIndentMatches = insIdx >= 0 && detectInsertIndent(lines, blocks) === insertIndent;
			if (insIdx >= 0 && segIndentMatches) lines.splice(insIdx + 1, 0, ...seg);
			else {
				dropTrailingEmptySeq(lines);
				if (lines.length && lines[lines.length - 1].trim() !== "") lines.push("");
				lines.push("- insert:", ...seg);
			}
		}
	}
	atomicWrite(patchPath, lines.join("\n"));
	return id;
}
function opDeleteMcp(patchPath, id) {
	const lines = loadPatchLines(patchPath);
	const b = scanMcpBlocks(lines).find((x) => x.id === id);
	if (!b) throw new HttpError(404, "未找到 MCP 行: " + id);
	lines.splice(b.start, b.end - b.start);
	// insert 列表空了就一并收走 "- insert:" 行
	const insIdx = lines.findIndex((l) => /^- insert:\s*(#.*)?$/.test(l));
	if (insIdx >= 0) {
		let hasRow = false;
		for (let j = insIdx + 1; j < lines.length; j++) {
			const l = lines[j];
			if (l.trim() === "") continue;
			if (/^\s*- id:/.test(l)) { hasRow = true; break; }
			if (l.match(/^\s*/)[0].length === 0) break;
		}
		if (!hasRow) lines.splice(insIdx, 1);
	}
	atomicWrite(patchPath, lines.join("\n"));
}
/** Try the hot path after a patch write. */
async function applyAfterWrite(ctx, rowId) {
	let hmr = false;
	try { hmr = ctx.get("hmr", false) != null; } catch {}
	if (!hmr) return "restart-required";
	let pm;
	try { pm = ctx.get("pluginManager", false); } catch {}
	if (pm && typeof pm.reload === "function") {
		try {
			await Promise.race([
				pm.reload([rowId]),
				new Promise((r) => setTimeout(r, 15000))
			]);
			return "hot";
		} catch { return "watch"; }
	}
	return "watch";
}
//#endregion

//#region 技能:frontmatter 与文件操作
function parseFrontmatter(content) {
	const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/);
	if (!m) return { fields: {}, body: content, has: false, rawBlock: "" };
	const fields = {};
	// Hub 不管理的 frontmatter 字段原文(license / compatibility / metadata 及其嵌套行),
	// 编辑技能时原样带回写,避免用户配置蒸发。
	const extra = [];
	let inExtraNested = false;
	for (const line of m[1].split(/\r?\n/)) {
		const km = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
		if (!km) {
			if (inExtraNested && /^\s+\S/.test(line)) extra.push(line);
			continue;
		}
		inExtraNested = false;
		const key = km[1];
		const val = stripComment(km[2]);
		if (key === "disable-model-invocation") fields.disableModelInvocation = parseBool(val);
		else if (key === "user-invocable") fields.userInvocable = parseBool(val);
		else if (key === "name" || key === "description" || key === "whenToUse") fields[key] = unquote(val);
		else { extra.push(line); inExtraNested = true; }
	}
	return { fields, body: content.slice(m[0].length), has: true, extraFrontmatter: extra };
}
function buildSkillFile({ name: skillName, description, whenToUse, content, modelInvocable, userInvocable, extraFrontmatter }) {
	const L = ["---"];
	L.push(`name: ${yamlScalar(skillName)}`);
	L.push(`description: ${yamlScalar(description || "")}`);
	if (whenToUse) L.push(`whenToUse: ${yamlScalar(whenToUse)}`);
	if (modelInvocable === false) L.push("disable-model-invocation: true");
	if (userInvocable === false) L.push("user-invocable: false");
	// 原 frontmatter 的非管理字段(license / metadata / …)原样保留。
	for (const line of extraFrontmatter || []) {
		if (typeof line === "string" && line.trim() !== "") L.push(line);
	}
	L.push("---", "");
	return L.join("\n") + (content ?? "");
}
function setFrontmatterField(file, field, value) {
	const content = readFileSync(file, "utf8");
	const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/);
	if (!m) throw new HttpError(409, "技能文件缺少 frontmatter: " + file);
	let block = m[1];
	const re = new RegExp(`^${field}:.*$`, "m");
	if (re.test(block)) block = block.replace(re, `${field}: ${value}`);
	else block += `\n${field}: ${value}`;
	atomicWrite(file, "---\n" + block + "\n---\n" + content.slice(m[0].length));
}
//#endregion

//#region 技能:清单与可写根
function collectSkillViews(ctx, deps) {
	const roots = writableRoots(deps);
	return Promise.resolve(ctx.skills.list()).then((list) => {
		const views = (Array.isArray(list) ? list : []).map((s) => {
			const src = String(s.source || "runtime");
			const path = s.path || null;
			return {
				name: s.name,
				description: s.description || "",
				whenToUse: s.whenToUse || "",
				path,
				source: src,
				provider: s.provider || "",
				modelInvocable: s.invocation ? s.invocation.modelInvocable !== false : true,
				userInvocable: s.invocation ? s.invocation.userInvocable !== false : true,
				editable: !!(path && !/^(bundled|runtime)$/.test(src) && isEditablePath(path, roots))
			};
		});
		views.sort((a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name));
		return views;
	});
}
function writableRoots(deps) {
	const roots = [];
	if (deps.dshHome) roots.push({ root: join(deps.dshHome, "skills"), label: "user" });
	if (deps.agentsHome) roots.push({ root: join(deps.agentsHome, "skills"), label: "custom" });
	for (const c of deps.projectRoots()) roots.push({ root: join(c, ".dsh", "skills"), label: "project" });
	for (const d of deps.customSkillDirs()) roots.push({ root: d, label: "custom" });
	return roots.filter((r) => typeof r.root === "string" && r.root);
}
function isEditablePath(pathStr, roots) {
	let rp;
	try { rp = realpathSync(pathStr); } catch { return false; }
	for (const r of roots) {
		let rr;
		try { rr = realpathSync(r.root); } catch { continue; }
		if (rp === rr || rp.startsWith(rr + sep)) return true;
	}
	return false;
}
function findWhitelistedSkill(ctx, deps, pathStr) {
	if (!pathStr) throw new HttpError(400, "缺少 path");
	const roots = writableRoots(deps);
	const real = (p) => { try { return realpathSync(p); } catch { return null; } };
	return collectSkillViews(ctx, deps).then((views) => {
		const rp = real(pathStr);
		const hit = views.find((v) => v.path && (v.path === pathStr || (rp !== null && real(v.path) === rp)));
		if (hit) return hit;
		/*
		 * 注册表可能尚未刷新(文件监视器有稳定性延迟):刚创建/改名的技能不在 list() 里,
		 * 于是「创建后立刻开关」会被误判为越权。只要 realpath 落在可写技能根内就放行 ——
		 * 这与写操作的边界完全一致,内建(bundled)与运行时来源不在可写根内,仍然拒绝。
		 */
		if (rp !== null && isEditablePath(rp, roots)) {
			const name = basename(rp) === "SKILL.md"
				? basename(dirname(rp))
				: basename(rp).replace(/\.md$/, "");
			return {
				name, description: "", whenToUse: "", path: rp,
				source: "user", provider: "", modelInvocable: true, userInvocable: true, editable: true
			};
		}
		throw new HttpError(404, "路径不在技能清单中: " + pathStr);
	});
}
/**
 * 回收站根:必须落在所有技能扫描根之外,否则被删技能会作为幽灵重新出现
 * (skill-filesystem 的 discoverRoot 只跳过 .system,不跳过 .trash)。
 * 取各可写根父目录的 .trash/skills;多个根共处同一父级时天然合并。
 */
function trashRoots(deps) {
	const out = [];
	for (const r of writableRoots(deps)) {
		if (r.label === "project") continue; // 项目技能就地 .trash 仍在项目根内 → 同样幽灵
		const candidate = join(dirname(r.root), ".trash", "skills");
		if (!out.includes(candidate)) out.push(candidate);
	}
	if (!out.length && deps.dshHome) out.push(join(deps.dshHome, ".trash", "skills"));
	return out;
}
function trashTarget(pathStr, deps) {
	const file = String(pathStr);
	const victim = basename(file) === "SKILL.md" ? dirname(file) : file;
	const stamp = `${Date.now()}-${process.pid}-${basename(victim)}`;
	const roots = trashRoots(deps);
	let dest = null;
	for (const root of roots) {
		const candidate = join(root, stamp);
		try {
			mkdirSync(root, { recursive: true });
			if (existsSync(candidate)) continue;
			renameSync(victim, candidate);
			dest = candidate;
			break;
		} catch { continue; }
	}
	if (dest === null) throw new HttpError(500, "无法移入回收站(无可写位置)");
	return { victim, dest };
}
//#endregion

//#region OAuth 装配
/**
 * 凭据文件路径: <dshHome>/mcp-auth.json（与 opencode 的 ~/.local/share/opencode 不同盘，
 * 互不覆盖；需要迁移时用 auth-store 的 mergeExternalStore）。
 */
function resolveAuthStorePath(deps) {
	try { return authStorePath({ dshHome: deps?.dshHome }); }
	catch { return join(process.env.DSH_HOME || join(homedir(), ".dsh"), "mcp-auth.json"); }
}

/** 与 host 半 route() 同形的路由工厂（围栏 + 405 + 错误兜底），供 oauth-server 复用。 */
function makeRouteFactory(ctx) {
	return (path, method, handler) => ({
		kind: "exact",
		path,
		handler: async (req, res) => {
			if (!isAllowed(ctx, req)) return writeJson(res, 403, { error: "forbidden: loopback / paired device only" });
			if (req.method !== method) return writeJson(res, 405, { error: "method not allowed: " + req.method });
			try { await handler(req, res); }
			catch (e) {
				const status = e instanceof HttpError ? e.status : 500;
				try { ctx.logger?.warn?.(`[${name}] ${req.method} ${path}:`, e); } catch {}
				if (!res.headersSent) writeJson(res, status, { error: String((e && e.message) || e) });
			}
		}
	});
}

/**
 * 注册 mcpAuth 服务: 底座 seam 通过 `ctx.get('mcpAuth', false)?.getAuthProvider(serverName, config)`
 * 取 provider。
 *
 * 索引键口径（P0 级约束）：auth-store 的条目 key 必须用 **patch 行 id**，
 * 不能用 config.serverName。理由：OAuth 路由（/oauth/start、/oauth/status）的 id
 * 来自 readMcpRows 的行 id（如 mcp-cloudflare），若 provider 用 serverName
 * （如 cloudflare）作键，则路由写的凭据与 seam 读的凭据落在两个 key 上，永远对不上。
 *
 * 行 id 的推导：底座只给 (serverName, config)，拿不到行 id，故反查 patch 中
 * serverName + url 都匹配的那一行。
 *
 * 降级（P1 级约束）：任何异常都必须吞掉返 undefined。seam 是
 * `?.getAuthProvider(...)`，一旦抛错会冒泡到 startConnection 使整行不可用 ——
 * 比"没有 OAuth 但有静态 headers"严重得多。
 */
	/**
	 * 从 patch 行反查 id：serverName + url 都匹配的唯一一行。
	 *
	 * 降级（P1 级约束）：任何异常都必须吞掉返 undefined。seam 是
	 * `?.getAuthProvider(...)`，一旦抛错会冒泡到 startConnection 使整行不可用 ——
	 * 比"没有 OAuth 但有静态 headers"严重得多。
	 *
	 * 安全：返回 undefined 表示"无法确定唯一行"。此时若退回 serverName 作 auth-store
	 * 键，可能与另一行的**行 id**相等（如手写 `- id: github`），导致 A 行的 token 被
	 * B 行读出并发往 B 的主机。故降级键必须加 `degraded:` 前缀隔离，使碰撞在构造上
	 * 不可能发生（审计 M1）。
	 */
	function registerAuthService(ctx, deps) {
		if (typeof ctx.provide !== "function") return;
		const byId = new Map();
		const fail = (e) => { try { ctx.logger?.warn?.(`[${name}] mcpAuth: ${String((e && e.message) || e)}`); } catch {} };
		/** 从 patch 行反查 id：serverName + url 都匹配的唯一一行。 */
		const resolveRowId = (serverName, config) => {
			try {
				const rows = readMcpRows(deps.patchPath, ctx).rows || [];
				const url = typeof config?.url === "string" ? config.url : "";
				const hit = rows.filter((r) =>
					r.config?.serverName === serverName && (url === "" || r.config?.url === url));
				return hit.length === 1 ? hit[0].id : undefined;
			} catch (e) { fail(e); return undefined; }
		};
		const service = {
			authPath: deps.authPath,
			getAuthProvider(serverName, config) {
				try {
					const url = typeof config?.url === "string" ? config.url : "";
					if (!url) return undefined;
					const name0 = String(serverName || "");
					// 空 serverName 无法构成任何有意义的 auth-store 键, 直接放弃
					// （createAuthProvider 对空 name 有硬断言, 返 provider 也会在别处炸）。
					if (!name0) return undefined;
					// 优先用行 id 作 auth-store 键（与 oauth 路由同口径）；查不到唯一行时
					// 用带前缀的降级键。降级键与行 id 不可能碰撞（前缀隔离），
					// 因此绝不会把 A 行的凭据发给 B 行的主机。
					const rowId = resolveRowId(name0, config);
					const key = rowId || `degraded:${name0}`;
					const cacheKey = key + "\u0000" + url;
					let existing = byId.get(cacheKey);
					if (existing) return existing;
					const created = createAuthProvider({
						name: key,
						serverUrl: url,
						filePath: deps.authPath,
						staticHeaders: config?.headers || {},
					});
					// P0-D: 必须给 SDK-facing provider 注入占位 redirectUrl。
					// SDK 判 `nonInteractiveFlow = !provider.redirectUrl`, 缺它就恒真,
					// 进 fetchToken() 必抛 —— 永远到不了 refresh_token 分支,
					// token 过期后再也不会自己刷新(refresh 流程不发 redirect_uri,
					// 故占位值无需真实可监听; 真正可监听的是 /oauth/start 那条路径)。
					try { created.setRedirectUrl(`http://127.0.0.1:0${CALLBACK_PATH}`); }
					catch { /* 占位值恒合法; 失败也不该阻断 provider 交付 */ }
					byId.set(cacheKey, created);
					return created;
				} catch (e) {
					// P1: 异常绝不冒泡到 startConnection
					fail(e);
					return undefined;
				}
			},
			listKnown: () => [...byId.keys()],
		};
		try { ctx.provide("mcpAuth", service); } catch (e) { fail(e); }
	}
/**
 * 冷启动补偿重连（Cordis 顺序敏感的缺口）。
 *
 * 实测结论: mcp-client 若先于 Hub mount, 其 startConnection 里的
 * ctx.get('mcpAuth') 首读为 undefined, 且已跑完的 consumer 不会被唤醒。
 * 后果分两种:
 *   - 冷启动无 token: 用户点授权 → /oauth/start → applyAfterWrite 触发重载 → 自愈
 *   - 冷启动**有** token: 无人唤醒底座 → 该行一直用不了 OAuth ← 唯一缺口
 *
 * 本函数补第二种: 读 mcp-auth.json 里有 tokens 的 entry, 与 patch 中 enabled 的
 * http 行求交集, 对每行触发一次重载(复用 applyAfterWrite 的 pm.reload 路径)。
 *
 * 约束: setTimeout(0) 延到下一 tick(确保 ctx 稳定); 幂等; 失败不阻塞启动; 不无限重试。
 */
function scheduleAuthReconnect(ctx, deps) {
	const run = async () => {
		let rows = []
		try { rows = readMcpRows(deps.patchPath, ctx).rows || [] } catch { return }
		let stored = {}
		try { stored = loadAuthStore(deps.authPath) || {} } catch { return }
		// 交集: patch 中 enabled 的 streamable-http 行 × store 里有 accessToken 的 entry
		const targets = rows.filter((r) => {
			if (r.config?.transport !== "streamable-http") return false
			if (!r.enabled) return false
			const entry = stored[r.id]
			return !!(entry && entry.tokens && typeof entry.tokens.accessToken === "string" && entry.tokens.accessToken !== "")
		})
		if (targets.length === 0) return
		// 与 applyAfterWrite 同一口径: 没有 hmr 服务时重载无意义, 直接放弃
		let hmr = false
		try { hmr = ctx.get("hmr", false) != null } catch { return }
		if (!hmr) return
		let pm
		try { pm = ctx.get("pluginManager", false) } catch { return }
		if (!pm || typeof pm.reload !== "function") return
		for (const row of targets) {
			try {
				await Promise.race([
					pm.reload([row.id]),
					new Promise((r) => setTimeout(r, 15000))
				])
			} catch {
				// 单行失败不影响其它行, 也不阻塞启动; 不重试(下次点授权会走 applyAfterWrite)
			}
		}
	}
	try { setTimeout(run, 0) } catch {}
}
//#endregion

//#region 路由
function makeRoutes(ctx, deps) {
	const route = (path, method, handler) => ({
		kind: "exact",
		path,
		handler: async (req, res) => {
			if (!isAllowed(ctx, req)) return writeJson(res, 403, { error: "forbidden: loopback / paired device only" });
			if (req.method !== method) return writeJson(res, 405, { error: "method not allowed: " + req.method });
			try {
				await handler(req, res);
			} catch (e) {
				const status = e instanceof HttpError ? e.status : 500;
				try { ctx.logger?.warn?.(`[${name}] ${req.method} ${path}:`, e); } catch {}
				if (!res.headersSent) writeJson(res, status, { error: String((e && e.message) || e) });
			}
		}
	});

	const stateHandler = async (req, res) => {
		const out = {
			profile: deps.profileDir ? basename(deps.profileDir) : null,
			hmr: (() => { try { return ctx.get("hmr", false) != null; } catch { return false; } })(),
			mcpAvailable: false, mcpError: "", mcp: [], patchMtimeMs: 0,
			skills: [], registryOk: true, projectRoots: deps.projectRoots().slice(0, 5)
		};
		if (deps.patchPath) {
			try {
				const r = readMcpRows(deps.patchPath, ctx);
				out.mcp = r.rows; out.patchMtimeMs = r.mtimeMs; out.mcpAvailable = true;
			} catch (e) { out.mcpError = String((e && e.message) || e); }
		}
		try { out.skills = await collectSkillViews(ctx, deps); }
		catch { out.registryOk = false; }
		writeJson(res, 200, out);
	};

	const validateServer = (server) => {
		if (!server || typeof server !== "object") throw new HttpError(400, "缺少 server");
		const n = String(server.serverName || "");
		if (!/^[A-Za-z0-9_-]{1,32}$/.test(n)) throw new HttpError(400, "serverName 需匹配 [A-Za-z0-9_-]{1,32}");
		const t = server.transport;
		if (t !== "streamable-http" && t !== "stdio") throw new HttpError(400, "transport 必须是 streamable-http 或 stdio");
		if (t === "streamable-http") {
			if (!server.url || !/^https?:\/\//i.test(String(server.url))) throw new HttpError(400, "url 必填且需以 http(s):// 开头");
		} else if (!server.command) {
			throw new HttpError(400, "stdio 传输需要 command");
		}
	};

	return [
		route(API + "/state", "GET", stateHandler),

		route(API + "/mcp/upsert", "POST", async (req, res) => {
			const body = await readJson(req);
			assertFresh(deps.patchPath, body.expectedMtimeMs);
			validateServer(body.server);
			const id = opUpsertMcp(deps.patchPath, body.id || null, body.server, body.enabled !== false);
			writeJson(res, 200, { ok: true, id, applied: await applyAfterWrite(ctx, id) });
		}),

		route(API + "/mcp/toggle", "POST", async (req, res) => {
			const body = await readJson(req);
			assertFresh(deps.patchPath, body.expectedMtimeMs);
			if (!body.id) throw new HttpError(400, "缺少 id");
			opToggleMcp(deps.patchPath, body.id, body.enabled !== false);
			writeJson(res, 200, { ok: true, id: body.id, applied: await applyAfterWrite(ctx, body.id) });
		}),

		route(API + "/mcp/delete", "POST", async (req, res) => {
			const body = await readJson(req);
			assertFresh(deps.patchPath, body.expectedMtimeMs);
			if (!body.id) throw new HttpError(400, "缺少 id");
			opDeleteMcp(deps.patchPath, body.id);
			writeJson(res, 200, { ok: true, id: body.id, applied: await applyAfterWrite(ctx, body.id) });
		}),

		route(API + "/skills/read", "GET", async (req, res) => {
			const p = queryParam(req, "path");
			await findWhitelistedSkill(ctx, deps, p);
			const content = readFileSync(p, "utf8");
			const parsed = parseFrontmatter(content);
			writeJson(res, 200, {
				path: p,
				name: parsed.fields.name || "",
				description: parsed.fields.description || "",
				whenToUse: parsed.fields.whenToUse || "",
				modelInvocable: parsed.fields.disableModelInvocation !== true,
				userInvocable: parsed.fields.userInvocable !== false,
				content: parsed.body
			});
		}),

		route(API + "/skills/create", "POST", async (req, res) => {
			const body = await readJson(req);
			const skillName = String(body.name || "").trim();
			// 与 skill-filesystem 的 SKILL_NAME(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)严格对齐:
			// 宽于此的校验会创建出 provider 拒绝发现的技能(创建成功但静默消失)。
			if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skillName) || skillName.length > 64) {
				throw new HttpError(400, "技能名需为 kebab-case(小写字母/数字/单个连字符,如 my-skill)");
			}
			const roots = writableRoots(deps).filter((r) => r.label === (body.scope === "project" ? "project" : "user"));
			if (!roots.length) throw new HttpError(400, "该来源当前不可写(需要活动会话或用户技能目录)");
			const root = roots[0].root;
			const dir = join(root, skillName);
			if (existsSync(dir) || existsSync(join(root, skillName + ".md"))) throw new HttpError(409, "同名技能已存在: " + skillName);
			mkdirSync(dir, { recursive: true });
			const file = join(dir, "SKILL.md");
			atomicWrite(file, buildSkillFile({
				name: skillName,
				description: String(body.description || ""),
				whenToUse: body.whenToUse ? String(body.whenToUse) : "",
				content: String(body.content || ""),
				modelInvocable: body.modelInvocable !== false,
				userInvocable: body.userInvocable !== false
			}));
			writeJson(res, 200, { ok: true, path: file });
		}),

		route(API + "/skills/update", "POST", async (req, res) => {
			const body = await readJson(req);
			const hit = await findWhitelistedSkill(ctx, deps, body.path);
			if (!hit.editable) throw new HttpError(403, "该来源只读: " + hit.source);
			const prev = parseFrontmatter(readFileSync(body.path, "utf8"));
			atomicWrite(body.path, buildSkillFile({
				name: hit.name, // 改名走删旧建新;这里锁定原名
				description: String(body.description ?? prev.fields.description ?? ""),
				whenToUse: body.whenToUse !== undefined ? String(body.whenToUse || "") : (prev.fields.whenToUse || ""),
				content: String(body.content ?? prev.body),
				modelInvocable: prev.fields.disableModelInvocation !== true,
				userInvocable: prev.fields.userInvocable !== false,
				extraFrontmatter: prev.extraFrontmatter || []
			}));
			writeJson(res, 200, { ok: true, path: body.path });
		}),

		route(API + "/skills/toggle", "POST", async (req, res) => {
			const body = await readJson(req);
			const hit = await findWhitelistedSkill(ctx, deps, body.path);
			if (!hit.editable) throw new HttpError(403, "该来源只读: " + hit.source);
			setFrontmatterField(body.path, "disable-model-invocation", body.modelInvocable === false ? "true" : "false");
			writeJson(res, 200, { ok: true, modelInvocable: body.modelInvocable !== false });
		}),

		route(API + "/skills/delete", "POST", async (req, res) => {
			const body = await readJson(req);
			const hit = await findWhitelistedSkill(ctx, deps, body.path);
			if (!hit.editable) throw new HttpError(403, "该来源只读: " + hit.source);
			const { victim, dest } = trashTarget(body.path, deps);
			writeJson(res, 200, { ok: true, trash: dest });
		})
	];
}
//#endregion

//#region apply
function applyImpl(ctx, config) {
	if (config?.enabled === false) return;
	const dshHome = config?.dshHome || process.env.DSH_HOME || join(homedir(), ".dsh");
	const agentsHome = config?.agentsHome || process.env.DSH_AGENTS_HOME || join(homedir(), ".agents");
	const profileDir = config?.profileDir ? String(config.profileDir) : resolveProfileDir(name);
	const deps = {
		dshHome,
		agentsHome,
		profileDir,
		patchPath: config?.patchPath
			? String(config.patchPath)
			: (profileDir ? join(profileDir, "cordis.patch.yml") : null),
		projectRoots: () => {
			const out = [];
			try {
				const sessions = ctx.get("sessions", false);
				if (typeof sessions?.list === "function") {
					for (const s of sessions.list() || []) {
						const cwd = s?.header?.cwd;
						if (typeof cwd === "string" && cwd) out.push(cwd);
					}
				}
			} catch {}
			if (!out.length) out.push(process.cwd());
			return [...new Set(out)];
		},
		customSkillDirs: () => {
			const own = Array.isArray(config?.customSkillDirs) ? config.customSkillDirs : [];
			const fromRows = [];
			try {
				const loader = ctx.get("loader", false);
				for (const e of loader?.entries?.() || []) {
					const o = e?.options || {};
					if (o.name === "skill-filesystem" && Array.isArray(o.customSkillDirs)) fromRows.push(...o.customSkillDirs);
				}
			} catch {}
			return [...new Set([...own, ...fromRows])];
		}
	};
	const routes = makeRoutes(ctx, deps);
	// OAuth 授权路由（5 条）+ mcpAuth 服务（供底座 seam 的 ctx.get('mcpAuth', false) 取用）。
	// 任一环节失败都不得影响既有路由注册 —— OAuth 是增量能力, 不是 Hub 的必需路径。
	const oauthRoutes = [];
	try {
		const authPath = resolveAuthStorePath(deps);
		oauthRoutes.push(...registerOAuthRoutes({
			route: makeRouteFactory(ctx),
			patchPath: deps.patchPath,
			authPath,
			readMcpRows: (p) => readMcpRows(p, ctx),
			writeJson,
			seamState: () => SEAM_STATE,
		}));
		registerAuthService(ctx, { patchPath: deps.patchPath, authPath });
		// 冷启动补偿: 有 token 但底座已先 mount 的行, 下一 tick 触发一次重载
		scheduleAuthReconnect(ctx, { patchPath: deps.patchPath, authPath });
	} catch (e) {
		try { ctx.logger?.warn?.(`[${name}] oauth routes unavailable: ${String((e && e.message) || e)}`); } catch {}
	}
	// 卸载与还原路由(3 条): 本插件会改写 mcp-client bundle, 因此「卸载」必须同时
	// 还原 bundle + 移除插件。plan 依赖注入而非自己再找一遍路径, 与 self-heal 同源。
	// findBundle 是 async 的(P1-5: 用 execFile 避免冻结 dsh 事件循环), 故 plan 也异步,
	// 且必须 await —— 把 Promise 直接当路径传下去会被 planUninstall 的类型闸门拒掉。
	const uninstallRoutes = [];
	try {
		uninstallRoutes.push(...registerUninstallRoutes({
			route: makeRouteFactory(ctx),
			writeJson,
			plan: async () => {
				let bundlePath = null;
				try {
					const found = await findBundle();
					bundlePath = typeof found === "string" ? found : (found && found.path) || null;
				} catch {}
				if (!bundlePath) bundlePath = join(profileDir || "", "node_modules", MCP_PKG, "lib", "index.js");
				return planUninstall({ bundlePath, profileDir, packageName: name });
			},
		}));
	} catch (e) {
		try { ctx.logger?.warn?.(`[${name}] uninstall routes unavailable: ${String((e && e.message) || e)}`); } catch {}
	}
	ctx.effect(() => {
		const disposers = routes.map((r) => ctx.webServer.register(r));
		for (const r of oauthRoutes) { try { ctx.webServer.register(r); } catch {} }
		// 卸载路由单独注册: 即便 OAuth 半区初始化失败, 「安全回退」也必须可用 ——
		// 否则用户既拿不到授权, 又没法一键还原到官方原版。
		for (const r of uninstallRoutes) { try { ctx.webServer.register(r); } catch {} }
		return () => { for (const d of disposers) { try { d(); } catch {} } };
	}, name + ": routes");
	try { ctx.logger?.info?.(`[${name}] routes on ${API} (profile: ${basename(profileDir || "?")}, patch: ${deps.patchPath})`); } catch {}
	// OAuth seam 运行时自愈: npm 12 起默认阻止依赖的 install scripts, postinstall
	// 无法保证执行, 故在 dsh 启动时检测并在缺失时自动补(幂等 + 备份 + 写后校验,
	// 延 tick 不阻塞启动)。详见 lib/self-heal.mjs。
	scheduleOauthSeamSelfHeal();
}

/**
 * 延到下一 tick 跑自愈, 失败绝不阻塞启动。
 *
 * P0-2: 异常状态(anchor-missing / corrupt / not-applicable / verify-failed)
 * 必须让用户看见 —— 以前静默 return, dsh 升级后 OAuth 死了而 UI 还显示「已授权」。
 * 自愈结果同时写进模块级变量, 供 /oauth/status  surfaced(P1-8)。
 */
function scheduleOauthSeamSelfHeal() {
	try {
		setTimeout(() => {
			Promise.resolve()
				.then(() => selfHealOauthSeam({ autoFix: true, pluginVersion: PLUGIN_VERSION }))
				.then((r) => {
					SEAM_STATE.status = r.status
					SEAM_STATE.detail = r.detail || {}
					SEAM_STATE.checkedAt = Date.now()
					if (r.status === "patched") {
						process.stderr.write("[dsh-mcp-skill-hub] OAuth seam auto-healed; restart profile to activate\n");
					}
				})
				.catch(() => {});
		}, 0);
	} catch {}
}

const MOUNT_KEY = "__dshMcpSkillHubMounted";
function apply(ctx, config) {
	if (globalThis[MOUNT_KEY]) return;
	globalThis[MOUNT_KEY] = true;
	return applyImpl(ctx, config);
}
//#endregion

/** Test-only surface (stable, do not depend on it at runtime). */
const __internals = {
	scanMcpBlocks, parseBlockFields, buildRowLines, yamlScalar, unquote,
	stripComment, parseFrontmatter, buildSkillFile, splitFlowItems,
	opToggleMcp, opUpsertMcp, opDeleteMcp, readMcpRows, resolveProfileDir,
	detectTopLevelContentAfter, detectInsertIndent, configContentBase,
	relocateExtraLines, dropTrailingEmptySeq,
	registerAuthService
};

export { name, inject, apply, __internals };
