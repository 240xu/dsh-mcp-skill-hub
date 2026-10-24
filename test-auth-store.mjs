/**
 * auth-store 单测。
 *
 * 铁律 5(写坏即 P0): 损坏/异常输入一律不抛错, 只抢救。
 * 铁律 4(跨组件验证): 用真实 opencode ~/.local/share/opencode/mcp-auth.json
 * 的结构做 mergeExternalStore oracle(只读, 不改)。
 * 铁律 9(测试留盲区档案): 每条关键行为至少一个会挂在上面的用例。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readdirSync, statSync, existsSync, readFileSync, chmodSync, copyFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { __internals as A } from "./lib/auth-store.js";

const OPENCODE_AUTH = join(homedir(), ".local", "share", "opencode", "mcp-auth.json");
const SECRET = "SUPER_SECRET_VALUE";

let dirs = [];
function sandbox() {
	const dir = mkdtempSync(join("/data/data/com.termux/files/usr/tmp/opencode", "auth-store-"));
	dirs.push(dir);
	return join(dir, "mcp-auth.json");
}
function tmpFiles(p) {
	const dir = join(p, "..");
	return readdirSync(dir).filter((f) => f !== "mcp-auth.json");
}
const sampleEntry = (over = {}) => ({
	serverUrl: "https://mcp.example.com/mcp",
	clientInfo: { clientId: "cid-1", clientIdIssuedAt: 1786151616 },
	tokens: { accessToken: "at-1", refreshToken: "rt-1", expiresAt: 1786155000, scope: "read" },
	codeVerifier: "v".repeat(43),
	oauthState: "s".repeat(64),
	updatedAt: Math.floor(Date.now() / 1000),
	...over
});

test("authStorePath 指向 ~/.dsh/mcp-auth.json", () => {
	assert.equal(A.authStorePath(), join(process.env.HOME, ".dsh", "mcp-auth.json"));
});

test("loadAuthStore 文件不存在 → {} 不抛错", () => {
	const p = sandbox();
	assert.deepEqual(A.loadAuthStore(p), {});
});

test("loadAuthStore 空文件/空白/null/[]/字符串 → {}", () => {
	for (const body of ["", "   \n\t ", "null", "[]", '"string"', "42"]) {
		const p = sandbox();
		writeFileSync(p, body);
		assert.deepEqual(A.loadAuthStore(p), {}, `body=${JSON.stringify(body)}`);
	}
});

test("JSON 损坏(截断) → {} 且原文件改名为 .corrupt-<ts>", () => {
	const p = sandbox();
	writeFileSync(p, '{"cloudflare":{"clientInfo":{"clientId":"abc"');
	assert.deepEqual(A.loadAuthStore(p), {});
	assert.equal(existsSync(p), false, "损坏文件应被移走");
	const kept = tmpFiles(p).filter((f) => /^mcp-auth\.json\.corrupt-\d+$/.test(f));
	assert.equal(kept.length, 1, "应保留 .corrupt-<ts> 抢救副本");
	// 抢救后新写盘能正常工作
	A.setEntry(p, "cloudflare", sampleEntry());
	const e = A.getEntry(p, "cloudflare");
	assert.equal(e.clientInfo.clientId, "cid-1");
});

test("setEntry 是合并语义: {a:1} 再 set {b:2} → {a:1,b:2}", () => {
	const p = sandbox();
	A.setEntry(p, "cf", { serverUrl: "https://x/mcp", clientInfo: { clientId: "c1" } });
	A.setEntry(p, "cf", { tokens: { accessToken: "at" } });
	const e = A.getEntry(p, "cf");
	assert.equal(e.serverUrl, "https://x/mcp");
	assert.deepEqual(e.clientInfo, { clientId: "c1" });
	assert.deepEqual(e.tokens, { accessToken: "at" });
	assert.equal(typeof e.updatedAt, "number");
});

test("setEntry 显式 undefined 清除字段", () => {
	const p = sandbox();
	A.setEntry(p, "cf", { serverUrl: "https://x/mcp", codeVerifier: "v".repeat(43) });
	A.setEntry(p, "cf", { codeVerifier: undefined });
	assert.equal(A.getEntry(p, "cf").codeVerifier, undefined);
	assert.equal(A.getEntry(p, "cf").serverUrl, "https://x/mcp");
});

test("removeEntry 存在 → true, 不存在 → false", () => {
	const p = sandbox();
	A.setEntry(p, "cf", sampleEntry());
	assert.equal(A.removeEntry(p, "cf"), true);
	assert.equal(A.removeEntry(p, "cf"), false);
	assert.deepEqual(A.loadAuthStore(p), {});
});

test("setTokens → getTokens roundtrip, expiresAt 保持 unix 秒", () => {
	const p = sandbox();
	const tokens = { accessToken: "at-x", refreshToken: "rt-x", expiresAt: 1786155000, scope: "s" };
	A.setTokens(p, "cf", tokens);
	const back = A.getTokens(p, "cf");
	assert.deepEqual(back, tokens);
	assert.equal(back.expiresAt, 1786155000);
	assert.ok(back.expiresAt < 1e11, "expiresAt 必须是 unix 秒不是毫秒");
});

test("clearTokens 后 getTokens → undefined", () => {
	const p = sandbox();
	A.setTokens(p, "cf", { accessToken: "at", refreshToken: "rt", expiresAt: 1786155000 });
	A.clearTokens(p, "cf");
	assert.equal(A.getTokens(p, "cf"), undefined);
	assert.equal(A.getEntry(p, "cf").serverUrl, undefined);
});

test("getEntryForUrl 三种 URL 形态等价", () => {
	const p = sandbox();
	A.setEntry(p, "cf", { serverUrl: "https://x.com/mcp" });
	for (const url of ["https://x.com/mcp", "https://x.com/mcp/", "https://x.com/mcp?a=1"]) {
		assert.ok(A.getEntryForUrl(p, "cf", url), url + " 应命中");
	}
});

test("getEntryForUrl URL 变更后 undefined(防串凭据)", () => {
	const p = sandbox();
	A.setEntry(p, "cf", { serverUrl: "https://x.com/mcp", tokens: { accessToken: SECRET } });
	assert.equal(A.getEntryForUrl(p, "cf", "https://evil.com/mcp"), undefined);
	assert.equal(A.getEntryForUrl(p, "cf", "https://x.com/other"), undefined);
	assert.equal(A.getEntryForUrl(p, "cf", "https://x.com"), undefined);
	assert.equal(A.getEntryForUrl(p, "cf", "not a url"), undefined);
});

test("saveAuthStore 后权限严格 0600", () => {
	const p = sandbox();
	A.saveAuthStore(p, { cf: sampleEntry() });
	assert.equal(statSync(p).mode & 0o777, 0o600);
});

test("原子写: save 后目录无 *.tmp* 残留", () => {
	const p = sandbox();
	A.saveAuthStore(p, { cf: sampleEntry() });
	A.setEntry(p, "cf", { oauthState: "s".repeat(64) });
	assert.deepEqual(tmpFiles(p), []);
});

test("并发语义: 连续 20 次 setEntry 不同字段全部在", () => {
	const p = sandbox();
	for (let i = 0; i < 20; i++) A.setEntry(p, "cf", { ["f" + i]: i });
	const e = A.getEntry(p, "cf");
	for (let i = 0; i < 20; i++) assert.equal(e["f" + i], i, "f" + i + " 丢失");
});

test("purgeStalePending: 过期的清, 未过期与无 pending 的不动", () => {
	const p = sandbox();
	const now = Math.floor(Date.now() / 1000);
	A.setEntry(p, "stale", { serverUrl: "https://x/mcp", codeVerifier: "v1", oauthState: "s1", pendingAt: now - 7200 });
	A.setEntry(p, "fresh", { serverUrl: "https://y/mcp", codeVerifier: "v2", oauthState: "s2", pendingAt: now });
	A.purgeStalePending(p, 3600 * 1000);
	const stale = A.getEntry(p, "stale");
	assert.equal(stale.codeVerifier, undefined);
	assert.equal(stale.oauthState, undefined);
	const fresh = A.getEntry(p, "fresh");
	assert.equal(fresh.codeVerifier, "v2");
	assert.equal(fresh.oauthState, "s2");
});

test("purgeStalePending: 无 pending 态的条不动且不写盘", () => {
	const p = sandbox();
	A.setEntry(p, "tokened", { serverUrl: "https://x/mcp", tokens: { accessToken: "at" } });
	const before = A.loadAuthStore(p).tokened;
	A.purgeStalePending(p, 1000);
	assert.deepEqual(A.getEntry(p, "tokened"), before);
});

// 回归: 经 setCodeVerifier/setOAuthState 正规创建的 pending 态必须可被 purge。
// 旧缺陷: purge 判据用 updatedAt, 而 setEntry 每次刷新 updatedAt → 正规创建的
// pending 时间戳永远是 now, 用户中途放弃授权后 pending 永久残留。
test("purgeStalePending: 正规 API 创建的 pending 可被 purge(判据是 pendingAt 非 updatedAt)", () => {
	const p = sandbox();
	A.setCodeVerifier(p, "cf", "v".repeat(43));
	A.setOAuthState(p, "cf", "s".repeat(64));
	const afterCreate = A.getEntry(p, "cf");
	assert.equal(afterCreate.codeVerifier, "v".repeat(43));
	assert.equal(afterCreate.oauthState, "s".repeat(64));
	assert.ok(Number.isFinite(afterCreate.pendingAt), "pendingAt 应被打上");
	// 把时间拨到 2 小时后
	const aged = A.loadAuthStore(p);
	aged.cf.pendingAt = Math.floor(Date.now() / 1000) - 7200;
	A.saveAuthStore(p, aged);
	A.purgeStalePending(p, 3600 * 1000);
	const e = A.getEntry(p, "cf");
	assert.equal(e.codeVerifier, undefined, "过期 pending 的 codeVerifier 应被清");
	assert.equal(e.oauthState, undefined, "过期 pending 的 oauthState 应被清");
	assert.equal(e.pendingAt, undefined, "pendingAt 应随清除一起移除");
});

test("purgeStalePending: 后续普通 setEntry 不刷新 pending 时间戳", () => {
	const p = sandbox();
	A.setCodeVerifier(p, "cf", "v".repeat(43));
	const created = A.getEntry(p, "cf").pendingAt;
	// 模拟授权中途又写了别的字段(如 clientInfo)
	A.setClientInfo(p, "cf", { clientId: "c1" });
	const after = A.getEntry(p, "cf");
	assert.equal(after.pendingAt, created, "pendingAt 不得被普通写入刷新");
	assert.ok(after.updatedAt >= created, "updatedAt 仍应被刷新");
});

test("purgeStalePending: 缺 pendingAt 的 legacy 条目按 pending 处理并清除", () => {
	const p = sandbox();
	A.setEntry(p, "legacy", { serverUrl: "https://x/mcp", codeVerifier: "v" });
	const store = A.loadAuthStore(p);
	delete store.legacy.pendingAt;
	A.saveAuthStore(p, store);
	A.purgeStalePending(p, 3600 * 1000);
	const e = A.getEntry(p, "legacy");
	assert.equal(e.codeVerifier, undefined, "无 pendingAt 的 pending 应被清(opencode 遗留)");
	assert.equal(e.serverUrl, "https://x/mcp", "serverUrl 等其他字段不受影响");
});

// P1 边界(用户阶段 3 回执追问): 有有效 tokens + 有过期 pending 的 entry。
// 用户重新授权中途放弃时, 只允许摘掉 pending 对, 绝不能删整条 —— 否则会丢
// 已授权 tokens, 用户被迫重新走一遍授权。断言 A 类行为(只清 pending 字段)。
test("P1 purgeStalePending: 有有效 tokens + 过期 pending → 只摘 pending, tokens/clientInfo 保留", () => {
	const p = sandbox();
	const nowS = Math.floor(Date.now() / 1000);
	A.setEntry(p, "cf", { serverUrl: "https://mcp.cloudflare.com/mcp" });
	A.setClientInfo(p, "cf", { clientId: "CID" });
	A.setTokens(p, "cf", { accessToken: "AT", refreshToken: "RT", expiresAt: nowS + 3600 });
	// 手工把 pendingAt 拨到 2 小时前, 模拟"授权发起了但中途放弃"且 tokens 仍有效
	const store = A.loadAuthStore(p);
	store.cf.pendingAt = nowS - 7200;
	store.cf.codeVerifier = "v".repeat(43);
	store.cf.oauthState = "s".repeat(64);
	A.saveAuthStore(p, store);
	A.purgeStalePending(p, 3600 * 1000);
	const e = A.getEntry(p, "cf", "https://mcp.cloudflare.com/mcp");
	assert.ok(e, "整条 entry 不得被删(条目不存在的后果是丢已授权 tokens)");
	assert.equal(e.codeVerifier, undefined, "过期 codeVerifier 应摘除");
	assert.equal(e.oauthState, undefined, "过期 oauthState 应摘除");
	assert.equal(e.pendingAt, undefined, "pendingAt 应摘除");
	assert.equal(e.tokens.accessToken, "AT", "有效 tokens 必须保留(A 类行为)");
	assert.equal(e.tokens.refreshToken, "RT", "refreshToken 必须保留");
	assert.equal(e.tokens.expiresAt, nowS + 3600, "expiresAt 不得被改写");
	assert.equal(e.clientInfo.clientId, "CID", "DCR clientId 必须保留");
	assert.equal(e.serverUrl, "https://mcp.cloudflare.com/mcp", "serverUrl 不得动");
});

test("getClientInfo/setCodeVerifier/getOAuthState 往返", () => {
	const p = sandbox();
	A.setClientInfo(p, "cf", { clientId: "c9", clientIdIssuedAt: 1786151616 });
	assert.deepEqual(A.getClientInfo(p, "cf"), { clientId: "c9", clientIdIssuedAt: 1786151616 });
	A.setCodeVerifier(p, "cf", "v".repeat(43));
	assert.equal(A.getCodeVerifier(p, "cf"), "v".repeat(43));
	A.setOAuthState(p, "cf", "s".repeat(64));
	assert.equal(A.getOAuthState(p, "cf"), "s".repeat(64));
	A.clearOAuthState(p, "cf");
	assert.equal(A.getCodeVerifier(p, "cf"), undefined);
	assert.equal(A.getOAuthState(p, "cf"), undefined);
	assert.equal(A.getClientInfo(p, "cf").clientId, "c9");
});

test("listEntries 返回 [{name, entry}]", () => {
	const p = sandbox();
	A.setEntry(p, "a", sampleEntry({ serverUrl: "https://a/mcp" }));
	A.setEntry(p, "b", sampleEntry({ serverUrl: "https://b/mcp" }));
	const rows = A.listEntries(p);
	assert.equal(rows.length, 2);
	assert.deepEqual(rows.map((r) => r.name).sort(), ["a", "b"]);
	for (const r of rows) assert.ok(r.entry.serverUrl);
});

 test("opencode 互通: mergeExternalStore 并入真实结构数据", () => {
 	const external = {
 		cloudflare: {
 			serverUrl: "https://mcp.cloudflare.com/mcp",
 			clientInfo: { clientId: "UqYJUsYbd3hG6iPP", clientIdIssuedAt: 1786151616 },
 			codeVerifier: "dVg38Yx9_V_F-mD4MnVu5SmnhUa2yUXG92xYpsp0pHQ",
 			oauthState: "5df597a55cefc3b3b8ef90e15c061896e2f98005fb674d6e005e979d025ec1d5",
 			tokens: { accessToken: "op-at", refreshToken: "op-rt", expiresAt: 1786155000, scope: "profile" }
 		}
 	};
 	// 真实文件(若在)是**结构 oracle**, 不是值 oracle: opencode 会自行刷新
 	// clientId/token, 用写死的值断言必然随真实数据漂移而失败(2026-10-23 踩中)。
 	// 故真实数据只用来验证"字段齐全 + 形态正确", 具体值一律不断。
 	if (existsSync(OPENCODE_AUTH)) {
 		const real = JSON.parse(readFileSync(OPENCODE_AUTH, "utf8"));
 		for (const [name, entry] of Object.entries(real)) Object.assign(external[name], entry);
 	}
 	const p = sandbox();
 	A.mergeExternalStore(p, external);
 	const e = A.getEntry(p, "cloudflare");
 	// 结构断言(对 fixture 与真实数据都成立)
 	assert.equal(e.serverUrl, "https://mcp.cloudflare.com/mcp", "serverUrl 应保留");
 	assert.ok(e.clientInfo, "clientInfo 应存在");
 	assert.equal(typeof e.clientInfo.clientId, "string", "clientId 应为 string");
 	assert.ok(e.clientInfo.clientId.length > 0, "clientId 不应为空");
 	assert.ok(e.tokens, "tokens 应存在");
 	assert.equal(typeof e.tokens.accessToken, "string", "accessToken 应为 string");
 	// 值断言(仅 fixture 自带的固定部分, 真实数据不会覆盖这些键)
 	assert.deepEqual(e.codeVerifier, "dVg38Yx9_V_F-mD4MnVu5SmnhUa2yUXG92xYpsp0pHQ",
 		"codeVerifier 只有 fixture 提供, 应是固定值");
 });

test("opencode 互通: 同名 entry 已存在时 tokens 不被覆盖", () => {
	const p = sandbox();
	A.setTokens(p, "cloudflare", { accessToken: "mine-at", refreshToken: "mine-rt", expiresAt: 1786156000, scope: "read" });
	A.mergeExternalStore(p, {
		cloudflare: {
			serverUrl: "https://mcp.cloudflare.com/mcp",
			clientInfo: { clientId: "UqYJUsYbd3hG6iPP", clientIdIssuedAt: 1786151616 },
			tokens: { accessToken: "theirs-at", refreshToken: "theirs-rt", expiresAt: 1786155000 }
		}
	});
	const e = A.getEntry(p, "cloudflare");
	assert.equal(e.tokens.accessToken, "mine-at");
	assert.equal(e.serverUrl, "https://mcp.cloudflare.com/mcp");
});

test("secret 不外泄: 损坏文件 + 错误路径的事件里不含 token", () => {
	const p = sandbox();
	A.setTokens(p, "cf", { accessToken: SECRET, refreshToken: SECRET + "-rt", expiresAt: 1786155000 });
	// 只留 secret 的 JSON 部分, 让文件损坏(截断) → 触发 quarantine 警告
	const poisoned = '{"cf":{"tokens":{"accessToken":"' + SECRET + '"';
	writeFileSync(p, poisoned);
	const logged = [];
	const origError = console.error;
	console.error = (...args) => logged.push(args.join(" "));
	let message = "";
	try {
		A.loadAuthStore(p);
		A.setEntry(p, "cf", { serverUrl: "https://x/mcp" });
		A.setClientInfo(p, "cf", "not-an-object");
	} catch (error) {
		message = String(error && error.message);
	} finally {
		console.error = origError;
	}
	for (const text of [message, ...logged]) assert.ok(!text.includes(SECRET), "secret 泄漏: " + text);
	// 抢救后的新 store 里也没有旧 secret
	assert.ok(!readFileSync(p, "utf8").includes(SECRET));
});

test("目录权限过松(0755) → 警告但不阻断, 文件仍 0600", () => {
	const dir = mkdtempSync(join("/data/data/com.termux/files/usr/tmp/opencode", "auth-store-loose-"));
	dirs.push(dir);
	chmodSync(dir, 0o755);
	const p = join(dir, "mcp-auth.json");
	const logged = [];
	const origError = console.error;
	console.error = (...args) => logged.push(args.join(" "));
	let mode = 0;
	try {
		A.saveAuthStore(p, { cf: sampleEntry() });
		mode = statSync(p).mode & 0o777;
	} finally {
		console.error = origError;
		chmodSync(dir, 0o700);
	}
	assert.equal(mode, 0o600, "目录过松时文件仍必须 0600");
	assert.equal(logged.length, 1, "应有一次目录权限警告");
	assert.ok(!logged.join("").includes("cid-1"), "警告不得带 entry 内容");
});

test("目录权限 0700 → 无警告", () => {
	const dir = mkdtempSync(join("/data/data/com.termux/files/usr/tmp/opencode", "auth-store-ok-"));
	dirs.push(dir);
	const p = join(dir, "mcp-auth.json");
	const logged = [];
	const origError = console.error;
	console.error = (...args) => logged.push(args.join(" "));
	try {
		A.saveAuthStore(p, { cf: sampleEntry() });
	} finally {
		console.error = origError;
	}
	assert.equal(logged.length, 0, "0700 目录不应警告");
});

test("opencode 真实文件引用: 用其字节副本做 oracle", () => {
	const real = JSON.parse(readFileSync(OPENCODE_AUTH, "utf8"));
	assert.ok(Object.keys(real).length > 0, "opencode mcp-auth.json 应有条目, 否则本测试失去 oracle 意义");
	const p = sandbox();
	copyFileSync(OPENCODE_AUTH, p);
	const loaded = A.loadAuthStore(p);
	const name = Object.keys(real)[0];
	assert.deepEqual(loaded[name], real[name], "opencode 数据结构应原样读入");
	A.mergeExternalStore(sandbox(), real);
});

test("空目录创建: saveAuthStore 自动建父目录", () => {
	const dir = mkdtempSync(join("/data/data/com.termux/files/usr/tmp/opencode", "auth-store-mk-"));
	dirs.push(dir);
	const p = join(dir, "nested", "deeper", "mcp-auth.json");
	A.saveAuthStore(p, {});
	assert.equal(statSync(p).mode & 0o777, 0o600);
});

test("removeEntry 不存在时不创建文件", () => {
	const p = sandbox();
	assert.equal(A.removeEntry(p, "ghost"), false);
	assert.equal(existsSync(p), false);
});

test.after(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
	dirs = [];
});
