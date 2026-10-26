/**
 * 离线路由级测试:用假 ctx 驱动 host 半的全部路由,验证围栏、方法、校验、
 * JSON 响应与写盘行为(全部在 .test/ 沙箱内,不碰真实 profile)。
 */
import { apply } from "./lib/index.js";
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("./.test/", import.meta.url).pathname;
const SANDBOX = join(ROOT, "sandbox");
rmSync(SANDBOX, { recursive: true, force: true });
mkdirSync(join(SANDBOX, "skills"), { recursive: true });
const PATCH = join(SANDBOX, "cordis.patch.yml");

const MCP = "@deepseek-ai/dsh-mcp-client";
writeFileSync(PATCH, [
  "# 用户注释,必须保留",
  "- insert:",
  "    - id: mcp-demo",
  "      name: '" + MCP + "'",
  "      config:",
  "        serverName: demo",
  "        transport: streamable-http",
  "        url: https://demo.example.com/mcp",
  "        headers:",
  "          Authorization: Bearer real-secret-123",
  "    - id: mcp-local",
  "      name: '" + MCP + "'",
  "      disabled: true",
  "      config:",
  "        serverName: local",
  "        transport: stdio",
  "        command: /bin/echo",
  "        args:",
  "          - hello",
  "",
].join("\n"));

// ---------- 假 ctx ----------
const routes = [];
const skillRoot = join(SANDBOX, "skills");
const demoSkillDir = join(skillRoot, "demo-skill");
mkdirSync(demoSkillDir, { recursive: true });
writeFileSync(join(demoSkillDir, "SKILL.md"), "---\nname: demo-skill\ndescription: 沙箱技能\n---\n\n正文\n");
const bundledDir = join(SANDBOX, "bundled", "builtin-skill");
mkdirSync(bundledDir, { recursive: true });
writeFileSync(join(bundledDir, "SKILL.md"), "---\nname: builtin-skill\ndescription: 内建只读\n---\n\nbody\n");

const ctx = {
  logger: { info: () => {}, warn: () => {} },
  effect: (fn) => { const d = fn(); return d; },
  get: (name) => {
    if (name === "loader") return { entries: () => [{ options: { id: "mcp-demo" }, fiber: {} }] };
    if (name === "sessions") return { list: () => [] };
    if (name === "hmr") return undefined;           // 模拟未启用 hmr → restart-required
    if (name === "pluginManager") return undefined;
    return undefined;
  },
  webServer: { register: (r) => { routes.push(r); return () => {}; } },
  skills: {
    list: async () => [
      { name: "demo-skill", description: "沙箱技能", path: join(demoSkillDir, "SKILL.md"), source: "user", provider: "filesystem", invocation: { modelInvocable: true, userInvocable: true } },
      { name: "builtin-skill", description: "内建只读", path: join(bundledDir, "SKILL.md"), source: "bundled", provider: "filesystem", invocation: { modelInvocable: true } },
    ],
  },
};
apply(ctx, { dshHome: SANDBOX, agentsHome: join(SANDBOX, "agents"), profileDir: SANDBOX, patchPath: PATCH });
console.log("注册路由:", routes.length, "条 →", routes.map((r) => r.path.replace("/api/dsh-mcp-skill-hub", "")).join(" "));

// ---------- 假 req/res ----------
function makeReq(method, url, { body, remoteAddress = "127.0.0.1" } = {}) {
  const listeners = {};
  const req = {
    method, url, socket: { remoteAddress },
    on(ev, fn) { (listeners[ev] ||= []).push(fn); return req; },
    destroy() {},
  };
  setTimeout(() => {
    if (body !== undefined) (listeners.data || []).forEach((f) => f(Buffer.from(JSON.stringify(body))));
    (listeners.end || []).forEach((f) => f());
  }, 0);
  return req;
}
function makeRes() {
  const res = { statusCode: 0, headers: null, body: "", headersSent: false,
    writeHead(s, h) { this.statusCode = s; this.headers = h; this.headersSent = true; },
    end(b) { this.body = b || ""; } };
  return res;
}
async function call(path, method = "GET", body, opts) {
  const route = routes.find((r) => r.path === "/api/dsh-mcp-skill-hub" + path);
  if (!route) throw new Error("no route " + path);
  const res = makeRes();
  await route.handler(makeReq(method, "/api/dsh-mcp-skill-hub" + path, { body, ...opts }), res);
  let json = null;
  try { json = JSON.parse(res.body); } catch {}
  return { status: res.statusCode, json, raw: res.body };
}
const assert = (cond, msg) => { if (!cond) throw new Error("断言失败: " + msg); };

// ---------- 1. 围栏 ----------
let r = await call("/state", "GET", undefined, { remoteAddress: "192.168.1.9" });
assert(r.status === 403, "非 loopback 应 403,得到 " + r.status);
console.log("① 围栏 403(非 loopback)OK");

// ---------- 2. 方法限制 ----------
r = await call("/state", "POST");
assert(r.status === 405, "方法不符应 405,得到 " + r.status);
console.log("② 方法 405 OK");

// ---------- 3. GET /state ----------
r = await call("/state");
assert(r.status === 200, "state 应 200,得到 " + r.status + " " + r.raw);
assert(r.json.mcp.length === 2, "应有 2 个 MCP 行,得到 " + r.json.mcp.length);
assert(r.json.hmr === false, "hmr 应为 false");
const demo = r.json.mcp.find((x) => x.id === "mcp-demo");
assert(demo.live === true, "mcp-demo 应 live(loader stub)");
assert(demo.config.headers.Authorization === "•••", "Authorization 应打码,得到 " + demo.config.headers.Authorization);
const local = r.json.mcp.find((x) => x.id === "mcp-local");
assert(local.enabled === false, "mcp-local 应禁用");
assert(r.json.skills.length === 2, "应有 2 个技能");
assert(r.json.skills.find((s) => s.name === "demo-skill").editable === true, "user 技能应可编辑");
assert(r.json.skills.find((s) => s.name === "builtin-skill").editable === false, "bundled 技能应只读");
console.log("③ /state OK:2 MCP 行(打码+live)/ 2 技能(可编辑性正确)");

// ---------- 4. 校验错误 ----------
r = await call("/mcp/upsert", "POST", { server: { serverName: "bad name!", transport: "streamable-http", url: "https://x.y" } });
assert(r.status === 400, "非法 serverName 应 400,得到 " + r.status);
r = await call("/mcp/upsert", "POST", { server: { serverName: "ok", transport: "http", url: "https://x.y" } });
assert(r.status === 400, "非法 transport 应 400,得到 " + r.status);
r = await call("/mcp/upsert", "POST", { server: { serverName: "ok", transport: "streamable-http", url: "ftp://x" } });
assert(r.status === 400, "非 http url 应 400,得到 " + r.status);
r = await call("/mcp/upsert", "POST", { server: { serverName: "demo", transport: "streamable-http", url: "https://x.y" } });
assert(r.status === 409, "重名 serverName 应 409,得到 " + r.status);
r = await call("/mcp/upsert", "POST", { id: "mcp-nope", server: { serverName: "nope", transport: "stdio", command: "x" } });
assert(r.status === 404, "不存在的 id 应 404,得到 " + r.status);
console.log("④ 校验 400/409/404 OK");

// ---------- 5. toggle(写盘 + restart-required)----------
r = await call("/mcp/toggle", "POST", { id: "mcp-local", enabled: true });
assert(r.status === 200 && r.json.applied === "restart-required", "toggle 应 200/restart-required,得到 " + JSON.stringify(r.json));
let txt = readFileSync(PATCH, "utf8");
assert(!/mcp-local[\s\S]*?disabled: true/.test(txt), "toggle 后不应再有 disabled");
assert(txt.includes("# 用户注释,必须保留"), "注释丢失!");
console.log("⑤ toggle 写盘 OK(applied=restart-required,注释保留)");

// ---------- 6. upsert 新建 + masked 哨兵保留原值 ----------
r = await call("/mcp/upsert", "POST", { server: { serverName: "fresh", transport: "stdio", command: "uvx", args: ["a", "b"], env: { K: "v" } }, enabled: true });
assert(r.status === 200 && r.json.id === "mcp-fresh", "新建失败 " + JSON.stringify(r.json));
txt = readFileSync(PATCH, "utf8");
assert(txt.includes("- id: mcp-fresh"), "新行未写入");
// 编辑 mcp-demo,Authorization 传打码哨兵 → 应保留真实值
r = await call("/mcp/upsert", "POST", { id: "mcp-demo", server: { serverName: "demo", transport: "streamable-http", url: "https://demo2.example.com/mcp", headers: { Authorization: "•••" } }, enabled: true });
assert(r.status === 200, "编辑失败 " + JSON.stringify(r.json));
txt = readFileSync(PATCH, "utf8");
assert(txt.includes("demo2.example.com"), "URL 未更新");
assert(txt.includes("Bearer real-secret-123"), "打码哨兵未回填真实值!");
console.log("⑥ upsert(新建 + 哨兵回填)OK");

// ---------- 7. delete ----------
r = await call("/mcp/delete", "POST", { id: "mcp-fresh" });
assert(r.status === 200 && !readFileSync(PATCH, "utf8").includes("mcp-fresh"), "删除失败");
console.log("⑦ delete OK");

// ---------- 8. 技能:创建 / 读 / 开关 / 更新 / 删除 ----------
r = await call("/skills/create", "POST", { name: "new-skill", scope: "user", description: "新建", whenToUse: "测试时", content: "# 标题\n内容" });
assert(r.status === 200, "创建失败 " + r.raw);
const newPath = r.json.path;
assert(existsSync(newPath), "文件未创建");
assert(readFileSync(newPath, "utf8").includes("whenToUse: '测试时'"), "frontmatter 未写入");

r = await call("/skills/toggle", "POST", { path: newPath, modelInvocable: false });
assert(r.status === 200, "开关失败 " + r.raw);
assert(readFileSync(newPath, "utf8").includes("disable-model-invocation: true"), "开关未生效");
console.log("⑧ 技能创建 + 模型可调用开关 OK");

// 只读来源拒绝
r = await call("/skills/toggle", "POST", { path: join(bundledDir, "SKILL.md"), modelInvocable: false });
assert(r.status === 403, "bundled 应 403,得到 " + r.status);
// 非白名单路径拒绝
r = await call("/skills/read", "GET");
assert(r.status === 400, "缺 path 应 400");
console.log("⑨ 只读来源 403 / 缺参 400 OK");

// 更新 + 删除(进 .trash)
r = await call("/skills/update", "POST", { path: newPath, description: "改过", whenToUse: "", content: "新正文" });
assert(r.status === 200, "更新失败 " + r.raw);
txt = readFileSync(newPath, "utf8");
assert(txt.includes("description: '改过'") && txt.includes("新正文"), "更新内容不对: " + txt.slice(0, 120));
assert(txt.includes("disable-model-invocation: true"), "更新不应丢失开关状态");
r = await call("/skills/delete", "POST", { path: newPath });
assert(r.status === 200 && r.json.trash.includes(".trash"), "删除失败 " + r.raw);
assert(!existsSync(newPath) && existsSync(r.json.trash), ".trash 迁移失败");
console.log("⑩ 技能更新 + 删除进 .trash OK");

console.log("\n路由级测试全部通过 ✅(沙箱:", SANDBOX + ")");
