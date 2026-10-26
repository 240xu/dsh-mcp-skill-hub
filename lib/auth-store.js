/**
 * MCP OAuth 凭据持久层。
 *
 * 单文件 JSON store(~/.dsh/mcp-auth.json, 0600), 顶层 { [mcpName]: entry },
 * entry 结构与 opencode 的 ~/.local/share/opencode/mcp-auth.json 互通:
 *   { serverUrl, clientInfo:{clientId,clientIdIssuedAt,clientSecret?,clientSecretExpiresAt?},
 *     tokens:{accessToken,refreshToken,expiresAt,scope}, codeVerifier?, oauthState?, updatedAt? }
 *
 * 约束(PRINCIPLES.md):
 *   - 禁止 import lib/index.js —— index.js 会 import 本模块, 反向成环;
 *   - 读坏文件只抢救不销毁也不抛错(写坏即 P0);
 *   - secret 只进这个 0600 文件, 不进日志/错误信息/异常 message;
 *   - 所有写盘走 原子写 + 显式 chmod 600(umask 不可靠)。
 */
import { join, dirname, basename } from "node:path";
import { homedir } from "node:os";
import {
	readFileSync, writeFileSync, renameSync, mkdirSync, chmodSync, statSync, rmSync
} from "node:fs";

const FILE_MODE = 0o600;
const DIR_MODE = 0o700;
const LOG_TAG = "[dsh-mcp-skill-hub]";
const RESERVED_KEYS = ["__proto__", "constructor", "prototype"];

function warn(message) {
	try { console.error(LOG_TAG + " " + message); } catch {}
}
function isPlainObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nowSec() {
	return Math.floor(Date.now() / 1000);
}
function assertName(name) {
	const key = typeof name === "string" ? name.trim() : "";
	if (!key) throw new Error("mcp name must be a non-empty string");
	return key;
}
function setKey(store, key, value) {
	if (RESERVED_KEYS.includes(key)) {
		Object.defineProperty(store, key, { value, writable: true, enumerable: true, configurable: true });
		return;
	}
	store[key] = value;
}
function deleteKey(store, key) {
	delete store[key];
}

/**
 * 默认存储路径: ~/.dsh/mcp-auth.json。
 */
/**
 * 凭据文件路径。
 * @param {{dshHome?: string}} [options] 显式指定 dshHome（测试沙箱用）；缺省走
 *   $DSH_HOME → ~/.dsh，与 Hub host 半的 resolveProfileDir 口径一致。
 */
function authStorePath(options) {
	const dshHome = options?.dshHome || process.env.DSH_HOME || join(homedir(), ".dsh");
	return join(dshHome, "mcp-auth.json");
}

/**
 * 读 store。任何异常都收敛成 {}, 绝不让调用方崩:
 *   文件不存在 / 空 / 纯空白 → {}
 *   JSON 解析失败 → 原文件改名保留为 <path>.corrupt-<ts> 后返回 {}
 *   顶层不是对象(数组/字符串/null) → {}
 */
function loadAuthStore(filePath) {
	if (typeof filePath !== "string" || !filePath) return {};
	let raw;
	try { raw = readFileSync(filePath, "utf8"); } catch { return {}; }
	if (typeof raw !== "string" || raw.trim() === "") return {};
	let parsed;
	try { parsed = JSON.parse(raw); } catch {
		quarantineCorrupt(filePath);
		return {};
	}
	if (!isPlainObject(parsed)) return {};
	return parsed;
}

function quarantineCorrupt(filePath) {
	const dest = filePath + ".corrupt-" + Date.now();
	try {
		renameSync(filePath, dest);
		warn("auth store is not valid JSON, quarantined as " + basename(dest));
	} catch {
		warn("auth store is not valid JSON and cannot be quarantined: " + basename(filePath));
	}
}

/**
 * 原子写: 同目录 tmp(pid + 随机后缀) → chmod 600 → rename。
 * 先 chmod 后 rename, 避免窗口期明文可被他人读; rename 后可覆盖已存在目标。
 */
function saveAuthStore(filePath, data) {
	if (typeof filePath !== "string" || !filePath) throw new Error("auth store path must be a non-empty string");
	if (!isPlainObject(data)) throw new Error("auth store payload must be an object: " + filePath);
	const dir = dirname(filePath);
	mkdirSync(dir, { recursive: true, mode: DIR_MODE });
	let dirMode = 0;
	try { dirMode = statSync(dir).mode & 0o777; } catch {}
	if (dirMode > DIR_MODE) {
		warn("auth store directory is too open (0" + dirMode.toString(8) + "): " + dir);
	}
	const tmp = join(dir, "." + basename(filePath) + ".tmp-" + process.pid + "-" + Math.random().toString(36).slice(2, 10));
	writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", { mode: FILE_MODE });
	chmodSync(tmp, FILE_MODE);
	try {
		renameSync(tmp, filePath);
	} catch (error) {
		try { rmSync(tmp, { force: true }); } catch {}
		throw error;
	}
	chmodSync(filePath, FILE_MODE);
	const mode = statSync(filePath).mode & 0o777;
	if (mode !== FILE_MODE) {
		throw new Error("auth store mode is 0" + mode.toString(8) + ", expected 0600: " + filePath);
	}
}

/**
 * 读-改-写 with re-read: 先在快照上跑一遍(任何抛错都发生在写盘前),
 * 再读一次最新文件, 把同样的修改重放到最新状态上再写, 降低多实例丢更新概率。
 * 无变化的条目不写盘(removeEntry 不存在的 name 不会留下空文件)。
 */
function mutateStore(filePath, mutator) {
	const draft = loadAuthStore(filePath);
	mutator(draft);
	const store = loadAuthStore(filePath);
	const before = JSON.stringify(store);
	mutator(store);
	if (JSON.stringify(store) === before) return store;
	saveAuthStore(filePath, store);
	return store;
}

function normalizeUrlKey(url) {
	if (typeof url !== "string" || url.trim() === "") return null;
	const raw = url.trim();
	let parsed;
	try { parsed = new URL(raw); } catch { return "raw:" + raw; }
	if (!parsed.origin || parsed.origin === "null") return "raw:" + raw;
	let path = parsed.pathname;
	if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
	return parsed.origin + path;
}

/**
 * 取条目。entry 不是对象时视为不存在(不要污染下面的字段访问)。
 */
function getEntry(filePath, name) {
	const store = loadAuthStore(filePath);
	const entry = store[assertName(name)];
	return isPlainObject(entry) ? entry : undefined;
}

/**
 * 按 name + serverUrl 取条目。URL 规范化: origin + pathname,
 * 忽略尾部斜杠差异与 query/fragment; 解析失败退回严格字符串比较。
 * serverUrl 不匹配 → undefined, 防止 URL 改动后串凭据。
 */
function getEntryForUrl(filePath, name, url) {
	const entry = getEntry(filePath, name);
	if (!entry) return undefined;
	const wanted = normalizeUrlKey(url);
	const actual = normalizeUrlKey(entry.serverUrl);
	if (wanted === null || actual === null || wanted === "" || actual === "") return undefined;
	return wanted === actual ? entry : undefined;
}

/**
 * 合并式写入: 已有字段保留, 本次提供的字段覆盖, 显式 undefined 表示删除该字段。
 * 总要带上 updatedAt(purgeStalePending 的判据)。
 * 显式提供 updatedAt 时不覆写(供测试与迁移构造历史时间戳), 但 pendingAt 只由
 * beginPending 设置, 保证授权开始时间不被后续普通写入刷新。
 */
function setEntry(filePath, name, entry) {
	const key = assertName(name);
	const patch = isPlainObject(entry) ? entry : {};
	mutateStore(filePath, (store) => {
		const prev = isPlainObject(store[key]) ? store[key] : {};
		const next = { ...prev };
		for (const field of Object.keys(patch)) {
			const value = patch[field];
			if (value === undefined) deleteKey(next, field);
			else setKey(next, field, value);
		}
		if (patch.updatedAt === undefined) setKey(next, "updatedAt", nowSec());
		setKey(store, key, next);
	});
}

function removeEntry(filePath, name) {
	const key = assertName(name);
	let existed = false;
	mutateStore(filePath, (store) => {
		if (!(key in store)) return;
		existed = true;
		deleteKey(store, key);
	});
	return existed;
}

function listEntries(filePath) {
	const store = loadAuthStore(filePath);
	return Object.keys(store).map((entryName) => ({ name: entryName, entry: store[entryName] }));
}

function getClientInfo(filePath, name) {
	const entry = getEntry(filePath, name);
	return entry && isPlainObject(entry.clientInfo) ? entry.clientInfo : undefined;
}

function setClientInfo(filePath, name, clientInfo) {
	const key = assertName(name);
	if (!isPlainObject(clientInfo)) throw new Error("clientInfo must be an object for mcp: " + key);
	setEntry(filePath, key, { clientInfo });
}

function getTokens(filePath, name) {
	const entry = getEntry(filePath, name);
	return entry && isPlainObject(entry.tokens) ? entry.tokens : undefined;
}

function setTokens(filePath, name, tokens) {
	const key = assertName(name);
	if (!isPlainObject(tokens)) throw new Error("tokens must be an object for mcp: " + key);
	if (typeof tokens.accessToken !== "string" || tokens.accessToken === "") {
		throw new Error("tokens.accessToken must be a non-empty string for mcp: " + key);
	}
	setEntry(filePath, key, { tokens });
}

function clearTokens(filePath, name) {
	setEntry(filePath, assertName(name), { tokens: undefined });
}

function getCodeVerifier(filePath, name) {
	const entry = getEntry(filePath, name);
	return entry && typeof entry.codeVerifier === "string" ? entry.codeVerifier : undefined;
}

function setCodeVerifier(filePath, name, verifier) {
	const key = assertName(name);
	if (typeof verifier !== "string" || verifier === "") throw new Error("codeVerifier must be a non-empty string for mcp: " + key);
	setEntry(filePath, key, { codeVerifier: verifier, pendingAt: nowSec() });
}

function getOAuthState(filePath, name) {
	const entry = getEntry(filePath, name);
	return entry && typeof entry.oauthState === "string" ? entry.oauthState : undefined;
}

function setOAuthState(filePath, name, state) {
	const key = assertName(name);
	if (typeof state !== "string" || state === "") throw new Error("oauthState must be a non-empty string for mcp: " + key);
	setEntry(filePath, key, { oauthState: state, pendingAt: nowSec() });
}

/**
 * 授权完成/失败收尾: 同时清掉 pending 对(codeVerifier + oauthState)。
 */
/**
 * 授权完成/失败收尾: 同时清掉 pending 对(codeVerifier + oauthState + pendingAt)。
 *
 * 条目从未授权过(无 pending 对)时**直接返回不写盘** —— 否则 finish/cancel 之类
 * 的幂等调用会给 store 堆出一堆只含 updatedAt 的空壳条目。
 */
function clearOAuthState(filePath, name) {
	const key = assertName(name);
	const store = loadAuthStore(filePath);
	const entry = store[key];
	if (!isPlainObject(entry)) return store;
	if (entry.codeVerifier === undefined && entry.oauthState === undefined) return store;
	return setEntry(filePath, key, { codeVerifier: undefined, oauthState: undefined, pendingAt: undefined });
}

/**
 * 并入 opencode 的 mcp-auth.json 内容。已有 entry 的 tokens / clientInfo 一律不覆盖,
 * 只补齐缺失字段 —— 防止上游文件把本 store 的活凭据顶掉。
 */
function mergeExternalStore(filePath, externalData) {
	const external = isPlainObject(externalData) ? externalData : {};
	mutateStore(filePath, (store) => {
		for (const key of Object.keys(external)) {
			const incoming = external[key];
			if (!isPlainObject(incoming)) continue;
			const prev = store[key];
			if (!isPlainObject(prev)) {
				const fresh = { ...incoming };
				setKey(fresh, "updatedAt", nowSec());
				setKey(store, key, fresh);
				continue;
			}
			for (const field of Object.keys(incoming)) {
				if (prev[field] === undefined && incoming[field] !== undefined) setKey(prev, field, incoming[field]);
			}
			setKey(prev, "updatedAt", nowSec());
		}
	});
}

/**
 * 静默清理 pending 态: codeVerifier/oauthState 存在但 updatedAt 早于
 * now - maxAgeMs 的条目, 清掉这两个字段。没有 pending 态的条不动;
 * updatedAt 缺失按陈旧处理。
 */
function purgeStalePending(filePath, maxAgeMs) {
	const window = Number(maxAgeMs);
	const maxAge = Number.isFinite(window) && window > 0 ? window : 0;
	const cutoffSec = Math.floor(Date.now() / 1000) - Math.floor(maxAge / 1000);
	mutateStore(filePath, (store) => {
		for (const key of Object.keys(store)) {
			const entry = store[key];
			if (!isPlainObject(entry)) continue;
			if (entry.codeVerifier === undefined && entry.oauthState === undefined) continue;
			// 判据是 pendingAt(授权流程开始时间,只由 setCodeVerifier/setOAuthState 打),
			// 不是 updatedAt —— 否则普通 setEntry 会不断刷新时间戳,pending 永远清不掉。
			// 缺 pendingAt 的(opencode 既有条目)按 pending 处理并立即清除。
			const stamped = Number(entry.pendingAt);
			const pendingAt = Number.isFinite(stamped) && stamped > 0 ? stamped : 0;
			if (pendingAt < cutoffSec) {
				deleteKey(entry, "codeVerifier");
				deleteKey(entry, "oauthState");
				deleteKey(entry, "pendingAt");
			}
		}
	});
}

const __internals = {
	authStorePath, loadAuthStore, saveAuthStore,
	getEntry, getEntryForUrl, setEntry, removeEntry, listEntries,
	getClientInfo, setClientInfo, getTokens, setTokens, clearTokens,
	getCodeVerifier, setCodeVerifier, getOAuthState, setOAuthState, clearOAuthState,
	mergeExternalStore, purgeStalePending
};

export {
	authStorePath, loadAuthStore, saveAuthStore,
	getEntry, getEntryForUrl, setEntry, removeEntry, listEntries,
	getClientInfo, setClientInfo, getTokens, setTokens, clearTokens,
	getCodeVerifier, setCodeVerifier, getOAuthState, setOAuthState, clearOAuthState,
	mergeExternalStore, purgeStalePending,
	__internals
};
