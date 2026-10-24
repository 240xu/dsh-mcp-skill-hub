import { __internals as X } from "./lib/index.js";
import { readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";

// oracle 用的真实 YAML 解析器(dsh 消费方同一实现, 见铁律 4)。
// 多路径探测: dsh 自带的 yaml 优先, 退回 opencode 的, 都找不到则用最小兜底
// (只在无真实解析器时降级, 会打印警告 —— 不得静默跳过校验)。
const YAML_CANDIDATES = [
  "/data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/yaml/dist/index.js",
  join(homedir(), ".config/opencode/node_modules/yaml/dist/index.js"),
];
let parseYaml = null;
for (const p of YAML_CANDIDATES) {
  if (existsSync(p)) {
    try { parseYaml = (await import(p)).parse; break; } catch { /* 试下一个 */ }
  }
}
if (!parseYaml) {
  // 兜底: 极简 YAML 子集解析(仅支持本测试用到的形态)。打印警告不静默。
  console.warn("⚠ 未找到真实 yaml 解析器, 降级为最小兜底(校验强度下降)");
  parseYaml = (text) => {
    const doc = [];
    let cur = null, curInsert = null, curCfg = null;
    for (const raw of text.split("\n")) {
      const line = raw.replace(/\s+#.*$/, "");
      if (!line.trim()) continue;
      const indent = line.length - line.trimStart().length;
      const body = line.trim();
      if (indent === 0 && body.startsWith("- ")) {
        const rest = body.slice(2);
        if (rest.startsWith("insert:")) { curInsert = []; doc.push({ insert: curInsert }); cur = null; }
        else if (/^id:\s*(\S+)/.test(rest)) { cur = { id: rest.slice(4).trim(), config: {} }; doc.push(cur); curInsert = null; }
        continue;
      }
      if (curInsert && /^- id:\s*(\S+)/.test(body)) {
        curCfg = { id: body.slice(5).trim(), config: {} }; curInsert.push(curCfg); continue;
      }
      if (curCfg && indent >= 4) {
        const m = /^([\w-]+):\s*(.*)$/.exec(body);
        if (m) curCfg.config[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
      }
    }
    return doc;
  };
}

const MCP = "@deepseek-ai/dsh-mcp-client";
const q = (s) => "'" + s + "'";
const TMP = new URL("./.test/patch.yml", import.meta.url).pathname;
// 确保 .test 目录存在(独立目录/新克隆里首次跑会缺)
mkdirSync(dirname(TMP), { recursive: true });

const sample = [
  "# 顶部注释,必须保留",
  "- id: some-other-row",
  '  name: "@deepseek-ai/dsh-web"',
  "  config:",
  "    a: 1",
  "# MCP servers migrated from OpenCode",
  "- insert:",
  "    - id: mcp-cf-docs",
  "      name: " + q(MCP),
  "      config:",
  "        serverName: cf-docs",
  "        transport: streamable-http",
  "        url: https://docs.mcp.cloudflare.com/mcp",
  "",
  "    # 行间注释,必须保留",
  "    - id: mcp-playwright",
  "      name: " + q(MCP),
  "      disabled: true",
  "      config:",
  "        serverName: playwright",
  "        transport: stdio",
  "        command: /usr/bin/node",
  "        env:",
  "          LD_PRELOAD: " + q(""),
  "        args:",
  "          [",
  "            --headless,",
  "            --no-sandbox,",
  "          ]",
  "",
  "    - id: mcp-ruflo",
  "      name: " + q(MCP),
  "      config:",
  "        serverName: ruflo",
  "        transport: stdio",
  "        command: node",
  "        args:",
  "          - /data/ruflo.js",
  "          - mcp",
  "          - start",
  ""
].join("\n");
writeFileSync(TMP, sample);
const lines0 = sample.split("\n");
const blocks = X.scanMcpBlocks(lines0);
console.log("blocks:", JSON.stringify(blocks.map(b => ({ id: b.id, start: b.start, end: b.end }))));
const r0 = X.parseBlockFields(lines0.slice(blocks[0].start, blocks[0].end));
const r1 = X.parseBlockFields(lines0.slice(blocks[1].start, blocks[1].end));
const r2 = X.parseBlockFields(lines0.slice(blocks[2].start, blocks[2].end));
if (r0.serverName !== "cf-docs" || r0.transport !== "streamable-http") throw new Error("r0 解析错误: " + JSON.stringify(r0));
if (r1.disabled !== true || r1.command !== "/usr/bin/node" || JSON.stringify(r1.args) !== JSON.stringify(["--headless","--no-sandbox"])) throw new Error("r1 解析错误: " + JSON.stringify(r1));
if (JSON.stringify(r2.args) !== JSON.stringify(["/data/ruflo.js","mcp","start"])) throw new Error("r2 解析错误: " + JSON.stringify(r2));
console.log("三种行形态解析 OK");

X.opToggleMcp(TMP, "mcp-playwright", true);
const after1 = readFileSync(TMP, "utf8");
if (after1.includes("disabled: true")) throw new Error("toggle 启用后仍有 disabled 行");
if (!after1.includes("# 行间注释,必须保留")) throw new Error("行间注释丢失!");
console.log("toggle→启用 OK,注释保留");

X.opToggleMcp(TMP, "mcp-playwright", false);
const after2 = readFileSync(TMP, "utf8");
if (!/mcp-playwright[\s\S]*?disabled: true/.test(after2)) throw new Error("禁用行未插入");

X.opUpsertMcp(TMP, null, { serverName: "new-srv", transport: "stdio", command: "uvx", args: ["mcp-server-fetch"], env: { API_KEY: "sk-test'123" } }, true);
const after3 = readFileSync(TMP, "utf8");
if (!after3.includes("mcp-new-srv")) throw new Error("新行未追加");
if (!after3.includes("'sk-test''123'")) throw new Error("单引号转义错误");
console.log("upsert 新行 OK");

X.opUpsertMcp(TMP, "mcp-cf-docs", { serverName: "cf-docs", transport: "streamable-http", url: "https://new.example.com/mcp", headers: { Authorization: "Bearer sk-x" } }, true);
const after4 = readFileSync(TMP, "utf8");
if (!after4.includes("https://new.example.com/mcp") || after4.includes("docs.mcp.cloudflare.com")) throw new Error("编辑未生效");
if (!after4.includes("# MCP servers migrated from OpenCode") || !after4.includes("# 顶部注释")) throw new Error("注释丢失!");
console.log("编辑既有行 OK,全部注释保留");

X.opDeleteMcp(TMP, "mcp-new-srv");
const after5 = readFileSync(TMP, "utf8");
if (after5.includes("mcp-new-srv")) throw new Error("删除失败");
console.log("删除行 OK");

const fm = X.parseFrontmatter("---\nname: my-skill\ndescription: \"描述: 带冒号\"\ndisable-model-invocation: true\n---\n\n# 正文\n内容");
if (fm.fields.name !== "my-skill" || fm.fields.disableModelInvocation !== true || fm.body !== "\n# 正文\n内容") throw new Error("frontmatter 解析错误: " + JSON.stringify(fm));
const built = X.buildSkillFile({ name: "my-skill", description: "描述: 带冒号", whenToUse: "当需要 x 时", content: "# T", modelInvocable: false, userInvocable: true });
if (!built.includes("disable-model-invocation: true") || built.includes("user-invocable")) throw new Error("buildSkillFile 错误");
console.log("frontmatter OK");

// ── YAML 标量安全:冒号空格与换行(曾致 patch 写坏 / 技能静默消失) ──
{
	const dangerous = ["Use for X: Y and Z", "bar: baz", "12: 30", "a: b", "Bearer abc: def", "charset: utf-8"];
	for (const d of dangerous) {
		const out = X.buildSkillFile({ name: "x", description: d, whenToUse: "", content: "body", modelInvocable: true, userInvocable: true });
		const block = out.match(/^---\r?\n([\s\S]*?)\r?\n---/)[1];
		const descLine = block.split("\n").find(l => l.startsWith("description:"));
		if (!/^description:\s*['"]/.test(descLine)) throw new Error("含 ': ' 的 description 未加引号(provider 将解析失败): " + descLine);
	}
	const nl = X.buildSkillFile({ name: "x", description: "a\nb", whenToUse: "", content: "body", modelInvocable: true, userInvocable: true });
	if (!/description:\s*"/.test(nl)) throw new Error("含换行的 description 应使用双引号转义");
	console.log("yamlScalar 冒号/换行安全 OK");
}
{
	// roundtrip: 值 → yamlScalar → unquote 必须无损
	const vals = ["bar: baz", "a\nb", "it's", "Bearer abc", "", "a\tb", "a\r\nb", "back\\slash", 'quote"inside', "a\\nb", "https://x/mcp?a=b:c&d=e", "x :y", "12: 30"];
	for (const v of vals) {
		const out = X.yamlScalar(v);
		const back = X.unquote(out.trim());
		if (back !== v) throw new Error("yamlScalar roundtrip 损坏: " + JSON.stringify(v) + " -> " + JSON.stringify(out) + " -> " + JSON.stringify(back));
	}
	console.log("yamlScalar roundtrip OK");
}
{
	// upsert 保留块内未知字段
	const f2 = TMP + ".extra.yml";
	writeFileSync(f2, [
		"- insert:",
		"  - id: mcp-a",
		"    name: '@deepseek-ai/dsh-mcp-client'",
		"    config:",
		"      serverName: a",
		"      transport: stdio",
		"      command: c",
		"      toolCallTimeoutMs: 120000  # 慢服务器",
		"      reconnect:",
		"        maxAttempts: 20",
		""
	].join("\n"));
	X.opUpsertMcp(f2, "mcp-a", { serverName: "a", transport: "stdio", command: "c", args: [], env: {}, headers: {}, cwd: "" }, true);
	const afterExtra = readFileSync(f2, "utf8");
	if (!afterExtra.includes("toolCallTimeoutMs: 120000")) throw new Error("编辑丢失 toolCallTimeoutMs");
	if (!afterExtra.includes("maxAttempts: 20")) throw new Error("编辑丢失 reconnect 嵌套");
	if (!afterExtra.includes("# 慢服务器")) throw new Error("编辑丢失块内注释");
	rmSync(f2);
	console.log("upsert 保留未知字段 OK");
}
{
	// 顶层(缩进0)MCP 行可被发现与编辑
	const f3 = TMP + ".top.yml";
	writeFileSync(f3, [
		"- id: approval",
		"  name: 'x'",
		"",
		"- id: mcp-top",
		"  name: '@deepseek-ai/dsh-mcp-client'",
		"  config:",
		"    serverName: top",
		"    transport: stdio",
		"    command: c",
		""
	].join("\n"));
	const tb = X.scanMcpBlocks(readFileSync(f3, "utf8").split("\n"));
	if (tb.length !== 1 || tb[0].id !== "mcp-top" || tb[0].indent !== 0) throw new Error("顶层 MCP 行扫描失败: " + JSON.stringify(tb));
	X.opUpsertMcp(f3, "mcp-top", { serverName: "top", transport: "stdio", command: "c2", args: [], env: {}, headers: {}, cwd: "" }, true);
	if (!readFileSync(f3, "utf8").includes("command: c2")) throw new Error("顶层行编辑失败");
	rmSync(f3);
	console.log("顶层 MCP 行 OK");
}
{
  // 技能名 kebab-case 校验与 provider 对齐
  const prov = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  for (const n of ["my-skill", "a", "a1-b2"]) if (!prov.test(n)) throw new Error("校验过严: " + n);
  for (const n of ["my--skill", "my-", "My-Skill"]) if (prov.test(n)) throw new Error("校验过宽: " + n);
  console.log("技能名 kebab-case 校验 OK");
}

// ── P0/P1 修复: MCP 新行插入点 / insert 缩进探测 / extraLines 缩进重定位 ──
// oracle 一律用真实 YAML 解析器(yaml@2.x,dsh 消费方同一实现),见铁律 4。
const SANDBOX = join(dirname(TMP), "mcp-insert");
mkdirSync(SANDBOX, { recursive: true });
const fresh = { serverName: "fresh", transport: "stdio", command: "uvx", args: [], env: {}, headers: {}, cwd: "" };
const ROW = (id, name, indent = 4) => [
  " ".repeat(indent) + "- id: " + id,
  " ".repeat(indent + 2) + "name: '" + name + "'",
  " ".repeat(indent + 2) + "config:",
  " ".repeat(indent + 4) + "serverName: " + id.replace(/^mcp-/, ""),
  " ".repeat(indent + 4) + "transport: stdio",
  " ".repeat(indent + 4) + "command: c",
];
const writeCase = (file, lines) => {
  const p = join(SANDBOX, file);
  writeFileSync(p, lines.join("\n") + "\n");
  return p;
};
const readLines = (p) => readFileSync(p, "utf8").split("\n");
const mustParse = (p) => {
  let doc;
  try { doc = parseYaml(readFileSync(p, "utf8")); }
  catch (e) { throw new Error("产出无法被真实 YAML 解析器解析: " + e.message.split("\n")[0]); }
  return doc;
};
const findInsertRow = (doc, id) => {
  for (const top of (Array.isArray(doc) ? doc : [])) {
    for (const row of (top?.insert || [])) if (row?.id === id) return row;
  }
  return null;
};
const lineOf = (p, needle) => {
  const i = readLines(p).findIndex((l) => l.includes(needle));
  if (i < 0) throw new Error("文件中找不到 " + needle);
  return readLines(p)[i];
};
const fixCase = (name, fn) => {
  try { fn(); console.log("修复用例 OK: " + name); }
  catch (e) { console.log("修复用例失败: " + name + " → " + e.message); throw e; }
};

fixCase("A-P0 顶层 MCP 行后有顶层 item 时,新行进 insert 段(不再落到顶层 item 区)", () => {
  const p = writeCase("a-top-then-top.yml", [
    "- id: approval",
    "  name: 'x'",
    "",
    "- id: mcp-top",
    "  name: '" + MCP + "'",
    "  config:",
    "    serverName: top",
    "    transport: stdio",
    "    command: c",
    "",
    "# 顶层注释,必须保留",
    "- id: attachment-local",
    "  name: 'y'",
    ""
  ]);
  const id = X.opUpsertMcp(p, null, fresh, true);
  const doc = mustParse(p);
  const row = findInsertRow(doc, id);
  if (!row || row.config.serverName !== "fresh") throw new Error("新行不在 insert 段内: " + JSON.stringify(doc).slice(0, 200));
  const newLine = lineOf(p, id);
  if (/^- \.?id: mcp-fresh/.test(newLine) || /^ {0,3}- id: mcp-fresh/.test(newLine))
    throw new Error("新行落在顶层/缩进不足的 item 区: " + JSON.stringify(newLine));
  if (!readFileSync(p, "utf8").includes("- id: attachment-local")) throw new Error("顶层 item 丢失");
  if (!readFileSync(p, "utf8").includes("# 顶层注释,必须保留")) throw new Error("注释丢失");
});

fixCase("A-P0 last.end 之后只有空行/注释时,仍原地追加", () => {
  const p = writeCase("a-trailing-only.yml", [
    "- insert:",
    "    - id: mcp-a",
    "      name: '" + MCP + "'",
    "      config:",
    "        serverName: a",
    "        transport: stdio",
    "        command: c",
    "",
    "# 尾部注释",
    ""
  ]);
  X.opUpsertMcp(p, null, fresh, true);
  const doc = mustParse(p);
  if (!findInsertRow(doc, "mcp-fresh")) throw new Error("新行未落在 insert 段内: " + JSON.stringify(doc).slice(0, 200));
  if (!readFileSync(p, "utf8").includes("# 尾部注释")) throw new Error("尾部注释丢失");
});

fixCase("B-P1 文档是 [] 时新建,移除 [] 且 insert 段正确", () => {
  const p = writeCase("b-empty-seq.yml", ["[]", ""]);
  X.opUpsertMcp(p, null, fresh, true);
  if (/^\s*\[\s*\]\s*$/m.test(readFileSync(p, "utf8"))) throw new Error("[] 残留未清除");
  const doc = mustParse(p);
  const row = findInsertRow(doc, "mcp-fresh");
  if (!row || row.config.serverName !== "fresh") throw new Error("insert 段不对: " + JSON.stringify(doc));
});

fixCase("B-P1 文档是「注释 + []」时新建,注释保留且可解析", () => {
  const p = writeCase("b-comment-empty-seq.yml", ["# dsh 新装默认模板", "[]", ""]);
  X.opUpsertMcp(p, null, fresh, true);
  if (!readFileSync(p, "utf8").includes("# dsh 新装默认模板")) throw new Error("注释丢失");
  const doc = mustParse(p);
  if (!findInsertRow(doc, "mcp-fresh")) throw new Error("insert 段不对: " + JSON.stringify(doc));
});

fixCase("B-P1 空文件新建可解析", () => {
  const p = writeCase("b-truly-empty.yml", [""]);
  X.opUpsertMcp(p, null, fresh, true);
  const doc = mustParse(p);
  if (!findInsertRow(doc, "mcp-fresh")) throw new Error("insert 段不对: " + JSON.stringify(doc));
});

fixCase("B-P1 探测函数: [] 与顶层内容判定", () => {
  if (X.detectTopLevelContentAfter(["- insert:", "", "  - id: x"], 1)) throw new Error("空行后判出顶层内容");
  if (!X.detectTopLevelContentAfter(["- insert:", "", "# c", "- id: y"], 1)) throw new Error("漏判顶层 item");
  if (!X.detectTopLevelContentAfter(["- insert:", "", "- id: y"], 1)) throw new Error("漏判顶层 item(无空行)");
});

fixCase("C-P1 insert 段是 2 空格时,新行 indent === 2", () => {
  const p = writeCase("c-insert-2.yml", ["- insert:", ...ROW("mcp-a", MCP, 2), ""]);
  X.opUpsertMcp(p, null, fresh, true);
  const l = lineOf(p, "mcp-fresh");
  if (!/^ {2}- id: mcp-fresh/.test(l)) throw new Error("新行缩进不是 2: " + JSON.stringify(l));
  mustParse(p);
});

fixCase("C-P1 insert 段是 4 空格时,新行 indent === 4", () => {
  const p = writeCase("c-insert-4.yml", ["- insert:", ...ROW("mcp-a", MCP, 4), ""]);
  X.opUpsertMcp(p, null, fresh, true);
  const l = lineOf(p, "mcp-fresh");
  if (!/^ {4}- id: mcp-fresh/.test(l)) throw new Error("新行缩进不是 4: " + JSON.stringify(l));
  mustParse(p);
});

fixCase("C-P1 混合缩进(insert 2 + insert 4)→ 跟随最后一个(4)", () => {
  const p = writeCase("c-mixed.yml", [
    "- insert:",
    ...ROW("mcp-a", MCP, 2),
    "",
    "- insert:",
    ...ROW("mcp-b", MCP, 4),
    ""
  ]);
  X.opUpsertMcp(p, null, fresh, true);
  const l = lineOf(p, "mcp-fresh");
  if (!/^ {4}- id: mcp-fresh/.test(l)) throw new Error("未跟随最后一个 insert 段(4): " + JSON.stringify(l));
  mustParse(p);
});

fixCase("C-P1 混合缩进(insert 4 + insert 2)→ 跟随最后一个(2)", () => {
  const p = writeCase("c-mixed-rev.yml", [
    "- insert:",
    ...ROW("mcp-a", MCP, 4),
    "",
    "- insert:",
    ...ROW("mcp-b", MCP, 2),
    ""
  ]);
  X.opUpsertMcp(p, null, fresh, true);
  const l = lineOf(p, "mcp-fresh");
  if (!/^ {2}- id: mcp-fresh/.test(l)) throw new Error("未跟随最后一个 insert 段(2): " + JSON.stringify(l));
  mustParse(p);
});

fixCase("C-P1 detectInsertIndent 契约(导出供测试)", () => {
  const l4 = ["- insert:", ...ROW("mcp-a", MCP, 4)];
  if (X.detectInsertIndent(l4, X.scanMcpBlocks(l4)) !== 4) throw new Error("4 空格 insert 段应返回 4");
  const l2 = ["- insert:", ...ROW("mcp-a", MCP, 2)];
  if (X.detectInsertIndent(l2, X.scanMcpBlocks(l2)) !== 2) throw new Error("2 空格 insert 段应返回 2");
  if (X.detectInsertIndent([], []) !== 4) throw new Error("无块时应回退 4(dsh bundle 样式)");
  const mode = ["- insert:", ...ROW("mcp-a", MCP, 2), "", "- insert:", ...ROW("mcp-b", MCP, 2)];
  if (X.detectInsertIndent(mode, X.scanMcpBlocks(mode)) !== 2) throw new Error("众数并列时应取较大者");
});

// 回归:insert 段内新建后又出现顶层 MCP 行时,新行不得落到顶层 item 区(曾致 patch 无法解析)
fixCase("A-P0 insert 段 + 顶层 MCP 行 → 新行仍进 insert 段(不落顶层 item 区)", () => {
  const p = writeCase("a-insert-then-top.yml", [
    "- insert:",
    ...ROW("mcp-a", MCP, 4),
    "",
    ...ROW("mcp-top", MCP, 0),
    ""
  ]);
  X.opUpsertMcp(p, null, fresh, true);
  mustParse(p);
  const blk = X.scanMcpBlocks(readFileSync(p, "utf8").split("\n")).find((b) => b.id === "mcp-fresh");
  if (!blk || blk.indent !== 4) throw new Error("新行未落在 insert 段内(indent 4): " + JSON.stringify(blk));
});

fixCase("C-P1 extraLines 跨缩进: 4 空格源块 → 2 空格目标不炸且值不丢", () => {
  const p = writeCase("c-extra-cross.yml", [
    "- insert:",
    ...ROW("mcp-a", MCP, 4).slice(0, 4),
    "        toolCallTimeoutMs: 120000",
    "        reconnect:",
    "          maxAttempts: 20",
    ""
  ]);
  X.opUpsertMcp(p, "mcp-a", { serverName: "a", transport: "stdio", command: "c2", args: [], env: {}, headers: {}, cwd: "" }, true);
  const doc = mustParse(p);
  const row = findInsertRow(doc, "mcp-a");
  if (!row) throw new Error("块丢失");
  if (row.config.toolCallTimeoutMs !== 120000) throw new Error("toolCallTimeoutMs 丢失/错位: " + JSON.stringify(row.config));
  if (row.config.command !== "c2") throw new Error("command 未更新");
  if (row.config.transport !== "stdio") throw new Error("transport 丢失");
  if (doc[0].insert.length !== 1) throw new Error("行数量变化: " + JSON.stringify(doc).slice(0, 160));
});

fixCase("C-P1 extraLines 跨缩进: 2 空格源块 → 4 空格目标不炸且值不丢", () => {
  const p = writeCase("c-extra-cross-rev.yml", [
    "- insert:",
    "  - id: mcp-a",
    "    name: '" + MCP + "'",
    "    config:",
    "      serverName: a",
    "      transport: stdio",
    "      command: c",
    "      toolCallTimeoutMs: 9000  # 慢服务器",
    "      reconnect:",
    "        maxAttempts: 3",
    "      # 块尾注释",
    ""
  ]);
  X.opUpsertMcp(p, "mcp-a", { serverName: "a", transport: "stdio", command: "c2", args: [], env: {}, headers: {}, cwd: "" }, true);
  const doc = mustParse(p);
  const row = findInsertRow(doc, "mcp-a");
  if (!row) throw new Error("块丢失");
  if (row.config.toolCallTimeoutMs !== 9000) throw new Error("toolCallTimeoutMs 丢失/错位: " + JSON.stringify(row.config));
  if (row.config.reconnect?.maxAttempts !== 3) throw new Error("reconnect 嵌套丢失: " + JSON.stringify(row.config));
  const txt = readFileSync(p, "utf8");
  if (!txt.includes("# 慢服务器")) throw new Error("行内注释丢失");
  if (!txt.includes("# 块尾注释")) throw new Error("块尾注释丢失");
});

fixCase("C-P1 原地编辑(indent 不变)时 extraLines 与注释零位移", () => {
  const p = writeCase("c-extra-same.yml", [
    "- insert:",
    "    - id: mcp-a",
    "      name: '" + MCP + "'",
    "      config:",
    "        serverName: a",
    "        transport: stdio",
    "        command: c",
    "        toolCallTimeoutMs: 120000",
    "        # 块尾注释",
    ""
  ]);
  const norm = (t) => t.replace(/\n+$/, "");
  const before = norm(readFileSync(p, "utf8"));
  X.opUpsertMcp(p, "mcp-a", { serverName: "a", transport: "stdio", command: "c", args: [], env: {}, headers: {}, cwd: "" }, true);
  const after = norm(readFileSync(p, "utf8"));
  if (before !== after) throw new Error("原地重建应内容不变(未知字段/注释不可漂移):\n--- before ---\n" + before + "\n--- after ---\n" + after);
  mustParse(p);
});

fixCase("C-P1 relocateExtraLines 契约(导出供测试)", () => {
  const src = ["        toolCallTimeoutMs: 1", "        # c", "          max: 2"];
  const moved = X.relocateExtraLines(src, 8, 6);
  if (moved[0] !== "      toolCallTimeoutMs: 1") throw new Error("平移不正确: " + JSON.stringify(moved[0]));
  if (moved[1] !== "      # c") throw new Error("注释未同样平移: " + JSON.stringify(moved[1]));
  if (moved[2] !== "        max: 2") throw new Error("嵌套相对缩进未保持: " + JSON.stringify(moved[2]));
  if (X.relocateExtraLines(src, -1, 6) !== src) throw new Error("srcBase 不可靠时应原样返回");
});

try {
  const real = readFileSync(join(homedir(), ".dsh/profiles/web/cordis.patch.yml"), "utf8");
  const realLines = real.split("\n");
  const rb = X.scanMcpBlocks(realLines);
  console.log("真实文件 mcp 行:", rb.map(b => b.id).join(", "));
  for (const b of rb) {
    const f = X.parseBlockFields(realLines.slice(b.start, b.end));
    const strict = !!(f.serverName && f.transport);
    console.log("  ", b.id, "→", strict ? (f.serverName + " / " + f.transport + (f.disabled ? " / disabled" : "") + " / args:" + f.args.length + " env:" + Object.keys(f.env).length) : "⚠ 无法严格解析 " + JSON.stringify(f).slice(0, 140));
  }
  console.log("真实文件解析完成,共", rb.length, "行");
} catch (e) { console.log("真实文件读取异常:", e.message); }
console.log("\n全部单测通过 ✅");
