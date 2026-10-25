# PROGRESS — dsh-mcp-skill-hub 工程执行记录

> 本项目宪法见 `PRINCIPLES.md`。本文件是第 10 条铁律「完工定义 = 独立验证」的文档落点：
> **每条记录必须含可复制的独立只读验证命令及真实输出**，「已验证」字样不构成证据。
> 各阶段用户回执附加的硬约束记录在对应阶段条目内。

---

## 阶段 0 — 准备（立宪法 / 备份恢复点 / OAuth 参考笔记）

**时间**：2026-10-20 15:54:57 CST（UTC+8）
**状态**：完成

### 交付物

| 交付物 | 路径 |
|---|---|
| 工程宪法（10 条铁律 + 第 9 条分级括注 + 第 10 条文档落点括注） | `PRINCIPLES.md`（36 行） |
| 全量备份脚本（纳入版本管理，阶段 1/2/4 复用） | `scripts/phase0-backup.sh`（3613 B，可执行） |
| 执行记录（本文件） | `PROGRESS.md` |
| OAuth 实现参考笔记（8 章，含施工图清单） | `oauth-reference.md`（464 行） |

### 备份恢复点

```
dest:      ~/.dsh/backups/hub-phase0-20261020-155457
hub-size:  230K
files:     17（SHA256SUMS 覆盖 17 个文件）
mjs:       4（脚本断言通过）
.test/:    52K，清单单独记录于 <dest>/.test-inventory.txt
```

备份为**真实现场快照**（含 `.test/` 夹具与 `.trash` 残留），未做任何清理（铁律 1、3）。
`.test-inventory.txt` 用于区分备份前后残留变化。

### dsh-src 锚点（底座 seam 改动前的比对基线）

```
HEAD:       47f943859bef60e4160492346772ded9b24f765a
dirty:      0 个未提交改动
```

> **阶段 3 前置检查（用户硬约束 - 补丁 2）**：改 dsh-src 前必须重跑
> `git -C ~/dsh-src rev-parse HEAD` 与 `git -C ~/dsh-src status --porcelain`，
> 与上值比对；不一致则停止并报告，不默认放行。

### 本期硬约束（用户阶段 0 回执）

- **补丁 1**：`diff -r` 覆盖整个备份目录而非仅 `lib/`；SHA256SUMS 全量生成并 `sha256sum -c` 校验。
- **补丁 2**：阶段 3 改 dsh-src 前重跑 git 状态并与阶段 0 记录值比对，不一致则停。
- **补丁 3**：`*.mjs` 拷贝前断言匹配数为 4，不等即停；备份流程脚本化并纳入版本管理，路径记录于此。
- `.test/` 裁决：**包含**（备份语义是回滚到真实现场，不是重建可跑环境）。

### 独立验证（4 条命令 + 真实输出）

**① PRINCIPLES.md 铁律条数与分级括注**

```bash
cd ~/dsh-plugins-src/dsh-mcp-skill-hub
grep -c "^| [0-9]" PRINCIPLES.md
grep -n "P0 / P1\|可复制的独立只读验证命令" PRINCIPLES.md
```

```
10
24:- **P0 / P1 bug**：修复必须附带一个会挂在该 bug 上的测试用例，**缺测试不算修完**。
29:`PROGRESS.md` 的每条记录必须包含一条**可复制的独立只读验证命令及其真实输出**；
```

判定：10 条铁律齐；第 9 条分级括注在 24 行；第 10 条文档落点括注在 29 行。✅

**② diff -r 全量比对（覆盖整个备份目录）**

```bash
diff -r ~/.dsh/backups/hub-phase0-20261020-155457 . \
  --exclude=node_modules --exclude=.git --exclude='*.log'
```

```
Only in /data/data/com.termux/files/home/.dsh/backups/hub-phase0-20261020-155457: .test-inventory.txt
Only in /data/data/com.termux/files/home/.dsh/backups/hub-phase0-20261020-155457: BACKUP-INFO.txt
Only in .: PRINCIPLES.md
Only in /data/data/com.termux/files/home/.dsh/backups/hub-phase0-20261020-155457: SHA256SUMS
```

判定：仅 4 项差异，全部符合预期——3 个为备份脚本生成的元数据文件
（`.test-inventory.txt` / `BACKUP-INFO.txt` / `SHA256SUMS`），1 个为备份完成后新建的
`PRINCIPLES.md`。源码、测试、配置、`.test/` 零差异。✅

**③ sha256sum -c 全量校验**

```bash
cd ~/.dsh/backups/hub-phase0-20261020-155457
sha256sum -c SHA256SUMS --quiet && echo "ALL PASS"
```

```
ALL PASS
文件总数: 17
```

判定：`--quiet` 模式无输出即全部通过；17 个文件全部校验一致。✅

**④ 锚点 / 脚本路径 / 参考笔记章节**

```bash
git -C ~/dsh-src rev-parse HEAD
git -C ~/dsh-src status --porcelain | wc -l
ls -la scripts/phase0-backup.sh
grep -c "^## " oauth-reference.md
```

```
47f943859bef60e4160492346772ded9b24f765a
0
-rwx------. 1 u0_a309 u0_a309 3613 Oct 20 15:54 scripts/phase0-backup.sh
8
```

判定：锚点 `47f9438…` 与上文记录一致；dsh-src 工作区干净（0 dirty）；脚本可执行；
参考笔记 8 章齐（§1 目的 / §2 SDK 契约 / §3 opencode 要点 / §4 Cloudflare 实证 /
§5 半成品 / §6 差异决策 / §7 施工图清单 / §8 待实测项）。✅

### 本期明确未做（边界记录）

- 未建 git stash（工作区干净无对象可建，以 commit hash `47f9438…` 作锚点）
- 未修改 dsh-src 任何文件（seam 改动属阶段 3）
- 未修改 `~/.dsh/profiles/web/cordis.patch.yml`
- 未重启 dsh 进程

### 阶段 1 开工前置

```bash
cd ~/dsh-plugins-src/dsh-mcp-skill-hub
./scripts/phase0-backup.sh phase1     # 复用同一脚本，PHASE 参数区分
```

---

## 阶段 1 — P0 bug 修复（插入点选择 / 缩进探测 / extraLines 重定位）

**时间**：2026-10-20 16:18 开工（备份）→ 16:55 完成
**状态**：完成
**执行**：子代理施工 + 主线独立验收（含一处子代理漏修的缺陷由主线补掉）

### 备份恢复点

```bash
cd ~/dsh-plugins-src/dsh-mcp-skill-hub
./scripts/phase0-backup.sh phase1
# → OK 备份完成: ~/.dsh/backups/hub-phase1-20261020-161844   242K / 22 文件 / 自校验通过
```

### 修复内容

| 缺陷 | 级别 | 修法 |
|---|---|---|
| A 新建行插入点错误（挂到顶层 item 区，patch 无法解析） | P0 | `detectTopLevelContentAfter` + `dropTrailingEmptySeq` + 分支条件收紧 |
| B `[]` / 注释+`[]` / 空文件上新建 → `[]` 与 list item 混排 | P0 | 同上，另剥离尾部空流序列 |
| C 硬编码 indent 4，2 空格 insert 段上追加落列表外 | P1 | 新增 `detectInsertIndent(lines, blocks)`：insert 段 indent 优先 → 众数（排除 0，并列取大）→ 回退 4 |
| D extraLines 布尔缩进判断，跨缩进写坏 YAML | P1 | `configContentBase` + `relocateExtraLines` 做整体缩进平移 |
| E **子代理漏修**：insert 段 + 顶层 MCP 行共存时，新行仍落到顶层 item 区 | P0 | 主线补：追加前提加 `last.indent > 0`；另加缩进一致性守卫，段风格不匹配时另起 insert 段 |

缺陷 E 由主线独立验收时发现（子代理 `detectTopLevelContentAfter` 只向后看，未判断追加点是否在 insert 列表内），验收脚本场景 7 复现，修复后用回归用例固定。

### 独立验证（铁律 10：附可复制命令与真实输出）

**① 语法 + 四测试全绿**

```bash
cd ~/dsh-plugins-src/dsh-mcp-skill-hub
node --check lib/index.js && node --check test.mjs && echo "SYNTAX OK"
node test.mjs 2>&1 | tail -2
node test-routes.mjs 2>&1 | tail -2
node test-yaml-safety.mjs 2>&1 | tail -2
node test-client-entry.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```

```
SYNTAX OK
全部单测通过 ✅
路由级测试全部通过 ✅(沙箱: .../.test/sandbox)
全部通过 ✅
ℹ pass 4
ℹ fail 0
```

**② 独立验收脚本（10 场景，真实 YAML oracle，不信任子代理回报）**

```bash
node /data/data/com.termux/files/usr/tmp/opencode/phase1-verify2.mjs
```

```
✅ 场景1 顶层item后新建: parse=true, 新行进insert段=true, 顶层条目=3(应3)
✅ 场景2 ["[]\n"]: parse=true, 新行存在=true
✅ 场景3 ["# comment\n[]\n"]: parse=true, 新行存在=true
✅ 场景4 [""]: parse=true, 新行存在=true
✅ 场景5 尾随注释: parse=true, insert行数=2(应2)
✅ 场景6 深嵌insert: parse=true
✅ 场景7 混合(insert4+顶层0): parse=true, 新行indent=4(应4,跟随insert段)
✅ 场景8 既有行编辑保未知字段: parse=true, toolCallTimeoutMs=120000, reconnect={"maxAttempts":20}
✅ 场景9 真实profile编辑: parse=true, 行数 8→8
✅ 场景10 真实profile探测indent=4(应4)
独立验收全部通过 ✅
```

**③ 改动面确认（只允许 lib/index.js + test.mjs）**

```bash
diff -rq ~/.dsh/backups/hub-phase1-20261020-161844 . \
  --exclude=node_modules --exclude=.git --exclude='*.log'
```

```
Files .../lib/index.js and ./lib/index.js differ
Files .../test.mjs and ./test.mjs differ
Only in ./.test: sandbox        ← 测试运行产生的临时沙箱，非源码
```

**④ 真实 profile 零写入 + dsh 在线**

```bash
md5sum ~/.dsh/profiles/web/cordis.patch.yml
curl -s -o /dev/null -w "state:%{http_code}\n" http://127.0.0.1:3080/api/dsh-mcp-skill-hub/state
```

```
01fdbb085992e58037c8ecad6ba68aaa  /data/data/com.termux/files/home/.dsh/profiles/web/cordis.patch.yml
state:200
```

md5 与阶段 1 开工前一致（子代理记录值同为 `01fdbb08…`）→ 全程只读副本验证，未写入真实 patch。

### 形态学结论（记录备用）

`- insert:` 下的列表项若缩进 0，YAML 会把它解析为顶层 patch 条目（`insert` 值为 null）——**该形态本身就是无效 patch**。dsh patch 顶层列表项在缩进 0，故官方 insert 段固定为 4 空格；`scanMcpBlocks` 支持 indent 0/2/4 属防御性扫描，不代表 0/2 是合规写入目标。

### 新增测试档案（铁律 9）

`test.mjs` 新增 16 个修复用例，其中最后一项为本阶段主线补缺陷 E 的回归：
`A-P0 insert 段 + 顶层 MCP 行 → 新行仍进 insert 段(不落顶层 item 区)`。

---

## 阶段 2 — 凭据层 auth-store（MCP OAuth 持久化）

**时间**：2026-10-20 17:15 开工（备份）→ 17:30 完成
**状态**：完成
**执行**：子代理施工 + 主线独立验收（16 场景真实 oracle）

### 备份恢复点

```bash
cd ~/dsh-plugins-src/dsh-mcp-skill-hub
./scripts/phase0-backup.sh phase2
# → OK 备份完成: ~/.dsh/backups/hub-phase2-20261020-171509   318K / 35 文件 / 自校验通过
```

### 交付物

| 文件 | 行数 | 内容 |
|---|---|---|
| `lib/auth-store.js` | 326 | 凭据持久化：按 `{[name]: entry}` 扁档，entry 含 serverUrl/clientInfo/tokens/codeVerifier/oauthState/updatedAt |
| `test-auth-store.mjs` | 325 | 26 个 node:test 用例 |

**关键设计**（已与用户确认）：
- 路径 `~/.dsh/mcp-auth.json`，权限**严格 0600**（先 chmod tmp 再 rename，规避窗口期明文可读）
- 索引键 = entry 内的 `serverUrl`，与 opencode 格式同构（生态互通）
- 原子写：同目录 tmp（pid+随机后缀）→ chmod 600 → rename
- 读-改-写带 re-read 合并，降低多实例丢更新
- 损坏文件**抢救**（改名 `.corrupt-<ts>`）而非销毁
- `setEntry` 为合并语义；`setEntry` 覆写 `updatedAt` 是防调用方伪造时间戳的有意设计
- 禁止 import `lib/index.js`（单向依赖）

### 独立验证（铁律 10）

**① 语法 + 测试全绿**

```bash
cd ~/dsh-plugins-src/dsh-mcp-skill-hub
node --check lib/auth-store.js && node --check test-auth-store.mjs && echo "SYNTAX OK"
node --test test-auth-store.mjs 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

```
SYNTAX OK
ℹ tests 26
ℹ pass 26
ℹ fail 0
```

**② 独立验收脚本（16 场景，含真实 opencode 文件做 oracle）**

```bash
node /data/data/com.termux/files/usr/tmp/opencode/phase2-verify.mjs
```

```
✅ A. 真实 opencode 文件 loadAuthStore 读入与原 JSON deepEqual: true
✅ A2. clientId/serverUrl 保真 (UqYJUsYbd3hG6iPP)
✅ B. 20 次写-读交错无半成品: 读出条目数序列 1,2,3,4,5,6...19,20
✅ B2. 最终 20 条全在 (实际 20)
✅ B3. 无 tmp 残留 (0 个)
✅ C. 同 entry 5 字段并发写合并保留: {"a":"a","updatedAt":...}
✅ D. secret 不出现在日志/错误信息中: leak=false
✅ E. 权限严格 0600 (实际 600)
✅ E2. 损坏文件被抢救保留 (1 个 .corrupt-*)
✅ F. 尾斜杠/query/fragment 三种形态等价命中
✅ F2. URL 改动后不串凭据
✅ G. purgeStalePending 只清过期: stale已清=true, fresh保留=true
✅ H. mergeExternalStore 并入真实 opencode entry (clientId 保真)
✅ H2. 已有 tokens 不被外部覆盖
阶段2独立验收全部通过 ✅
```

**③ 改动面确认（只新增 2 文件）**

```bash
diff -rq ~/.dsh/backups/hub-phase2-20261020-171509 . --exclude=node_modules --exclude=.git --exclude='*.log'
```

```
Only in ./lib: auth-store.js
Only in .: test-auth-store.mjs
(另有 .trash 下两个不同时间戳目录 = 测试运行产物，非源码)
```

**④ 现有四测试未被影响**

```
node test.mjs              → 全部单测通过 ✅
node test-routes.mjs       → 路由级测试全部通过 ✅
node test-yaml-safety.mjs  → 全部通过 ✅
node test-client-entry.mjs → pass 4 / fail 0
```

### 验收过程发现（已澄清，非缺陷）

初跑独立验收时 G 场景失败，定位为**我的夹具错**：`setEntry(target,'stale',{...updatedAt:1000})` 会被 `setEntry` 的 `updatedAt = nowSec()`（`lib/auth-store.js:183`）覆写，导致构造不出历史时间戳。改为直接 `writeFileSync` 构造后 16/16 通过。该覆写是防伪造时间戳的有意设计，保留。

### 与 opencode 的真实格式差异（实测结论）

- 结构完全同构，`loadAuthStore` 能原样读入真实文件（deepEqual 通过）
- opencode 无 `updatedAt` 字段 → 本模块的 `purgeStalePending` 对纯 opencode 文件会把所有带 pending 态的条目视为 `updatedAt=0`（过期）而清除。**这是已知的行为差异**：Hub 自己的条目都由 `setEntry` 打时间戳，仅当直接并入 opencode 的 pending 条目时会被清。可接受（pending 态本就该随授权完成而清除）。
- opencode 判定未授权的惯例是「tokens 缺失即未授权」，与 `getTokens → undefined` 一致，provider 层可直接复用该判据。

---

## 阶段 2 补证 + purgeStalePending 设计缺陷修复（用户回执三条追问）

**时间**：2026-10-20 17:35 → 17:50
**状态**：完成

### 追问 1&2：阶段 1 基线 + 五测试真实计数输出

阶段 1 的四测试真实输出（当时已具，此处补齐计数口径）：

```bash
cd ~/dsh-plugins-src/dsh-mcp-skill-hub
for f in test.mjs test-routes.mjs test-yaml-safety.mjs test-auth-store.mjs; do
  echo "--- $f ---"; node --test $f 2>&1 | grep -E "^ℹ (tests|pass|fail)" | tr '\n' ' '; echo
done
# 各文件内部用例数(自定义 runner 的真实断言数):
grep -c "^fixCase(" test.mjs        # → 16
grep -cE "console.log\(\"[①②③④⑤⑥⑦⑧⑨⑩]" test-routes.mjs   # → 10
node test-yaml-safety.mjs 2>&1 | grep -cE "✓|OK"            # → 12
```

phase2 追加 auth-store 后的五测试计数（注意：`node --test` 对自定义 runner 只算 1 个顶层 test，故附内部用例数）：

```
--- test.mjs ---            ℹ tests 1 ℹ pass 1 ℹ fail 0     (内部 fixCase 16 个)
--- test-routes.mjs ---     ℹ tests 1 ℹ pass 1 ℹ fail 0     (内部步骤 10 个)
--- test-yaml-safety.mjs --- ℹ tests 1 ℹ pass 1 ℹ fail 0     (内部检查 12 个)
--- test-auth-store.mjs --- ℹ tests 29 ℹ pass 29 ℹ fail 0   (node:test 原生 29 例)
```

各文件直接运行的尾部输出：

```bash
node test.mjs 2>&1 | tail -2              # 全部单测通过 ✅
node test-routes.mjs 2>&1 | tail -2       # 路由级测试全部通过 ✅(沙箱: .../.test/sandbox)
node test-yaml-safety.mjs 2>&1 | tail -2  # 全部通过 ✅
node test-client-entry.mjs 2>&1 | grep -E "^ℹ (pass|fail)"   # pass 4 / fail 0
```

### 追问 3：purgeStalePending 缺陷（用户判定为设计缺陷 —— 判定正确，已修）

**原缺陷**：purge 判据用 `updatedAt`，而 `setEntry` 每次都刷新 `updatedAt`，因此经 `setCodeVerifier`/`setOAuthState` 正规创建的 pending 态时间戳永远是 now，**永不过期**。用户在授权页中途放弃 → pending 永久残留在凭据文件里。

**修法**（3 处）：
1. 新增 `pendingAt` 字段，只由 `setCodeVerifier`/`setOAuthState` 打（授权流程开始时间），不被普通 `setEntry` 刷新
2. `purgeStalePending` 判据从 `updatedAt` 改为 `pendingAt`；缺 `pendingAt` 的 legacy 条目（opencode 遗留）按 pending 处理并清除；清除时连带移除 `pendingAt`
3. `setEntry` 显式传入 `updatedAt` 时不再覆写（供测试/迁移构造历史时间戳），默认仍自动打

**边界追问（用户阶段 3 回执第一节）**：有有效 tokens + 有过期 pending 的 entry，实际行为是
**A 类（只摘 pending，保留 tokens/clientInfo）**——正确，放行。P1 测试已挂：

```bash
node --test test-auth-store.mjs 2>&1 | grep -E "P1 purge|^ℹ (tests|pass|fail)"
```
```
✔ P1 purgeStalePending: 有有效 tokens + 过期 pending → 只摘 pending, tokens/clientInfo 保留
ℹ tests 30 / pass 30 / fail 0
```
（若为 B 类，用户重新授权中途放弃会丢已授权 tokens；断言 `tokens.accessToken === 'AT'` 锁死 A 类。）

---

## 阶段 3 前置回执：依赖生效路径裁决 + 3 项阻塞

**时间**：2026-10-20 19:00 → 19:20
**状态**：阻塞 4/5 + 阻塞 2 已解；阻塞 1 待用户在浏览器完成一次授权

### 一、purge 边界（回执第一节）

实际行为 = **A 类**。测试输出见上节。

### 二、依赖问题裁决（回执第二节）

**首选方案（pnpm install）未采用**，原因与裁决见下。

**生效路径回答（用户要求必答的问题）**：
> 「改动 ~/dsh-src 后，运行中的 dsh 如何加载新代码？link/dev 直载，还是 build 后生效？」

**答：都不能——两者都不加载。** 实证：
1. 安装版 `@deepseek-ai/dsh-mcp-client` 是**实体编译产物目录**（`ls -la` 确认非 symlink），
   dsh-src 的 `src/` 改动对它**零影响**。
2. 安装版 bundle 把 `createTransport` 内联为私有函数（`grep -n createTransport` → 仅 38 行定义 + 643 行调用，
   **不在 export 清单**），所以既不能 link 也不能 dev 直载。
3. 因此 dsh-src 改动要生效必须 `build:lib` 重新打包并替换安装版目录。

**按用户回退路径决策：走黑盒对比**（不是"装不上"的被动回退，是主动选择——黑盒直接对生产 bundle 取证，
比 install 整个 workspace 更有针对性，且完全不动 dsh-src 与安装版）。

**黑盒方案**（`/data/data/com.termux/files/usr/tmp/opencode/blackbox/`）：
- 沙箱把生产 `node_modules` 193 个包**全部 symlink 直连**（解析向后走真实依赖），
  只有两个 `dsh-mcp-client` 变体是可写副本：`bb-baseline`（生产原样）与 `bb-treatment`（生产 + seam patch）
- 两份由**同一个真实 SDK**（安装版内置）构造 transport，比较 SDK 私有字段
  `_requestInit` / `_authProvider` / `_oauthProvider`
- **脱离源码文本断言**，满足用户底线要求

**黑盒零行为变化证据（真实生产 bundle baseline vs treatment）**：

```bash
node /data/data/com.termux/files/usr/tmp/opencode/blackbox/guard.mjs
```
```
✅ seam 形态: createTransport 内无 if/else(硬约束 2)
✅ ① 不传 authProvider → baseline 与 treatment 逐字节相同
     baseline : {"requestInit":{"headers":{"X-Test":"value","Authorization":"Bearer static-token"}},"authProvider":null,"oauthProvider":null}
     treatment: {"requestInit":{"headers":{"X-Test":"value","Authorization":"Bearer static-token"}},"authProvider":null,"oauthProvider":null}
✅ ② treatment 传 undefined 与不传等价
✅ ③ treatment 传入 provider 后 authProvider 非 null (非 null ✓)
✅ ④ baseline 的第二个参数被忽略(改动前不接受 provider) → authProvider=null ✓
✅ ⑤ treatment 带 provider 时 requestInit 仍与 baseline 不带 provider 一致(静态 headers 不丢)
pass 6 / fail 0
黑盒零行为变化证据成立 ✅  seam patch 可落地
```

注：此项满足用户第 4 条约束中"三层 guard 降级"的等价要求——黑盒对比独立证明零行为变化，
`tests/seam-guard.mjs` 的源码文本断言降为辅助。

### 三、契约 3 项阻塞（回执第三节）逐项解决

#### 阻塞 4：`ctx.get('mcpAuth', false)` 安全性 → **已解，安全**

出处：`@deepseek-ai/cordis/lib/types/reflect.d.ts:117-122`（安装版）
```
/**
 * Read a service from the store without the inject requirement.
 * @param strict — when `true`, only return implementations whose providing
 * fiber is currently active.
 * @returns the service value, or `undefined` when not (yet) provided.
 */
get(name: string, strict?: boolean): any;
```
→ 服务未注册时返回 `undefined` 而非抛错。`ctx.get('mcpAuth', false)` 可安全用作装配点。

#### 阻塞 5：REAL-composition 测试既有写法 → **已解，但被黑盒方案取代**

既有写法（`tests/load-path.spec.ts`）：用真实 `Loader.prototype.unwrapExports`
unwarp 模块，断言 namespace 形态（防 `export default` 折叠丢 `inject`）。

**为何被取代**：该测试依赖 `vitest` + `node_modules`（未装）；而黑盒方案直接对**生产 bundle**
取证，证据强度更高（生产代码 = 运行时真实代码），故采用黑盒。load-path.spec.ts 的 guard 意图
（namespace 不被折叠）在 seam 落地后仍须单独验证——因 seam 不新增 export，其风险不变。

#### 阻塞 1&2：Cloudflare token 行为 → **阻塞 2 已解（capability 级）；阻塞 1 待真授权**

**阻塞 2 已解**（RFC 8414 metadata 实证）：
```json
{
  "authorization_endpoint": "https://mcp.cloudflare.com/authorize",
  "token_endpoint": "https://mcp.cloudflare.com/token",
  "registration_endpoint": "https://mcp.cloudflare.com/register",
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": ["client_secret_basic","client_secret_post","none","private_key_jwt"],
  "revocation_endpoint": "https://mcp.cloudflare.com/token",
  "client_id_metadata_document_supported": true,
  "scopes_supported": ["offline_access", "user:read", "account:read", ...]
}
```
- `refresh_token` grant 支持 → refresh 链路可行；需 `offline_access` scope 才发 refresh_token
- `token_endpoint_auth_method: none` 支持 → public client 成立（与契约 §3.3 判定一致）
- `revocation_endpoint` = token 端点 → logout 可做 RFC 7009 撤销
- `client_id_metadata_document_supported: true` → 备选方案存在（但 DCR 仍更直接）

**端点路径修正**（与旧笔记不同，实测）：authorize/token 是 `https://mcp.cloudflare.com/authorize|/token`
（无 `/oauth` 前缀）；protected-resource metadata 路径必须是
`/.well-known/oauth-protected-resource/mcp`（不带 `/mcp` 后缀会 404）。

**阻塞 1 仍待解**：实际 `expires_in` 与 refresh_token 是否轮换，必须完成一次真授权才能拿到。
当前状态：既有 clientId `UqYJUsYbd3hG6iPP` **仍有效**（authorize 返回 200 授权页，非 404），
pending 对（codeVerifier 43 位合法 + oauthState 64 位合法）已存 `mcp-auth.json`，
可复用续跑。**需用户在浏览器完成 Cloudflare 授权同意**后才能取到 token。

**缓解**：阻塞 1 不阻塞 provider 实现——provider 对 `expires_in` 的处理是通用的
（`expiresAt = now + expires_in`，SDK 自动判断过期重刷）。两类风险及对策：
- 若 `expires_in` 极短（<60s）→ 每次调用都触发 refresh；对策：provider 在读 token 前 5s 预刷新
- 若 refresh 后 refresh_token **不轮换** → 可长期复用；若轮换 → `saveTokens` 已按 SDK 契约全量覆盖，正确

---

<!-- 后续阶段条目追加在此上方 -->

---

## 阶段 3 前置条件（7 条，逐条达成记录）

### 前置 1&2：阶段 1/2 证据 → 已补齐（见上一节）

### 前置 3：dsh-src 锚点比对

```bash
git -C ~/dsh-src rev-parse HEAD
git -C ~/dsh-src status --porcelain
```

```
47f943859bef60e4160492346772ded9b24f765a      ← 与阶段 0 记录值一致 ✅
(空)                                          ← 工作区干净 ✅
```

### 前置 4：契约文件

**路径**：`oauth-provider-contract.md`（8 章）

内容：参与方与依赖方向（含禁止反向 import）、auth-store 已交付能力表、`createAuthProvider` 工厂签名与 SDK 11 成员的实现职责、明确不实现的 3 个成员及理由、降级与失败约定、5 条 HTTP 路由契约、回调 URL 随机端口的注入方式与状态机、端到端 15 步数据流、底座 seam 最小改动预估（+13 行 / 上限 25）、5 项待实测（3 项标注阻塞）。

### 前置 5：TDD 先红（快照测试先 fail 的证据）

**文件**：`~/.dsh-src/packages/mcp/mcp-client/tests/seam-guard.mjs`（dsh-src 内新增，未碰任何源码）

oracle 两层：① 安装版 dsh 内置的真实 SDK 构造「改动前形态」作逐字节基准（实测私有字段名 `_requestInit`/`_authProvider`/`_oauthProvider`）；② dsh-src 源码文本断言 seam 形态学特征。

**seam 未实现时的首跑输出（先红证据）**：

```
✅ oracle① 真实 SDK 构造的改动前形态 = 基准 ({"requestInit":{"headers":{"X-Test":"value","Authorization":"Bearer static-token"}},"authProvider":null,"oauthProvider":null})

源码签名: config: Config
❌ oracle②-1 createTransport 已声明第二参数(实测 1 个: [config: Config])
❌ oracle②-2 第二参数为可选(带 ?): ""
❌ oracle②-3 streamable-http 分支透传 authProvider
✅ oracle②-4 createTransport 内无 if/else/三元分支(实测 无 ✓)

pass 2 / fail 3
seam guard 有失败 ❌  seam 未实现时的预期先红(oracle②-1/②-3 必失败)
```

**环境限制说明（必须记录）**：dsh-src 全仓无 `node_modules`（未安装），TS 源码无法被 node 直接加载；安装版把 `createTransport` 内联进 bundle 未导出。因此 guard 用「真实 SDK 构造基准 + 源码文本断言 + 构建产物动态加载（若存在）」三层覆盖。**seam 实现后必须重跑此 guard 确认转绿**。

### 前置 6&7：分工与行数汇报

- 阶段 3 主线自做已确认；阶段 4 子代理任务等阶段 3 路由定稿后启动
- 行数汇报规则接受：每改完一个 dsh-src 文件报累计；累计 >20 主动停，>25 立即停
- 阶段 3 备份点将在 seam 改动前建立（`./scripts/phase0-backup.sh phase3`）

---

## 阶段 3a：seam 落地（源码层完成，build 阻塞）

**时间**：2026-10-20 19:55 → 20:10
**备份**：`~/.dsh/backups/hub-phase3-20261020-195355`（378K / 38 文件 / 自校验通过）

### 疑点 1 澄清（用户回执第二节第 1 条）——证据射程修正

上一轮我写「对生产 bundle 取证」**射程过宽，特此更正**：

黑盒 guard 的 treatment 是**从生产 bundle 复制后，用字符串替换伪造的 patch**（`bb-treatment`），
**没有经过 tsc/tsdown 编译**，也没有替换生产。正确射程是：

> **「源码层 seam 写法不改变 transport 构造参数」**——即证明 patch 文本形态本身无害。
> 不能声称「生产 bundle 已具备此行为」或「构建产物已验证」。

| 黑盒 treatment 的加载方式 | 实际 | 结论 |
|---|---|---|
| a. 临时 tsx/esbuild 跑源码 | 否（tsx/esbuild 均不可用） | — |
| b. 临时目录 build 产物 | 否（**pnpm/tsc/tsdown 均不可用**） | — |
| c. 已替换生产 | **否**（生产 bundle 从未被改） | — |

→ 所以黑盒只是**形态学自检 + 构造参数等价的形式化证明**，不等价于构建产物验证。

### 疑点 2 澄清（用户回执第二节第 2 条）——阶段 3 拆分已采纳

- **3a**（本次）：写代码 + 形态验证。**3a 完成 ≠ 阶段 3 完成。**
- **3b**（待用户在浏览器完成 Cloudflare 授权）：真机验证三件事——
  `expires_in` 实际值 / refresh 是否轮换 / `redirect_uri` 严格匹配

### 疑点 3 澄清（用户回执第二节第 3 条）——用户判断完全正确，已实证

```
ls ~/.dsh/mcp-auth.json          → 不存在（dsh 侧从未生成 pending）
~/.local/share/opencode/mcp-auth.json → 330B，含 clientInfo + codeVerifier + oauthState
```

**该 pending 是 opencode 遗留**（`clientIdIssuedAt: 1786151616`，dsh auth-store 从未写入）。
其 verifier 绑定 opencode 的 `redirect_uri` = `127.0.0.1:19876/mcp/oauth/callback`。
dsh 的回调端口随机 + 路径需自定 → **用该 pending 换 token 必 400 invalid_grant**。

**结论：3b 前必须先用 dsh 自己的流程清掉 opencode 的 pending 并重新生成一对。**
已把该条目从 3b 测试计划中排除。（`mergeExternalStore` 的用途不变——它并的是 dsh 与 opencode
共存的**已完成授权态**（clientInfo/tokens），不是 pending。）

### seam 落地（2 个文件，累计 +8 行）

**文件 1/2**：`dsh-src/packages/mcp/mcp-client/src/transport.ts`
```diff
+import type { AuthProvider } from '@modelcontextprotocol/sdk/client/index.js'
-export function createTransport(config: Config): Transport {
+export function createTransport(config: Config, authProvider?: AuthProvider): Transport {
       case 'streamable-http':
         return new StreamableHTTPClientTransport(
           new URL(config.url),
-          { requestInit: { headers: config.headers } },
+          { requestInit: { headers: config.headers }, authProvider },
         ) as Transport
```
`AuthProvider` 从 `@modelcontextprotocol/sdk/client/index.js` 导出（`client/dist/index.d.mts:374,381`），
与 `connection.ts` 现有 import 惯例一致。

**文件 2/2**：`dsh-src/packages/mcp/mcp-client/src/connection.ts`
```diff
 export function startConnection(ctx: Context, config: Config, policy: ResolvedReconnectPolicy): ConnectionHandle {
   const label = `mcp-client(${config.serverName})`
+  // Optional OAuth provider: undefined when no auth service is registered.
+  const authProvider = ctx.get('mcpAuth', false)?.getAuthProvider(config.serverName, config)
...
-      await generation.connect(createTransport(config))
+      await generation.connect(createTransport(config, authProvider))
```

**`index.ts` 无需改动**（原施工图预估 3 文件 +13 行偏保守）：auth 服务由我的插件注册，
`connection.ts` 的 `?.` 已做空安全，`index.ts` 的透传职责已由 `startConnection(ctx, ...)` 完成。

**累计行数：+8**（transport.ts +5/-2，connection.ts +3/-1）——远低于 25 上限。

**空安全依据**：Cordis `reflect.d.ts:117-122` 明示未注册服务返回 `undefined` 不抛错，
故 `ctx.get('mcpAuth', false)?.getAuthProvider(...)` 未注册时为 `undefined`，
`createTransport(config, undefined)` 与改动前等价（黑盒 ② 项已验证）。

### 源码层验证（guard 转绿）

```bash
cd ~/dsh-src/packages/mcp/mcp-client && node tests/seam-guard.mjs
```
```
✅ oracle① 真实 SDK 构造的改动前形态 = 基准
源码签名: config: Config, authProvider?: AuthProvider
✅ oracle②-1 createTransport 已声明第二参数(实测 2 个: [config: Config, authProvider?: AuthProvider])
✅ oracle②-2 第二参数为可选(带 ?): "authProvider?: AuthProvider"
✅ oracle②-3 streamable-http 分支透传 authProvider
✅ oracle②-4 createTransport 内无 if/else/三元分支(实测 无 ✓)
pass 5 / fail 0
```

### build 阻塞（硬阻塞，未解决）

**pnpm install 不可行，两个独立原因**：

1. `pnpm --version` 直接失败：
   ```
   Cannot verify the identity of the @pnpm/exe.android-arm64 native binary:
   it is missing from pnpm-lock.yaml.
   ```
   lock 是为桌面平台生成的，不含 Termux/Android-arm64 的 pnpm 自身二进制。
2. 磁盘仅剩 **8.6G / 97% 满**（`df -h ~`）。dsh 是 monorepo（含 website、python/sdk-runtime、
   examples），全量装下大概率溢出。

`tsc` / `tsdown` / `tsx` / `esbuild` 均不可用（`ls node_modules/.bin` 空）。

**因此用户回执第三节「第一步：build 到临时目录」无法执行。**

---

## 阶段 3a 授权期内：oauth-provider + oauth-server 完成（mcpAuth 服务半体）

**时间**：2026-10-21 00:00 → 07:40
**备份**：`~/.dsh/backups/hub-phase3b-20261021-073639`（470K / 44 文件 / 自校验通过）
**状态**：provider + server 两块完成并全绿；`lib/index.js` 装配与 `lib/client.js` UI 未做。

### 一、SDK 形态留档证据（授予书第一节）

**问题：SDK 对 provider 是纯结构类型检查还是运行时校验？**

→ **纯结构类型（鸭子类型），零运行时校验**。

证据 1（是 interface，不是 class）：`@modelcontextprotocol/client/dist/index.d.mts:429`
→ `interface OAuthClientProvider {`（全文唯一一条；无 class 形态，安装版也未导出该名字）

证据 2（适配器只做属性读取）：`dist/index.mjs:285-292`
```js
function adaptOAuthProvider(provider, extraAuthOptions) {
	return {
		token: async () => { return (await provider.tokens())?.access_token; },
		onUnauthorized: async (ctx) => handleOAuthUnauthorized(provider, ctx, extraAuthOptions)
	};
}
```
零 `instanceof` / 零 `typeof` 断言 → 对象字面量即可实现。漏成员的后果是调用时 undefined 报错，
不存在"运行期接口不兼容"错误。风险：无额外风险（22 个用例已含成员存在性断言）。

### 二、state / codeVerifier 的 SDK 使用证据（授予书第二节，安全地基）

**证据 1：authorize URL 构造处确实读 provider.state()** — `dist/index.mjs:822-829`
```js
const state = provider.state ? await provider.state() : void 0;
const { authorizationUrl, codeVerifier } = await startAuthorization(authorizationServerUrl, {
	metadata, clientInformation, state, redirectUrl: provider.redirectUrl, scope: resolvedScope, resource
});
```
`provider.state ? ... : void 0` → **不实现 state() 就真的没有 CSRF 防护**。

**证据 2：token 请求确实用 provider.codeVerifier()** — `dist/index.mjs:1393` + `1239-1246`
```js
tokenRequestParams = prepareAuthorizationCodeRequest(authorizationCode, await provider.codeVerifier(), provider.redirectUrl);
// ↓
function prepareAuthorizationCodeRequest(authorizationCode, codeVerifier, redirectUri) {
	return new URLSearchParams({ grant_type: "authorization_code", code: authorizationCode, code_verifier: codeVerifier, redirect_uri: String(redirectUri) });
}
```

**证据 3：tokens() 走 per-request 读取路径** — `dist/index.mjs:285-289`：
`token: async () => (await provider.tokens())?.access_token` → 每请求调一次；
`ctx===undefined` 时也必须返最近 token（我的 provider 已满足）。

### 三、oauth-provider.js（+约 230 行含注释）

TDD 真先红：22 用例先 1 fail（实现不存在），实现后 22/22。

- `OAuthClientProvider` 是 interface → 对象字面量，**零 SDK import**
- `tokens()`：`ctx===undefined` 返最近 token；`expires_in = max(0, expiresAt - now)`；无 `expiresAt` 视为长期有效
- `saveTokens()`：无 `expires_in` 时保留原 `expiresAt`（防刷新写坏）
- `state()`：32B hex + 落 store（自动打 pendingAt）
- `redirectToAuthorization()`：只做协议白名单，真实跳转交给 `/start`
- 铁律 6：错误信息只含 id + host

### 四、oauth-server.js（+约 330 行含注释）

TDD 真先红：23 用例先 22 fail（路由未注册），实现后 23/23。

按定死项实现：
1. `/oauth/start` 响应 = `{status, authUrl}`，无 stateEcho
2. 410 友好 HTML「授权超时，请回 dsh 重新发起」
3. 探测 `AbortController` 3s；2xx→`already-works`、401→进 OAuth、其他→降级 `need-auth`；探测失败零日志（测试断言 `warns.length === 0`）
4. in-flight Map + store pending 双轨：Map 丢但 store 有 pending → status 仍报 `pending`；回调用 `findEntryByState` 反查 id，**HMR/重启后仍能走完授权**
5. 全部路由走注入的 `route()` 工厂（host 半那份带 loopback 围栏），不绕过

state 三重校验（全部有用例）：
- 不存在/不匹配 → 400
- pending 过期 → 400 + purge（判据 `pendingAt`）
- 重放 → 第二次找不到 → 400，且端口已拒绝连接
- 成功路径：正好打一次 `/token`，tokens 落盘，pending 清，in-flight 关

**期间修掉 2 个自身缺陷**（P2 级，铁律 9）：
1. `Map.delete()` 返 boolean 不是 undefined → 原判据 `!== undefined` **恒真**，finish 无 pending 时报 cleared:true。改先读 hadPending 再 `inflight.has()`。
2. `clearOAuthState` 无条件 `setEntry` → 未授权 id 被 finish/cancel 会**创建空壳条目**。改无 pending 时不写盘（auth-store 30 用例无回归）。

**测试注入踩坑**（盲区档案）：给 probe 注入假 `globalThis.fetch` 时必须放行 loopback 回调
（`return realFetch(url, opts)`），否则假 fetch 把回调自己拦掉，测出假的 400。

### 五、全量回归（7 文件）

```
test.mjs:                pass 1  fail 0   (内部 16 fixCase)
test-routes.mjs:         pass 1  fail 0   (内部 10 步骤)
test-yaml-safety.mjs:    pass 1  fail 0   (内部 12 检查)
test-client-entry.mjs:   pass 4  fail 0
test-auth-store.mjs:     pass 30 fail 0
test-oauth-provider.mjs: pass 22 fail 0
test-oauth-server.mjs:   pass 23 fail 0
```

### 六、自主决策清单（授予书第一节）

| 自主决定 | 为什么 |
|---|---|
| provider 用对象字面量而非 class | SDK 的 `OAuthClientProvider` 是 interface 非 class；字面量零 import |
| `state()` 做成必做（契约写可选） | SDK 源码证明不实现=无 CSRF 防护 |
| 回调用「先查内存 in-flight，再退回 store 反查」 | 否则 HMR/重启后用户授权流程直接死 |
| state 不存在用 400、端口已关用连接拒绝 | 410 语义是"服务端暂时不可用"，state 失效是客户端错误 |
| 探测用 `initialize` 方法 | MCP 标准握手，不需已授权 |
| 「探测失败不落日志」落成断言而非仅注释 | 只写注释不可验证 |
| 修 clearOAuthState 空壳条目 | 授权书第一节第 5 条 P2 级缺陷 |

### 七、下一步

`lib/index.js` 装配：注册 5 条 oauth 路由 + `ctx.provide('mcpAuth', ...)` 服务
（`getAuthProvider(serverName, config)` 返 per-MCP-line 稳定 provider 实例，供 seam 的
`ctx.get('mcpAuth', false)?.getAuthProvider(...)` 取用）。

---

## 阶段 3a 收尾：装配 + UI 完成，全量回归 9 文件绿

**时间**：2026-10-21 08:05
**备份**：`~/.dsh/backups/hub-phase3c-20261021-080505`（502K / 46 文件 / 自校验通过）

### 八、lib/index.js 装配（+58 行）

新增 3 个 helper + 3 条 import：
- `resolveAuthStorePath(deps)` → `<dshHome>/mcp-auth.json`（与 opencode 不同盘，不互覆盖）
- `makeRouteFactory(ctx)` → 与 host 半 `route()` **同形**（loopback 围栏 + 405 + 错误兜底）
- `registerAuthService(ctx, authPath)` → `ctx.provide('mcpAuth', service)`，服务带
  `getAuthProvider(serverName, config)`，**按 serverName+url 缓存实例**（seam 在
  startConnection 作用域只取一次，重连复用同一 provider，故必须稳定）

装配代码用 try/catch 包住：**OAuth 装配失败不得影响既有路由注册**（增量能力，非必需路径）。

**过程中修正 2 处口径不一致**（发现即修，均已回归验证）：
1. `authStorePath()` 原先不读 `dshHome` → 沙箱测试会写到真实 `~/.dsh`。改为
   `options?.dshHome || $DSH_HOME || ~/.dsh`，与 host 半 `resolveProfileDir` 口径一致。
2. oauth 路由 path：host 半的 `route()` 调用传的是 `API + "/state"`（**已含前缀**），
   oauth-server 起初传裸 `/oauth/status` → 注册表 path 不匹配。改为 oauth-server
   内部自己拼 `API` 常量，与 host 半统一。

### 九、lib/client.js UI（+约 60 行）

- 每行 http 行（`transport === "streamable-http"` 且 editable）加「授权」按钮
  + 状态徽章；**stdio 行不出现**（有守卫 + 测试断言）
- `AuthBadge` 6 态：`not_authenticated` / `pending`(warn) / `authenticated`(ok) /
  `expired`(warn) / `already-works`(ok) / `failed`(danger)；**未知态不渲染**
  （修掉的实现缺陷：原兜底 `["", status]` 会把原始 status 字符串渲染到 UI 上）
- `startAuth`：调 `/oauth/start`；`already-works` → 徽章变 ok；有 authUrl →
  `window.open(url, "_blank", "noopener,noreferrer")` + pending 徽章
- 轮询：10s 间隔 + `alive` 守卫（卸载后不再 setState）+ 单行 try/catch（一个行失败不影响其它行）
- i18n：zh + en 各 8 个新键

### 十、新增测试（3 个文件，61 用例）

| 文件 | 用例 | 覆盖 |
|---|---|---|
| `test-oauth-provider.mjs` | 22 | provider 11 个成员 + 安全红线 + 并发隔离 + 文件损坏 |
| `test-oauth-server.mjs` | 23 | 5 路由 + state 三重校验 + 成功路径 + 脱敏 |
| `test-oauth-wiring.mjs` | 11 | provide('mcpAuth') + 实例稳定性 + 路由注册 + 降级路径 |
| `test-oauth-ui.mjs` | 9 | 源码守卫 + **真实 react 渲染**（dsh-tui 的 react 19.2.8）+ 轮询行为 |

注：profile 的 node_modules 里**没有 react**（react 是 dsh bundle 内置的），
UI 渲染测试改用 dsh-tui 自带的 react 19.2.8 + jsx-runtime（只取 element tree，无需 DOM）。

### 十一、全量回归（9 文件）

```
test.mjs:                pass 1  fail 0    (内部 16 fixCase)
test-routes.mjs:         pass 1  fail 0    (内部 10 步骤)
test-yaml-safety.mjs:    pass 1  fail 0    (内部 12 检查)
test-client-entry.mjs:   pass 4  fail 0
test-auth-store.mjs:     pass 30 fail 0
test-oauth-provider.mjs: pass 22 fail 0
test-oauth-server.mjs:   pass 23 fail 0
test-oauth-wiring.mjs:   pass 11 fail 0
test-oauth-ui.mjs:       pass 9  fail 0
```

### 十二、独立只读验证（供复核）

```bash
# 1. Hub 侧 9 个测试文件全绿
cd ~/dsh-plugins-src/dsh-mcp-skill-hub
for f in test.mjs test-routes.mjs test-yaml-safety.mjs test-client-entry.mjs \
         test-auth-store.mjs test-oauth-provider.mjs test-oauth-server.mjs \
         test-oauth-wiring.mjs test-oauth-ui.mjs; do
  echo -n "$f: "; node --test "$f" 2>&1 | grep -E "^ℹ (pass|fail)" | tr -n ' '; echo
done

# 2. 生产 bundle 未被触碰（应与 seam 记录值一致）
sha256sum /data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js
# 期望 758d8fc473b700b5d351158d06ce9f9e92c16e8b25497b08bb7bd2122a87f5dd

# 3. dsh 本体仍可用
dsh --version     # 期望 0.2.1-alpha.5

# 4. 未执行任何删除
df -h /data | tail -1
```

### 十三、阶段 3a 完成边界（重要）

**3a 完成了 Hub 侧全部三块**（provider / server / 装配+UI）+ seam 源码层改动。
**未完成，必须交给你的是**：
1. dsh-src build（pnpm 在 android-arm64 不可行 + 磁盘不足）→ seam 无法生效
2. `scripts/replace-installed.sh` 生产替换（脚本已交付并干跑验证 4 个拒绝场景）
3. 3b 真机授权（expires_in 实际值 / refresh 是否轮换 / redirect_uri 严格匹配）

**Hub 侧当前状态**：完整可用但**尚未与底座打通**（底座 bundle 里没有 `mcpAuth` seam）。
Hub 的 `mcpAuth` 服务已就位，只等 seam 生效后 `ctx.get('mcpAuth', false)` 才能取到。

---

## 阶段 3a 证据等级更正 + 追问三条回答（用户阶段 3a 报告回执）

**时间**：2026-10-21 09:20

### 一、证据等级更正（用户第一节要求，原文照录）

> **阶段 3a：Hub 侧代码 L1 完成（测试绿），集成 L0（bundle 未 patch、服务可见性未验、authProvider 未生效）。
> mcpAuth 当前为「已 provide、零真实 consumer」。
> 3a 完成 ≠ Hub 与 dsh 打通。**

（原「L1 完成」声明越级，已按此更正。）

### 二、追问 3：authStorePath（已回答并补测试）

实现（`lib/auth-store.js:59-62`）：
```js
function authStorePath(options) {
	const dshHome = options?.dshHome || process.env.DSH_HOME || join(homedir(), ".dsh");
	return join(dshHome, "mcp-auth.json");
}
```
三个确认点全部成立：
1. 测试注入的 `dshHome` 生效（`authStorePath({dshHome})` → `<dshHome>/mcp-auth.json`）
2. 生产默认仍是 `~/.dsh/mcp-auth.json`（无 options、无 `$DSH_HOME` 时）
3. **跑完全部测试后 `ls -la ~/.dsh/ | grep mcp-auth` 无输出** —— 真实凭据文件未被测试创建

新增 3 个断言钉死这三点（`test-oauth-wiring.mjs`）：
```
✔ 装配: 测试全程不得在真实 ~/.dsh 下创建 mcp-auth.json（防污染）
✔ authStorePath: 缺省走 ~/.dsh（生产默认）, 显式 dshHome 优先
```

### 三、追问 2：/oauth/status 的 HMR 场景（测试在，判断正确；**补测非 TDD 先红**）

> ⚠️ **证据等级如实标注（用户回执第三节要求）**：
> `/oauth/status` 的 HMR 用例是**补测**——写在实现之后，**不是 TDD 先红**。
> 其余 4 个新测试文件（`test-oauth-provider.mjs` / `test-oauth-server.mjs` /
> `test-oauth-wiring.mjs` / `test-oauth-ui.mjs`）为先红后绿；
> `test-oauth-reconnect.mjs`（补偿重连）亦为先红后绿。
> 补测用例的作用是"把已存在的行为钉住"，不能替代先红证据。

用例原文（`test-oauth-server.mjs`）：
```js
test('状态机: store 有 pending + 内存无记录 → pending（决策4 防 HMR 卡死）', async () => {
  ...
  authStore.setOAuthState(s.authPath, id, 'a'.repeat(64))
  authStore.setCodeVerifier(s.authPath, id, 'v'.repeat(43))
  const r = await call(h, '/oauth/status?id=' + id, 'GET')
  assert.equal(r.json.status, 'pending', 'store 有 pending 应按 pending 处理')
  assert.equal(r.json.inFlight, false, '内存无记录')     // ← HMR 后 Map 丢了的显式断言
})
```
`/oauth/status` 的判据**完全走 store**（`getEntry` 读 `codeVerifier`/`oauthState`），
不依赖内存 `inflight` Map —— 所以 HMR 后 Map 丢失不影响 status 报 pending。
（我自主决策清单里写的是 callback 路由的 store 反查，status 这条是同一设计原则在
另一条路由上的落地，用例确实在，此前没明确指向，现补充说明。）

### 四、追问 1：Cordis 服务可见性（最高优先级，已黑盒实测）

用真实 Cordis（dsh 内置 0.2.1-alpha.5）跑了 3 轮 fixture，共 13 个场景：

**可见的（✅）**：
| 场景 | 结果 |
|---|---|
| 两插件同 ctx，A provide B get | 拿到 |
| provider 先、consumer 用 `ctx.extend()` 子 ctx | 拿到 |
| provider 在子 fiber、consumer 在父 | 拿到 |
| `root.provide` → 兄弟 extend ctx get | 拿到 |
| `sibling.root.provide` → 写进 root 作用域 | **可以**（顺序无关的解） |
| 未注册 + `strict=false` | `undefined` 不抛错（seam 空安全前提成立） |

**顺序敏感（⚠️，这是必须告诉你的真实限制）**：
| 场景 | 结果 |
|---|---|
| consumer 先 apply、provider 后到 | consumer **不被唤醒重跑**，首读恒 `undefined` |
| consumer 用 `ctx.effect` 订阅、provider 后到 | effect **也不重跑** |
| 底座先 mount，Hub 后 provide 到 root | 首读 `undefined`；**重连（第二次 startConnection）才读到 `hub-root`** |

**生产顺序实况**：patch 里 Hub **没有自己的 entry`（Hub 经 profile `package.json` 的
`dependencies`/`plugins` 数组第 51 行被 cordis 默认发现机制加载），8 个 mcp-client 行
由 patch 的 `- insert:` 加载。**两者的先后不由我们控制**。

**结论（三条路线的实际含义）**：
1. patch 有意义——`ctx.get('mcpAuth', false)` 确实能读到 Hub provide 的服务（同 scope / root provide 都验过）
2. 但**首次连接可能拿不到**（若 mcp-client 先 mount）：此时 seam 走空安全路径，
   authProvider=undefined → 静态 headers 兜底 → 重连后恢复 OAuth
3. **彻底消除顺序依赖的办法**：Hub 侧改用 `ctx.root.provide('mcpAuth', ...)`
   （fixture 已验证 sibling.root.provide 能写进 root 作用域）—— 但这仍不解决
   "consumer 已跑完不被唤醒"，只解决"provider 在 root 让所有后读者可见"

→ **3b patch 前还需你拍板一件事**：接受"首次连接无 OAuth、重连后恢复"，还是要求
Hub 用 `ctx.root.provide` + 接受同样的首次限制。

### 五、第三节降级方案：选 B（不依赖浏览器）

理由：A 方案（TTL 后降级监听 60s）仍然依赖用户**停留在浏览器页面**等那 60s，
且要多养一个 server 60s；B 方案把超时状态搬进 Hub 自己的 UI 轮询里，
用户回 dsh 设置页就能看到「授权已超时，请重新点击授权」，**不依赖浏览器是否还开着**，
也不增加 server 生命周期复杂度。

实现（2 处）：
1. `lib/oauth-server.js` `statusOf()`：pending 过期判据与回调侧一致
   （`pendingAt + PENDING_MAX_AGE_MS`），过期 → `expired`；`/oauth/status` 增返
   `expiresAt`（tokens 有则 token 过期时刻，pending 有则 pending 过期时刻）
2. `lib/client.js`：`authExpired` 文案改为「授权已超时，请重新点击授权」

新增测试：
```
✔ 状态机: pending 过期 → expired + expiresAt（降级方案 B, 不依赖浏览器）
```
（`test-oauth-server.mjs` 24 用例全绿）

### 六、第四节 patch 处数重算（用户口径正确，已按真实处数重写）

**源码层 3 处**：`transport.ts` 签名(+透传 2 hunk) + `connection.ts` 读取+传递(1 hunk)，+8/-3 行。

**bundle 层 4 处**（比源码多 1 处，因为 bundle 没有 import 段，provider 读取必须塞进调用点所在函数）：
| # | 位置 | 改动 |
|---|---|---|
| P1 | `lib/index.js:38` | `function createTransport(config)` → `(config, authProvider)` |
| P2 | `lib/index.js:46` | `{ requestInit: { headers: config.headers } }` → `+ authProvider` |
| P3 | `lib/index.js:643` | 调用点前插入 `const authProvider = ctx.get("mcpAuth", false)?.getAuthProvider(config.serverName, config)` |
| P4 | `lib/index.js:643` | `createTransport(config)` → `createTransport(config, authProvider)` |

（P3/P4 在同一处插入，脚本按 1 个 hunk 处理，故报"3 hunk / 4 处改动"。）

**新脚本 `scripts/patch-installed.sh`**（取代原 `replace-installed.sh` 路线，因 build 不可行）：
- 幂等：每处 patch 前检测是否已是 patch 后形态，已是则跳过；整包已 patch 则退出 0
- 锚点唯一性校验：每个 BEFORE 串必须恰好 1 次，否则拒绝执行（防改错地方）
- 备份：`<bundle>.bak-<ts>` + `sha256sum` + 自校验
- 失败自动回滚：任一处替换失败 → 不碰原文件；验证失败 → 从备份恢复
- 4 项验证：V1 bundle 可 import 且 `name/inject/apply/Config` 形态正常 / V2 `dsh --version` /
  V3 `dsh --help` / V4 patch 四处形态自检
- dry-run 模式（默认）：只报告会改什么，不写任何文件

**沙箱实测（未碰生产）**：
```
✅ P1 签名 已应用 / ✅ P2 http透传 已应用 / ✅ P3 读+传 已应用
✅ 备份自校验通过
✅ 幂等: 对已 patch 的文件跑 --apply → "已是 patched 形态", exit 0
✅ patch 后 bundle 放进真实依赖沙箱可加载: name=mcp-client, inject=["tools"], apply=function, Config=function
✅ V1 失败场景自动回滚生效（回滚后文件与 .bak sha 一致）
```

### 七、磁盘第 0 步（已按修正口径，未执行）

不删 `opencode.log`（188M 不值得停 opencode）。只删
`~/.npm`(3.3G) + `~/.bun/install/cache`(302M) + `pip-install-*`/`pip-unpack-*`(1.1G) ≈ 4.7G，
dm-67 6.9G → 约 11.6G。**删除由人执行，我未执行任何删除。**

### 八、当前状态

- 生产 bundle sha256 `758d8fc4...` 未变，dsh `0.2.1-alpha.5` 可用
- 9 个测试文件全绿（104 用例）
- 未 patch、未替换、未删除任何生产文件

---

## 阶段 3b 前置：补偿重连 + 标注修正（用户放行回执）

**时间**：2026-10-21 10:30
**备份**：`~/.dsh/backups/hub-phase3d-20261021-102835`（542K / 48 文件 / 自校验通过）

### 一、顺序敏感裁决落地：补偿重连（TDD 先红后绿）

**采纳你的方案**：接受"首次无 OAuth"，Hub 在 apply 末尾补偿场景 A
（冷启动有 token 但无人唤醒底座）。

**实现**（`lib/index.js` 新增 `scheduleAuthReconnect()`，+38 行）：
```js
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
		let hmr = false
		try { hmr = ctx.get("hmr", false) != null } catch { return }
		if (!hmr) return
		let pm
		try { pm = ctx.get("pluginManager", false) } catch { return }
		if (!pm || typeof pm.reload !== "function") return
		for (const row of targets) {
			try {
				await Promise.race([ pm.reload([row.id]), new Promise((r) => setTimeout(r, 15000)) ])
			} catch { /* 单行失败不影响其它行, 不阻塞启动, 不重试 */ }
		}
	}
	try { setTimeout(run, 0) } catch {}
}
```

六条约束逐条落地：

| 约束 | 落地方式 | 测试 |
|---|---|---|
| 1. 读 store 里有 tokens 的 serverUrl | `loadAuthStore` + `entry.tokens.accessToken` 非空 | `补偿: 有 tokens + enabled http 行 → 触发一次 reload` |
| 2. 与 patch enabled http 行求交集 | `rows.filter(transport==='streamable-http' && enabled && store 有 token)` | `补偿: 多行只 reload 有 token 的那些（交集语义）` |
| 3. 每行触发一次重建 | `pm.reload([row.id])`（复用 `applyAfterWrite` 同一条路径） | 同 1 |
| 4. `setTimeout(0)` 延迟 | `setTimeout(run, 0)` | 所有用例 `await tick()` |
| 5. 幂等/失败不阻塞/不无限重试 | 每行一次 `Promise.race` + try/catch 吞掉，无循环重试 | `补偿: reload 抛错不阻塞启动` + `补偿: 重复 apply 不叠加无限重试` |
| 6. 成功后 status 返 authenticated | 由 reload 后底座重建连接 + provider 生效 → **L4 由 3b 真机验证** | 未测（需真机） |

负向用例（防止误伤）：无 tokens 不 reload / 无 hmr 不 reload / disabled 行不 reload /
stdio 行即使有 token 也不 reload。

**测试输出**（`test-oauth-reconnect.mjs`，9 用例，TDD 先红：4 fail → 9 pass）：
```
✔ 补偿: 有 tokens + enabled http 行 → 触发一次 reload
✔ 补偿: 无 tokens → 不触发 reload（不需要 OAuth 的行）
✔ 补偿: 无 hmr 服务 → 不触发 reload 且不抛
✔ 补偿: disabled 行不触发 reload（patch 里 disabled 的行不该被重载）
✔ 补偿: reload 抛错不阻塞启动（幂等 + 失败静默）
✔ 补偿: 多行只 reload 有 token 的那些（交集语义）
✔ 补偿: 重复 apply（清守卫后强制再挂）不叠加无限重试
✔ 补偿: stdio 行即使有 token 也不 reload（只补 http 行）
ℹ tests 9 / pass 9 / fail 0
```

**实现中修正的一处**：初版没查 hmr 服务（与 `applyAfterWrite` 口径不一致）——
hmr 未启用时重载无意义，已补 `ctx.get("hmr", false) != null` 检查并加测试。

**测试中修正的一处**：「二次 apply」原断言写错（共享 `globalThis[MOUNT_KEY]`
但每次新建 reloads 数组，语义混乱）。改为共享计数器验证"每次 apply 最多一次，
不叠加成无限重试"。

### 二、标注修正（用户第三节）——已写入本节开头「追问 2」小节

`/oauth/status` 的 HMR 用例为**补测（非 TDD 先红）**，已在 PROGRESS.md 明确标注；
其余 4+1 个新测试文件为先红后绿。

### 三、build 路径：b（patch 生产 bundle），由人执行

七条约束的落点：
1. 执行人是人 —— 脚本头部已标 `⚠️ 由人手动执行，不由 agent 执行（铁律 5）`
2. patch 前先 dry-run —— `./scripts/patch-installed.sh`（默认 dry-run，只报告不写）
3. `.bak` 存在 + sha256 记录 —— 脚本内 `cp -a` + `sha256sum` + 自校验
4. patch 后 `dsh --version` + stdio 工具调用 —— V2/V3；stdio 工具调用需你在真机做
5. 二次跑识别已 patched 并 exit 0 —— 幂等检测已沙箱验证
6. 失败自动回滚 .bak —— V1-V4 任一失败即 `cp -a "$BAK" "$BUNDLE"`
7. patch 后 sha256 记入 PROGRESS.md 并标明"已 patch，非上游原版" —— 脚本末尾输出
   PROGRESS 记录片段；**由你 patch 后把实际 sha256 贴回来，我补录**

### 四、磁盘（人执行，我未删任何文件）

`rm -rf ~/.npm ~/.bun/install/cache; rm -rf $PREFIX/tmp/pip-install-* $PREFIX/tmp/pip-unpack-*`
≈ 4.7G，6.9G → 约 11.6G。8.4G 仍等 fsck 结论。

---

## apply 前置四问（用户 dry-run 审核）——答完 + 修掉 2 个真实缺陷

**时间**：2026-10-21 12:25
**备份**：`~/.dsh/backups/hub-phase3e-20261021-122139`（554K / 48 文件 / 自校验通过）

### 问题 1：getAuthProvider 签名 + 索引键映射 —— **发现 P0 级口径断裂，已修**

`Config` **有 `serverName`**（`dsh-src/packages/mcp/mcp-client/src/index.ts:76` StdioConfig、
`:88` StreamableHttpConfig，两个分支都有；zod schema 也 `required()`）。

**但索引键映射是错的**（原实现）：
```js
getAuthProvider(serverName, config) {
    const url = typeof config?.url === "string" ? config.url : "";
    if (!url) return undefined;
    const key = String(serverName || "") + "\u0000" + url;      // ← 缓存键
    const created = createAuthProvider({
        name: String(serverName || ""),                         // ← auth-store 键 = serverName
        ...
```

**断裂在哪**：
- OAuth 路由（`/oauth/start`、`/oauth/status`）的 id 来自 `readMcpRows` 的**行 id**
  （如 `mcp-cloudflare`）—— `requireRow` 在 `rows` 里查 `r.id === id`
- seam 传进来的 `serverName` 是 `config.serverName`（如 `cloudflare`）
- 真实数据：`cordis.patch.yml:48` `- id: mcp-cloudflare` / `:51` `serverName: cloudflare` —— **两者不同**

→ 路由把凭据写到 key=`mcp-cloudflare`，seam 从 key=`cloudflare` 读，**永远对不上**。
授权成功了也用不上。这是 P0 级断裂，apply patch 前必须修。

**修法**（`registerAuthService` 重写，行 id 反查）：
```js
const resolveRowId = (serverName, config) => {
    const rows = readMcpRows(deps.patchPath, ctx).rows || [];
    const url = typeof config?.url === "string" ? config.url : "";
    const hit = rows.filter((r) =>
        r.config?.serverName === serverName && (url === "" || r.config?.url === url));
    return hit.length === 1 ? hit[0].id : undefined;    // 唯一命中才用, 否则不猜
};
// ...
const rowId = resolveRowId(String(serverName || ""), config);
const key = rowId || String(serverName || "");         // 行 id 优先, 查不到退回 serverName
```
底座只给 `(serverName, config)`，拿不到行 id，故反查 patch 中 `serverName + url` 都匹配的**唯一**一行
（多命中时不猜，退回 serverName 保证降级可用）。

**测试**：
```
✔ 装配: getAuthProvider 用 patch 行 id 作 auth-store 键（与 oauth 路由同口径）
✔ 装配: 无法从 config 推出行 id 时返 undefined(不猜键)
```

### 问题 2：同步还是异步 —— **同步，P3 不需要 await**

```js
getAuthProvider(serverName, config) {          // ← function, 非 async
```
`createAuthProvider(options) {` 同样同步（`lib/oauth-provider.js:52`）。
`ctx.get(...)?.getAuthProvider(...)` 直接拿到对象字面量（不是 Promise）。
`connectGeneration` 是 async 函数（`connection.ts:239`），即使将来改 async 也允许 await，
但当前无需改 P3。

### 问题 3：provider 实例是否缓存 —— **有缓存（byId Map，per 行id+url）**

```js
const byId = new Map();
const cacheKey = key + "\u0000" + url;
let existing = byId.get(cacheKey);
if (existing) return existing;      // ← 命中直接返回同一实例
byId.set(cacheKey, created);
```
`startConnection` 每次重连都调一次 `getAuthProvider`，命中缓存返回**同一实例**
→ token 刷新状态、in-flight 状态、已 saveTokens 的内容全部保留。
测试：`装配: 同一 serverName+url 返回同一实例(seam 只取一次, 重连复用)`。

### 问题 4：抛错时的降级 —— **原实现无保护，已按 P1 级补上**

原实现没有任何 try/catch：`createAuthProvider` 内部抛错（如 name 为空串的断言）
会顺 `?.getAuthProvider(...)` 冒泡 → `connectGeneration` 的 try/catch 捕获 →
**整行 MCP 连接失败**。这比"没有 OAuth 但有静态 headers"严重得多。

**修法**（整个 `getAuthProvider` 体包进 try/catch，异常返 undefined + 记日志）：
```js
getAuthProvider(serverName, config) {
    try {
        ...
        return created;
    } catch (e) {
        // P1: 异常绝不冒泡到 startConnection
        fail(e);
        return undefined;      // 降级为无 authProvider → 静态 headers 兜底
    }
}
```
`resolveRowId` 内部也有独立 try/catch（它自己读文件，也要防）。

**测试**：
```
✔ 装配 P1: getAuthProvider 内部异常 → 返 undefined 不抛(降级为无 authProvider)
✔ 装配 P1: auth-store 文件不可读时 getAuthProvider 仍可用(auth-store 自身已收敛)
```

### 次要确认（两条都成立）

- `ctx` 在 P3 插入点作用域内可见：P3 插在 `connectGeneration`（`connection.ts:239` 的 async 函数），
  `ctx` 从 `startConnection(ctx, config, policy)` 闭包捕获 ✅
- 无同名 `authProvider` 声明冲突：`grep -n authProvider connection.ts` 只有 seam 自己那一行 ✅

### 修完后的回归（10 文件，112 用例）

```
test.mjs: pass 1 | test-routes.mjs: pass 1 | test-yaml-safety.mjs: pass 1
test-client-entry.mjs: pass 4 | test-auth-store.mjs: pass 30
test-oauth-provider.mjs: pass 22 | test-oauth-server.mjs: pass 24
test-oauth-wiring.mjs: pass 17 | test-oauth-ui.mjs: pass 9
test-oauth-reconnect.mjs: pass 9
```

### dry-run 复核（apply 前最后确认）

```
✅ P1 锚点唯一(未 patch)
✅ P2 锚点唯一(未 patch)
✅ P3 锚点唯一(未 patch)
确认无误后执行: ./scripts/patch-installed.sh --apply
```
bundle sha256 仍 `758d8fc473b700b5d351158d06ce9f9e92c16e8b25497b08bb7bd2122a87f5dd`，
`lib/` 下无 `.bak`（dry-run 未备份）。

---

## apply 前置两验证（用户 dry-run 审核追加）——全绿

**时间**：2026-10-21 12:30

### 验证 1：resolveRowId 在真实 patch 上跑一遍

真实 patch：`~/.dsh/profiles/web/cordis.patch.yml`（8 个 MCP 行，6 个 streamable-http）

**deps.patchPath 赋值来源**（`lib/index.js:1036-1038`）：
```js
patchPath: config?.patchPath
    ? String(config.patchPath)
    : (profileDir ? join(profileDir, "cordis.patch.yml") : null),
```
即：插件 config 显式给 `patchPath` 优先；否则 `profileDir/cordis.patch.yml`
（`profileDir` 又来自 `config.profileDir` 或 `resolveProfileDir(name)`）。
生产里 profileDir = `~/.dsh/profiles/web`，故 patchPath = 真实 patch 文件。

**每个 http 行的 (url, hit.length, rowId)**：
```
✅ serverName=cf-docs     url=https://docs.mcp.cloudflare.com/mcp     hit.length=1 → rowId=mcp-cf-docs
✅ serverName=cf-radar    url=https://radar.mcp.cloudflare.com/mcp    hit.length=1 → rowId=mcp-cf-radar
✅ serverName=cloudflare  url=https://mcp.cloudflare.com/mcp          hit.length=1 → rowId=mcp-cloudflare
✅ serverName=context7    url=https://mcp.context7.com/mcp            hit.length=1 → rowId=mcp-context7
✅ serverName=exa         url=https://mcp.exa.ai/mcp                  hit.length=1 → rowId=mcp-exa-search
✅ serverName=parallel    url=https://search.parallel.ai/mcp          hit.length=1 → rowId=mcp-parallel-search
映射异常行数: 0
```

**反向验证（原缺陷影响面）**：6 行的行 id 与 serverName **全部不同**：
```
❌ 不同  行id=mcp-cf-docs        serverName=cf-docs
❌ 不同  行id=mcp-cf-radar       serverName=cf-radar
❌ 不同  行id=mcp-cloudflare     serverName=cloudflare
❌ 不同  行id=mcp-context7       serverName=context7
❌ 不同  行id=mcp-exa-search     serverName=exa
❌ 不同  行id=mcp-parallel-search serverName=parallel
```
→ 原缺陷不是只影响 cloudflare 一行，**6 行全中**。

复跑命令（只读，不写文件）：
```bash
node ~/dsh-plugins-src/dsh-mcp-skill-hub/scripts/verify-rowid-real-patch.mjs
```

### 验证 2：try/catch 覆盖 readMcpRows 自身

**getAuthProvider 完整实现**（`lib/index.js`，`registerAuthService` 内）：
```js
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
		} catch (e) { fail(e); return undefined; }        // ← 2a: readMcpRows 的异常在这吞
	};
	const service = {
		authPath: deps.authPath,
		getAuthProvider(serverName, config) {
			try {
				const url = typeof config?.url === "string" ? config.url : "";
				if (!url) return undefined;
				const rowId = resolveRowId(String(serverName || ""), config);
				const key = rowId || String(serverName || "");
				if (!key) return undefined;
				const cacheKey = key + "\u0000" + url;
				let existing = byId.get(cacheKey);
				if (existing) return existing;
				const created = createAuthProvider({
					name: key, serverUrl: url, filePath: deps.authPath,
					staticHeaders: config?.headers || {},
				});
				byId.set(cacheKey, created);
				return created;
			} catch (e) {
				// P1: 异常绝不冒泡到 startConnection
				fail(e);
				return undefined;                          // ← 2b: createAuthProvider 的异常在这吞
			}
		},
		listKnown: () => [...byId.keys()],
	};
	try { ctx.provide("mcpAuth", service); } catch (e) { fail(e); }
}
```

三层故障注入实测（`scripts/verify-catch-coverage.mjs`）：
```
=== 2a: patch 文件不存在 → readMcpRows 抛 ENOENT → resolveRowId 吞掉 ===
✅ getAuthProvider 未抛错
✅ 仍返回 provider(退回 serverName 索引): yes
✅ 有 warn 日志记录(不静默): 1 条

=== 2b: config 异常形状(让 createAuthProvider 抛) → getAuthProvider 吞掉 ===
✅ getAuthProvider 未抛错
✅ 返回 undefined(降级): undefined

=== 2c: ctx.get 抛错(底座 ctx 异常) → 仍不冒泡 ===
✅ apply 本身未抛
✅ getAuthProvider 未抛

=== 2d: authPath 是目录(读必失败) → provider 仍构造成功 ===
✅ tokens() 未抛
✅ tokens() 返 undefined

fails: 0
```

三条确认：
- **a** `readMcpRows` 的异常在 `resolveRowId` 内被吞 → 返 `undefined`（2a 实测）
- **b** `createAuthProvider` 的异常在 `getAuthProvider` 内被吞 → 返 `undefined`（2b 实测）
- **c** 两层都不抛：连 `ctx.get` 抛错、`authPath` 是目录都不冒泡（2c/2d 实测）
  → 到达 `connectGeneration` 的要么是 provider 实例，要么是 `undefined`

复跑命令：
```bash
node ~/dsh-plugins-src/dsh-mcp-skill-hub/scripts/verify-catch-coverage.mjs
```

两个验证脚本已收进 Hub 的 `scripts/` 目录（不留在 /tmp，可复跑）。

---

<!-- 后续阶段条目追加在此上方 -->

---

## apply 完成：生产 bundle 已 patch（含审计 M1/M3 修复 + 脚本 2 个 bug 修复）

**时间**：2026-10-21 19:38 - 20:05 CST
**Hub 备份**：`~/.dsh/backups/hub-phase3f-20261021-193853`（598K / 51 文件 / 自校验通过）
**执行方式**：用户授权 agent 自主推进（原「由人执行」约束本次被显式解除）；
风险项已按铁律 3 派两个只读专家子代理独立评估后再动生产。

### 一、风险外派：两份只读审计（报告已进本节）

派了两个并行子代理，均为纯只读（未启动服务、未发请求、未改文件）：

1. **patch 脚本写坏风险审计** —— 抓到一个**阻断性 bug** 和一个空转校验（见第三节）。
2. **OAuth 安全边界审计** —— 抓到 **1 个中危**（M1 跨服务器凭据外发）、
   1 个中危（M2 revoke 不清 token）、1 个中危（M3 already-works 判定失效）。

### 二、审计发现并修掉的 2 个中危（各附先红后绿回归测试，铁律 9）

**M1（中危）：`resolveRowId` 降级键碰撞 → 跨服务器凭据外发**

- 缺陷：降级时 `key = rowId || String(serverName)`。若另一行的**行 id** 恰好等于
  某 serverName（如手写 `- id: github`），两行会共用同一 auth-store 条目 →
  A 行的 access_token 被 B 行的 provider 读出并**发往 B 的主机**。
- 另发现文档声称的防线 `auth-store.js:165` `getEntryForUrl()` **从未被任何 lib 代码调用**
  （全库 grep 只在测试中出现）——防串凭据实际没接线。
- 修法：降级键加前缀隔离 `degraded:<serverName>`，使降级键与行 id **在构造上不可能碰撞**。
- 回归（`test-oauth-wiring.mjs`，2 用例，先红后绿）：
  ```
  ✖ 装配 M1: 降级键加 degraded: 前缀…（旧实现挂）
  ✖ 装配 M1: 降级键不得等于任何 patch 行 id…（旧实现挂）
  ✔ 装配 M1: 降级键加 degraded: 前缀, 与行 id 不可能碰撞(防跨服务器凭据外发)
  ✔ 装配 M1: 降级键不得等于任何 patch 行 id(前缀隔离的结构性证明)
  ```
- 修复过程中自踩并修掉一个 **TDZ 变量遮蔽 bug**：初版在
  `getAuthProvider(serverName, config)` 内写 `const serverName = String(serverName || "")`
  → 同函数内 6 个既有用例全挂。已改名 `name0` 并显式保留
  「空 serverName → 返 undefined」语义（`createAuthProvider` 对空 name 有硬断言）。

**M3（中危）：`already-works` 探测用 mask 后的 headers → 所有静态 Token 行被迫走 OAuth**

- 缺陷：`readMcpRows` 返回的 `config.headers` 已被 `maskSecrets` 换成 `•••`，
  探测拿它请求必然失败 → 带静态 API Token 的 http 行永远判不出 already-works。
- 修法：`readMcpRows` 增加 `rawHeaders`/`rawEnv`（未 mask 原值，不参与 UI 渲染），
  探测改用 `row.rawHeaders || row.config?.headers || {}`。
- 回归（`test-oauth-server.mjs`，2 用例，先红后绿）：
  ```
  ✖ M3: 探测用 rawHeaders 原值…（旧实现挂：实际拿到 Authorization: '•••'）
  ✖ M3: 无 rawHeaders 时退回 config.headers(向后兼容)（旧实现挂）
  ✔ M3: 探测用 rawHeaders 原值, mask 后的 config.headers 不影响 already-works 判定
  ✔ M3: 无 rawHeaders 时退回 config.headers(向后兼容)
  ```

### 三、patch 脚本 2 个 bug（第一个是阻断性：脚本原本永远无法留下 patch）

**D-2（阻断性）：V4 第 4 锚点与第 1 锚点互为超串 → 每次 apply 成功都被自动回滚**

- 缺陷：V4 断言 `'createTransport(config, authProvider)'` 是第 1 锚点
  `'function createTransport(config, authProvider) {'` 的**超串**。patch 成功后
  该串出现 2 次（第 38 行签名 + 第 644 行调用）→ `n=2` → `VERIFY_FAIL=1`
  → 自动回滚 → exit 4。**脚本原本功能性死锁，且失败信息误导人去查 dsh。**
- 修法：第 4 锚点改为 `'transport = createTransport(config, authProvider);'`。

**D-2b（同上，第二层）：bash 单引号不展开 `\t`**

- 修 D-2 时一度把第 4 锚点写成 `'\t\t\ttransport = ...'`，bash 单引号内 `\t` 是
  反斜杠字面量 → 匹配不到任何东西 → `n=0` → 仍然必然回滚。
  **沙箱实测抓到**（`❌ V4 patch 形态缺失: \t\t\ttransport... (出现 0 次)`）。
- 修法：第 4 锚点**不含前导 tab**，脚本内已注释说明此坑。

**B：备份 sha256 自校验恒真**

- 缺陷：`sha256sum "$BAK" > "$BAK.sha256"` 再 `sha256sum -c` 是从备份自身算 hash
  → 恒真。磁盘满写出半个 `.bak` 时拦不住。
- 修法：改为与 patch 前已算好的 `BEFORE_SHA` 逐字节比对，不一致即删备份并 exit 2。

**沙箱实证（修复后脚本真的能留下 patch）**：
```
第一次 apply:  ✅ 3 处 hunk 全应用 → ✅ V1/V2/V3/V4 全过 → exit=0
              ✅ V4 patch 形态 ×4 全部 n=1
沙箱 bundle:   authProvider 出现 4 次（patch 真的留下）
第二次跑:      ✅ bundle 已是 patched 形态 —— 无需重复 patch（幂等）→ exit=0
```
（沙箱路径 `/data/data/com.termux/files/usr/tmp/opencode/blackbox`，含完整依赖 symlink 农场；
生产 bundle 全程未被沙箱测试触碰。）

### 四、apply 生产（3/3 hunk，V1-V4 全过）

```
bundle:     /data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js
sha256:     758d8fc473b700b5d351158d06ce9f9e92c16e8b25497b08bb7bd2122a87f5dd
        →   363a0265daf805588f5c20ee7f11cfdfc9c0881f01d05ecfa4a656706dd5ce30
大小:       35041 B → 35178 B (+137 B)
备份:       .../lib/index.js.bak-20261021T113912Z（sha256 = 上游原版 758d8fc4…，已核）
```

> ⚠️ **本 bundle 已 patch，非上游原版。dsh 升级（重装 @deepseek-ai/dsh-mcp-client）
> 后必须重新执行 `./scripts/patch-installed.sh --apply`，否则 OAuth 全链路失效。**

**seam 等价性最终证据**（`.bak` vs 现 bundle 完整 diff，仅 3 hunk / +4 -3 行）：
```diff
38c38
< function createTransport(config) {
---
> function createTransport(config, authProvider) {
46c46
< 		case "streamable-http": return new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers } });
---
> 		case "streamable-http": return new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers }, authProvider });
643c643,644
< 			transport = createTransport(config);
---
> 			const authProvider = ctx.get("mcpAuth", false)?.getAuthProvider(config.serverName, config);
> 			transport = createTransport(config, authProvider);
```

复跑命令：
```bash
B=/data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js
diff "$B.bak-20261021T113912Z" "$B"
sha256sum "$B" "$B.bak-20261021T113912Z"
```

### 五、apply 后验证（含 dsh 重启，均实测）

**stdio MCP 工具调用**（原「模糊说法」的确切命令，见 `APPLY-RUNBOOK.md` 第 8 步）：

fixture 自测（真实 MCP 客户端逐条流式收发）：
```
initialize  -> {'name': 'fixture', 'version': '1.0.0'}
tools/list  -> ['add']
tools/call  -> add(2,3) = 5
```

headless + 临时 patch 叠加跑真实 dsh：
```bash
cd /data/data/com.termux/files/usr/tmp/opencode && \
timeout 240 dsh headless --patch ./verify-patch.yml \
  "调用 mcp__fixture__add 工具，参数 a=2 b=3，把结果原样告诉我"
```
结果：`mcp-stdio-fixture` 的「initial connection or tool synchronization failed」
**不再出现**（首跑曾出现，根因是 fixture 用 `stdin.on('end')` 收集全量才处理，
与 MCP stdio 流式语义不符，已改为逐行流式）。剩余 `EACCES ... session.v4.jsonl.zstd`
是 headless profile 的会话落盘权限问题，与本 patch 无关。
→ **patch 后 bundle 的 stdio MCP 路径（连接 + tools/list + 同步）完整可用。**

**dsh 重启**：由守护脚本 `~/.config/opencode/kpad-dsh-web.cjs`（PPID=1）自动 respawn。
实测 dsh 正常服务：
```
$ curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:3080/?token=$(cat ~/.config/opencode/kpad-dsh.token)"
303
$ curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:3080/"
401
```
`~/dsh-web.log` 亦有 `dsh web: http://127.0.0.1:3080/?token=[REDACTED]`。
（注：Termux 的 `ss -tln` 看不到该 socket，是 Android 网络命名空间限制，非未监听——
曾据此误判过一轮，已用 curl 实证纠正。）

**Hub OAuth 路由真实注册 + authProvider 链路端点验证**：
```
GET /api/dsh-mcp-skill-hub/oauth/status?id=mcp-cloudflare → 200
GET /api/dsh-mcp-skill-hub/oauth/status?id=__nope__       → 404
GET /api/dsh-mcp-skill-hub/state                          → 200（对照组）
```
body（结构完全符合 `oauth-provider-contract.md` 契约）：
```json
{"id":"mcp-cloudflare","status":"not_authenticated","hasClientId":false,
 "hasTokens":false,"expiresAt":null,"pendingAgeSec":null,"inFlight":false}
```
（未注册路由会是 404，此处 200 证明路由已挂载；`id` 用 patch 行 id，与
`resolveRowId` 修 M1 后的口径一致。）

**全量回归（10 文件 / 122 用例，比 apply 前 112 多 10 = M1×2 + M3×2 + 修正 6）**：
```
test.mjs 1 | test-routes.mjs 1 | test-yaml-safety.mjs 1 | test-client-entry.mjs 4
test-auth-store.mjs 30 | test-oauth-provider.mjs 22 | test-oauth-server.mjs 26
test-oauth-wiring.mjs 19 | test-oauth-ui.mjs 9 | test-oauth-reconnect.mjs 9
合计 pass 122 / fail 0
```

**两个 apply 前验证脚本复跑（仍全绿）**：
```bash
node scripts/verify-rowid-real-patch.mjs   # 6 个 http 行 hit.length=1, 映射异常 0
node scripts/verify-catch-coverage.mjs     # 4 个故障注入场景 fails: 0
```
（`verify-rowid-real-patch.mjs` 尾部的「❌ 不同」是**反向证据段**，故意证明
6 行 id 与 serverName 全不同；通过判据是「映射异常行数: 0」。）

### 六、D-3 差异记录（未修，铁律 3 最小改动面）

审计指出：上游源码 `connection.ts:126` 在 `startConnection` 开头**一次性**取
`authProvider`；bundle patch 落在 `connectGeneration` 内（`:643`），**每次重连都重取**。

**决定不上移**，理由三条：
1. `getAuthProvider` 有 `byId` Map 缓存（`cacheKey = key + \0 + url`），
   重取返回**同一实例**，token 刷新态/in-flight 态/saveTokens 内容全部保留，
   实际行为等价（仅多一次 Map 查找）。
2. 上移需新增第 4 个 patch 锚点，扩大生产 bundle 改动面（违背最小改动面）。
3. 当前落点反而更稳：即使 `startConnection` 早于 Hub mount 导致首读 `undefined`
   （Cordis 顺序敏感，已实证），重连时仍能拿到 provider。

### 七、下一步：3b 真机授权（只有人能点浏览器）

见 `BROWSER-AUTH-STEPS.md`。三件待实测：
`expires_in` 实际值 / refresh 是否轮换 / `redirect_uri` 严格匹配。

### 八、两个 verify 脚本的路径与用途（用户第五节要求）

| 脚本 | 用途 | 复跑命令 |
|---|---|---|
| `scripts/verify-rowid-real-patch.mjs` | 用**真实** `~/.dsh/profiles/web/cordis.patch.yml` 的 6 个 http 行逐一跑 `resolveRowId`，证明每行 `hit.length=1`；尾部反向段证明 6 行 id 与 serverName 全不同（原 P0 口径断裂的影响面 = 全部 6 行） | `node scripts/verify-rowid-real-patch.mjs` |
| `scripts/verify-catch-coverage.mjs` | 4 个故障注入场景（patch 缺失 / createAuthProvider 抛 / ctx.get 抛 / authPath 是目录），证明异常绝不冒泡到 `startConnection`，且有 warn 不静默 | `node scripts/verify-catch-coverage.mjs` |

dsh 升级重打 patch 后可复跑这两个脚本确认 Hub 侧逻辑仍成立。

---

## UI 重做：授权入口改为「要授权的才显示」（用户反馈驱动）

**时间**：2026-10-21 20:10 - 20:45 CST
**Hub 备份**：`~/.dsh/backups/hub-phase3g-20261021-203006`（626K / 52 文件 / 自校验通过）

### 一、触发原因（用户原话）

> 「你的这个授权这一块有问题吧？你这所有的 mcp 怎么都是有授权按钮的？然后我也
> 没有看到你说的这个 CF 的 mcp，让我授权的，你把 UI 设计好」

**用户是对的，这是设计缺陷。** 原实现给**每一个** `streamable-http` 行都预渲染
「授权」按钮 + `AuthBadge`，而 web profile 的 6 个 http 行全部 `live=true`（正常工作），
没有一个需要 OAuth。用户看到 6 个莫名其妙的授权按钮，无从判断该点哪个。

### 二、学 opencode 的判定标准（实证，非猜测）

从 opencode 二进制提取其 `MCPStatus` 联合类型与判定逻辑：

```
MCPStatus = connected | disabled | failed | needs_auth | needs_client_registration
```

判定链（`catch` 块内）：
```
if (error instanceof UnauthorizedError || error.message.includes("OAuth")) {
  if (error.message.includes("registration") || error.message.includes("client_id")) {
    → needs_client_registration      // 服务端不支持 DCR
  } else {
    → needs_auth                     // 明确需要授权
  }
} else {
  → failed                           // 真失败
}
```

**核心原则：needs_auth 是「连接时真的拿到 401」的结论，不是预先假设。**

复跑命令（opencode 二进制在本机）：
```bash
B=~/.local/share/xucodex/opencode/bin/opencode
strings -n 6 "$B" | grep -oE '.{300}needs_auth.{300}' | head -3
```

### 三、改动（三处）

**1. `lib/oauth-server.js`：新增 `needsAuth` 探测（带 60s TTL 缓存）**

判定链（严格对齐 opencode，只认 401）：
| 条件 | needsAuth |
|---|---|
| store 已有 accessToken | `false`（省一次探测） |
| 探测静态 headers 得 2xx | `false`（静态 Token 已够用） |
| 探测得 **401** | **`true`** |
| 403 / 超时 / 不可达 | `false`（**不猜**，交给连接时报错） |

`/oauth/status` 响应新增 `needsAuth` 字段。60s TTL 缓存
（`NEEDS_AUTH_CACHE` / `NEEDS_AUTH_TTL_MS`）：UI 每 10s 轮询一次，
不缓存会对上游造成 3s 超时 × 6 行的持续压力。

**2. `lib/client.js`：授权入口移出主行，改为条件渲染的 auth-row**

- 新增 `needsAuth(row, authStatus)` 判定函数：
  ```js
  const needsAuth = (row, authStatus) => {
      if (!row?.editable) return false;
      if (row.config?.transport !== "streamable-http") return false;
      const s = authStatus?.[row.id];
      return s === "not_authenticated" || s === "expired" || s === "failed" || s === "pending";
  };
  ```
- 主行**只剩 `删除 + 开关`**（移除授权按钮与编辑按钮）：
  ```
  [绿点] mcp-context7 [HTTP] https://…  [live]  [开关] [删除]
  ```
- 未授权时**另起一行**（用户原话：「让他另起一行显示三个黄字未授权」）：
  ```
  ⚠ 该服务器需要 OAuth 授权后才能使用。            [授权]
  ```
  样式 `.dsh-hub-auth-row`（缩进 16px、虚线框、黄底）+ `.dsh-hub-auth-warn`（`#eab308`）。
- `AuthBadge` 收窄为「只显示已有授权状态」：`pending`/`authenticated`/`expired`/`failed`
  才渲染；`not_authenticated` 与 `already-works` **不渲染**（前者交给 auth-row 黄字，
  后者静态 Token 已够用无需任何 OAuth 信息）。

**3. 顺带修掉 M3 遗留**：`readMcpRows` 的 `rawHeaders` 已供探测使用
（见上一节），本轮探测直接复用，无二次改动。

### 四、回归测试（+10 用例，全部先红后绿，铁律 9）

**`test-oauth-ui.mjs`（9 → 13 用例）**：
```
✔ needsAuth: 只有明确 needs_auth 语义的状态才显示授权入口
✔ 源码: 主行只剩 删除 + 开关（授权按钮移出主行）
✔ 源码: auth-row 有黄字样式 + 缩进
✔ 渲染: AuthBadge 只显示有授权状态的行(not_authenticated/already-works 不渲染)
```
`needsAuth` 用例用 `new Function` **真实执行**判定函数（非源码 grep），
逐状态断言：`not_authenticated/expired/failed/pending → true`；
`authenticated/already-works/未探测 → false`；`stdio 行 → false`；`只读行 → false`。

**`test-oauth-server.mjs`（26 → 32 用例）**：
```
✔ needsAuth: 探测得 401 → needsAuth=true（真的需要授权）
✔ needsAuth: 探测得 2xx → needsAuth=false（静态 Token 已够用）
✔ needsAuth: 探测得 403/超时/不可达 → needsAuth=false（不猜，学 opencode 只认 401）
✔ needsAuth: store 已有 token → needsAuth=false（省一次探测）
✔ needsAuth: 60s TTL 缓存生效（UI 10s 轮询不打爆上游）
✔ needsAuth: status=authenticated/pending 时短路 false（不探测）
```

**先红后绿实证（三组破坏全部被测试抓住）**：
| 破坏 | 被抓用例 |
|---|---|
| `needsAuth` 恒 `true`（回到「所有 http 行都显示」旧缺陷） | `needsAuth: 只有明确 needs_auth 语义的状态才显示授权入口` |
| 探测结论恒 `true`（不学 opencode 的 401 判定） | `探测得 2xx → false` + `探测得 403/超时 → false` |
| 授权按钮挪回主行（违反「主行只剩删除+开关」） | `源码: 主行只剩 删除 + 开关` |

### 五、修掉的实现 bug（自踩）

**`row is not defined`（ReferenceError → 500）**：`statusHandler` 里
`requireRow(res, id)` 原本只用于校验、**丢弃返回值**，而 `probeNeedsAuth` 需要 row 的
url 与 rawHeaders。改为 `const row = requireRow(res, id); if (!row) return`。
（该 bug 让所有 `/oauth/status` 请求返 500，被 3 个老状态机用例当场抓住。）

**测试污染真实 `~/.dsh/mcp-auth.json`**：验证 `/oauth/start` 时 curl 了一次
`mcp-context7`，Hub 在其真实 authPath 落了个半截 pending（`codeVerifier` + `oauthState`，
**无 token**）。被 `test-oauth-wiring.mjs` 的防污染用例抓住：
```
✖ 装配: 测试全程不得在真实 ~/.dsh 下创建 mcp-auth.json（防污染）
```
已备份为 `~/.dsh/mcp-auth.json.bak-polluted-<ts>` 后删除，复跑 132/132 全绿。
**教训：对生产 authPath 的 `/oauth/start` 只能用只读端点（`/oauth/status`）验证。**

### 六、部署验证（真实 dsh，PID 6355）

symlink 确认 dsh 直接加载源目录：
```
~/.dsh/profiles/web/node_modules/dsh-mcp-skill-hub -> ../../../../dsh-plugins-src/dsh-mcp-skill-hub
```
重启后实测 6 个 http 行：
```
mcp-cf-docs            not_authenticated | needsAuth=False
mcp-cf-radar           not_authenticated | needsAuth=False
mcp-cloudflare         not_authenticated | needsAuth=False
mcp-context7           not_authenticated | needsAuth=False
mcp-exa-search         not_authenticated | needsAuth=False
mcp-parallel-search    not_authenticated | needsAuth=False
```

复跑命令：
```bash
for id in mcp-cf-docs mcp-cf-radar mcp-cloudflare mcp-context7 mcp-exa-search mcp-parallel-search; do
  curl -s "http://127.0.0.1:3080/api/dsh-mcp-skill-hub/oauth/status?id=$id"
done
```

→ **6 行全部 `needsAuth=false`，UI 上一个授权按钮都不显示**，正是用户要的效果。

**探测真实性证明（非恒 false）**：
```
stub 401   → probe = unauthorized
stub 200   → probe = ok
stub 403   → probe = other
stub throw → probe = unreachable
```

**UI 数据源健康**：`/state` 返 8 行（http 6 / stdio 2），`mcpAvailable: true`，
`rawHeaders` 字段已就位。

### 七、全量回归（10 文件 / 132 用例 / fail 0）

```
test.mjs 1 | test-routes.mjs 1 | test-yaml-safety.mjs 1 | test-client-entry.mjs 4
test-auth-store.mjs 30 | test-oauth-provider.mjs 22 | test-oauth-server.mjs 32
test-oauth-wiring.mjs 19 | test-oauth-ui.mjs 13 | test-oauth-reconnect.mjs 9
合计 pass 132 / fail 0
```

### 八、仍未验证 / 已知限制

1. **无浏览器可做渲染级截图验证**：Playwright 的 chromium 在磁盘清理时被删
   （`~/.cache/ms-playwright` 已清），系统无可用 chromium。UI 验证靠
   「真实 react 执行判定函数」+「真实 HTTP API 返回值」两级证据，**未做像素级截图**。
2. **`/oauth/start` 对 `needsAuth=false` 的行仍会启动授权流程**（用户显式调 API 时）。
   这是刻意保留的能力（用户有权主动授权一个探测不到 401 的服务），UI 不提供入口。
3. **3b 真机授权仍未做**：见 `BROWSER-AUTH-STEPS.md`。由于当前 6 行
   `needsAuth` 全 false，**UI 里不会出现任何授权入口**——若你要授权 Cloudflare，
   需先确认 `mcp.cloudflare.com` 探测是否真的返回 401（当前探测结论是「非 401」）。
   这一点与原先「Cloudflare 需要账号授权」的假设**相反**，值得在 3b 前重新评估。

---

## Playwright/Chromium 重装成功（子代理经 HK + server2 完成）+ Hub UI 面板仍未渲染

**时间**：2026-10-21 21:20 - 22:10 CST

### 一、结论

| 项 | 状态 | 证据等级 |
|---|---|---|
| Chromium 二进制落地并运行 | **达标** | **L1**（`--version` 实测输出） |
| CDP 协议可用 | **达标** | **L1**（`/json/version` + `Runtime.evaluate` 实测） |
| 截图能力（CDP `Page.captureScreenshot`） | **达标** | **L1**（1400x1000 PNG，1669 种颜色） |
| **Hub MCP 面板在浏览器里渲染出来** | **未达标** | L1（`hubRows=0` 实测） |

### 二、装不上的根因（此前我实测判定「网络全墙」，结论被部分推翻）

我此前实测 `cdn.playwright.dev` 与 `playwright.azureedge.net` 不通，判定「CDN 被墙」。
**子代理独立复验后给出更准确的根因**：

- `cdn.playwright.dev` 的 307 重定向目标 `playwright.download.prss.microsoft.com`
  **全局 NXDOMAIN**（HK 与 server2 用 8.8.8.8 / 1.1.1.1 双 DNS 查均为 NXDOMAIN，
  CNAME 指向 `sundry-star-net-geo-prss.trafficmanager.net` 但 A 记录不存在）。
  → **Playwright 官方 CDN 已死，不是墙的问题。**
- 本机 Termux 直连 `cdn.npmmirror.com` **可达**（206）——这是此前漏测的出口。
- `registry.npmmirror.com/-/binary/playwright/builds/chromium/1234/chromium-headless-shell-linux-arm64.zip`
  **可下**（116380215 B）。

下载 URL（复跑命令）：
```bash
curl -sL -o chromium-headless-shell-linux-arm64.zip \
  "https://registry.npmmirror.com/-/binary/playwright/builds/chromium/1234/chromium-headless-shell-linux-arm64.zip"
```

### 三、SSH 连通性矩阵（子代理实测，与我此前的「全不通」不同）

| 别名 | 结果 | 卡点 |
|---|---|---|
| `server2` / `s2` | **通** | CF 隧道 + ControlMaster 复用 |
| `HK` / `vps` | **通** | ProxyJump server2 → <internal-ip>，publickey 认证成功 |
| `HK-tunnel` | **通** | cloudflared ProxyCommand 正常 |
| `wuming` | **通** | exit 0 |
| `vps-direct` | 不通 | banner 成功后 `Connection closed by port 2222`（PerSourcePenalties） |
| `s2-direct` | 不通 | banner 成功后 kex/auth 挂死 |
| `sshmk` | 不通 | `kex_exchange_identification: Connection closed` |

**我此前判定「SSH 全不通」有误**：`HK-tunnel` 首次探测超时是 CF 隧道偶发，
重试后通。教训：单次超时不应上升为「墙」的结论（铁律 1：先读后写，勿以一次采样定论）。

### 四、安装产物与 glibc 补丁

```
~/.cache/ms-playwright/chromium_headless_shell-1234/chrome-linux/
  headless_shell          e8b500712730fd4cbd0261f675a27c5a79b2375276876f1e3f69db10ee080a72  314181896
  headless_shell.android  284c34a9082935b8d3d07545a74adf220a5bcd14ead02a69472a6c405977b1cd  314464625
```
zip sha256 `b03443e1e1a60d06e07b6cdfe650b8c2bfcbb3db497d2b652f73dc6912f4ae15`（本机与 server2 两端一致）。

原版二进制是 glibc 链接（`/lib/ld-linux-aarch64.so.1`），Android bionic 下报
`No such file or directory`。用 `grun -c`（patchelf 设 interpreter + RUNPATH）
生成 `headless_shell.android`，interpreter 指向
`/data/data/com.termux/files/usr/glibc/lib/ld-linux-aarch64.so.1`。

### 五、Chromium 运行实证（全部 L1）

```
$ grun ~/.cache/ms-playwright/chromium_headless_shell-1234/chrome-linux/headless_shell.android --version
Chromium 151.0.7922.34
```

**CDP 端到端**（`--remote-debugging-port` + Node 内置 WebSocket）：
```json
{"Browser": "HeadlessChrome/151.0.7922.34", "Protocol-Version": "1.3"}
```
```
Runtime.evaluate → textContent = "render-test"
Runtime.evaluate → color = "rgb(255, 0, 0)"
```

**关键 flag（实测必需，缺一则截图空白）**：
```
--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-gpu --headless
```
`--disable-dev-shm-usage` 是关键——Android 的 `/dev/shm` 受限，缺它 Chromium 静默失败。
（另有一个误导性报错 `ERROR:base/i18n/icu_util.cc:232] Invalid file descriptor to ICU data received`
 即使截图成功也会出现，**不代表失败**，别被它骗。）

**截图**：CDP `Page.captureScreenshot` 对 dsh UI 出 1400x1000 PNG（177322 bytes，
1669 种采样颜色，黑底深色主题）。注意 `--screenshot` CLI 模式实测出空白图，
必须走 CDP。

复跑命令：
```bash
bash /data/data/com.termux/files/usr/tmp/opencode/shots/shoot.sh "<url>" <out.png> [waitMs]
```

### 六、Hub MCP 面板仍未渲染（未达标，附排查过程）

实测证据（CDP `Runtime.evaluate` 读 DOM）：
```json
{"hubRows": 0, "authRows": 0, "authBtns": 0, "ids": [], "editBtns": 0, "delBtns": 0}
```

**已排除的原因**：
- Hub client **已加载**：`~/dsh-web.log` 有 8 条 `dsh-mcp-skill-hub webServer` 记录
- slot **兼容**：profile 用的第三方 `@linxin666/dsh-client-ui-web-ui-settings`
  也注册 `settings.section` slot（与 Hub 期望同名）
- 设置页**已进入**：点 Settings 后 `hasMcpSkills=true`（页面出现 "MCP & Skills" 文字）

**未解决**：section 文字出现但内容未展开（`hubRows=0`）。怀疑点：
1. section 是折叠态，需点 section 标题本身（已尝试点击，未展开）
2. `@deepseek-ai/dsh-client-{runtime,locale,ui-settings}` 三个依赖**均未安装**
   （`package.json` 声明了但 profile 用第三方替代），Hub client 的
   `inject: ["slots","locale"]` 可能部分失效
3. 首次运行向导（"Keep my settings"）每次新 profile 都会拦一次

**注意**：`opencode.json` 的 `playwright` MCP 指向**未打补丁的** `headless_shell`
（非 `.android`），该 MCP 仍起不来。要启用需把 `--executable-path` 改为
`headless_shell.android`——**这是配置变更，未做，待用户决定**。

### 七、本轮 UI 重做的验证状态（诚实对账）

| 验证项 | 状态 |
|---|---|
| `needsAuth` 判定逻辑（真实 react 执行） | ✅ 13 个 UI 测试覆盖 |
| `/oauth/status` 返回 `needsAuth` 字段（真实 HTTP） | ✅ 6 行实测全 false |
| 先红后绿（三组破坏） | ✅ 全部抓住 |
| **浏览器渲染级验证（截图 + DOM）** | ❌ **未达标**：Chromium 装好并能截图，但 Hub 面板未渲染出来 |

→ UI 重做的**逻辑层已验证**，**视觉层未验证**。要闭合需先解决第六节的
「设置页 section 不展开」问题。

---

## Hub UI 面板渲染打通（真实浏览器 CDP 验证）+ 修掉 2 个真 bug

**时间**：2026-10-21 22:55 - 23:50 CST
**Hub 备份**：`~/.dsh/backups/hub-phase3i-20261021-225503`（646K / 52 文件 / 自校验通过）

### 一、最终成果：Hub 面板在真实 dsh 里渲染成功（L2 证据）

CDP（Chromium 151.0.7922.34，跑在 Android/Termux 上）读取真实运行中的 dsh DOM：

```json
{
  "hubWrap": 1,
  "hubRows": 10,
  "ids": ["mcp-cf-docs","mcp-cf-radar","mcp-cloudflare","mcp-context7",
          "mcp-exa-search","mcp-parallel-search","mcp-playwright","mcp-ruflo"],
  "toggles": 8,
  "liveBadges": 8,
  "authBtns": 0,
  "editBtns": 0,
  "delBtns": 0,
  "panelVisible": true
}
```

→ **8 个 MCP 行全部渲染、8 个开关、8 个 live 徽章、0 个授权按钮、0 个编辑按钮。**
用户诉求（「要授权的才显示」「主行只要删除+开关」）在真实环境达成。

复跑命令：
```bash
D=~/.cache/ms-playwright/chromium_headless_shell-1234/chrome-linux
cd $D && ./headless_shell.android --no-sandbox --disable-setuid-sandbox \
  --disable-dev-shm-usage --disable-gpu --headless --window-size=1600,1000 \
  --remote-debugging-port=9408 about:blank &
node /data/data/com.termux/files/usr/tmp/opencode/shots/cdp-final3.mjs \
  "http://127.0.0.1:3080/?token=$(cat ~/.config/opencode/kpad-dsh.token)" \
  /data/data/com.termux/files/usr/tmp/opencode/shots/hub-final.png
```

### 二、修掉的 2 个真 bug（各附先红后绿回归测试）

**Bug 1（P0，UI 全白）：`auth-row` 写在 `rows.map` 回调外 → `row is not defined`**

- 位置：`lib/client.js` 的 `McpTab`。未授权提示行原写在 `] }, row.id))`
  **之后**，已退出 map 回调作用域 → 渲染抛 `ReferenceError: row is not defined`
  → 整个 `McpTab` 崩 → Hub 面板全白。
- 影响：**上一轮「UI 重做」的代码实际上是渲染不出来的**，只因当时无浏览器
  验证而漏掉。既有测试（源码 grep + 单独执行 `needsAuth`）抓不到作用域错误。
- 修法：把 auth-row 移回 map 回调内（`]` 之前），与主行同 key 前缀。
- 回归（`test-oauth-ui.mjs`，3 个新用例，真实 react 18 `renderToStaticMarkup`）：
  ```
  ✔ 渲染: 整个 McpTab 可渲染(auth-row 在 rows.map 作用域内)
  ✔ 渲染: needsAuth 全 false 时无授权按钮/无未授权行(用户诉求)
  ✔ 渲染: stdio 行永不出现授权入口(离屏渲染 + needsAuth 双重验证)
  ✔ 渲染: needsAuth=true 的判定链路(单元级, 不依赖 effect)
  ```
- **先红实证**：把 auth-row 挪回 map 外 → 5 个测试挂（含上述 4 个）；
  挪回 → 17/17 全绿。
- 离屏渲染复现（`renderToStaticMarkup`）：
  ```
  dsh-hub-row(主行): 8      dsh-hub-auth-row: 0
  授权按钮: 0               编辑按钮: 0
  删除按钮: 8               开关: 8
  行 id: 8 个全在
  ```

**Bug 2（P0，client 从未装载）：`package.json` 声明了未安装的依赖 → dsh 静默跳过整个 client**

- 位置：`package.json` 的 `dsh.client.inject` 原为
  `["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-client-locale", "@deepseek-ai/dsh-client-ui-settings"]`
- 根因：`@deepseek-ai/dsh-client-runtime` **未安装**（profile 用第三方
  `@linxin666/dsh-client-ui-web-ui-settings` 替代了官方 settings 体系）。
  dsh 装载 client 时解析 inject 依赖，**依赖缺失即静默跳过整个 client**
  （不报错、不加载、CSS 都不注入）。
- 实证：CDP 抓网络请求，`/plugins/??...` 的 57 个 client 入口里**没有 Hub**；
  前端 `index.js`（939KB）搜 `dsh-hub-row` **0 次**、`mcp-skill-hub` **0 次**。
- 修法：`inject` 改为只列**已安装**的包
  `["@deepseek-ai/dsh-client-locale", "@deepseek-ai/dsh-client-ui-settings"]`
  （Hub 代码只用 `ctx.slots` + `ctx.locale`，`exports.inject` 是服务名不受影响）。
- 修后实证：入口清单从 57 变 **58**，含 `[4] dsh-mcp-skill-hub/client.js`。

### 三、Chromium 落地的关键参数（Termux/Android 专用）

```bash
# 下载(npmmirror 可达, 官方 CDN 已 NXDOMAIN)
curl -sL -o chromium-headless-shell.zip \
  "https://registry.npmmirror.com/-/binary/playwright/builds/chromium/1234/chromium-headless-shell-linux-arm64.zip"

# glibc 二进制在 bionic 下需 patchelf(grun -c 生成 .android 变体)
grun -c ~/.cache/ms-playwright/chromium_headless_shell-1234/chrome-linux/headless_shell

# 运行必需 flag(缺 --disable-dev-shm-usage 则截图空白)
--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-gpu --headless
```

产物：
```
headless_shell          e8b500712730fd4cbd0261f675a27c5a79b2375276876f1e3f69db10ee080a72  314181896
headless_shell.android  284c34a9082935b8d3d07545a74adf220a5bcd14ead02a69472a6c405977b1cd  314464625
```
误导性报错（即使成功也出现，别被骗）：
`ERROR:base/i18n/icu_util.cc:232] Invalid file descriptor to ICU data received`

**截图必须走 CDP `Page.captureScreenshot`**，CLI 的 `--screenshot` 实测出空白图。

### 四、打开 Hub 面板的正确路径（dsh UI 操作，供人工复现）

侧边栏在折叠态时设置入口被并进 `More` 菜单；展开后才是独立的「设置」触发器
（官方类名 `VOzbGW_trigger`，中文文案「设置」/英文「Settings」）。

人工路径：**More → Settings → MCP & Skills**。

自动化等价路径（CDP 直接调 settings shell 的 action，绕过点击）：
```js
// 从 React fiber 找 SettingsRoot(靠 props.useSections 识别)
const a = sr.memoizedProps.actions   // { open, close, select, openSection }
a.open()                    // 打开设置面板
a.openSection('mcp-skill-hub')  // 选中 Hub section
```

**Hub 的 section 确实在 settings shell 的列表里**（CDP 读 hook 快照实证）：
```
["general","models","plugins","websearch","mcp-skill-hub",
 "agent-presets","market","sessionfix","better-sidebar","wallpaper-engine"]
```

### 五、全量回归（10 文件 / 136 用例 / fail 0）

```
test.mjs 1 | test-routes.mjs 1 | test-yaml-safety.mjs 1 | test-client-entry.mjs 4
test-auth-store.mjs 30 | test-oauth-provider.mjs 22 | test-oauth-server.mjs 32
test-oauth-wiring.mjs 19 | test-oauth-ui.mjs 17 | test-oauth-reconnect.mjs 9
合计 pass 136 / fail 0
```

### 六、仍未闭合（诚实对账）

1. **`needsAuth` 探测被墙骗**：`cloudflare.com` 在本机网络下不可达，探测返
   `unreachable` → 按 opencode 口径判 `false` → **Cloudflare 行的授权入口不显示**。
   用户明确说「全名 cloudflare 的那个应该是要的」。需改判定：
   `unreachable` 时应显示授权入口（带「探测失败」标注），而非静默隐藏。
2. **3b 真机授权仍未做**：见 `BROWSER-AUTH-STEPS.md`，被第 1 条阻塞。
3. `delBtns: 0` 是设计使然（删除需点一次出确认态），非缺陷。

---

## needsAuth 三态判定(修「探测被墙骗」+ 抓出过度渲染 bug)

**时间**：2026-10-22 06:26 - 07:20 CST
**Hub 备份**：`~/.dsh/backups/hub-phase3k-20261022-063546`（662K / 52 文件 / 自校验通过）

### 一、背景：用户反馈与探测结论相反

用户：「全名 cloudflare 那个应该是要（授权）的」。
但 6 个 http 行实测 `needsAuth` 全 `false` —— 因为 `cloudflare.com` 在本机网络不可达，
探测返 `unreachable`，旧逻辑按 opencode 口径判 `false`（不猜）。**用户判断是对的。**

### 二、修法：`needsAuth` 从二态改三态

`lib/oauth-server.js` 的 `probeNeedsAuth()` 判定链：
```
1. store 已有 accessToken       → false（已授权过）
2. 探测静态 headers 得 2xx       → false（静态 Token 已够用）
3. 探测得 401                    → true （明确需要授权）
4. 探测不可达(超时/DNS/连接失败)  → 'unknown' + probeFailed=true（不猜但也不隐藏）
5. 其它(403 等)                  → false（非 OAuth 需求）
```
`/oauth/status` 响应新增 `probeFailed` 布尔字段（供 UI 标注「探测失败」）。
新增 i18n 键 `authProbeFailed`（中/英）。

**理由**：静默判 false 会让授权入口永不出现，用户想授权也无从下手。`unknown`
时显示入口 + 黄字标「探测失败」，把决定权交还用户。

### 三、抓出并修掉：过度渲染 bug（P1）

第一版修完后真实浏览器验证：**6 个 http 行全挂授权按钮**（不是预期的 3 个）。

根因：UI 侧 `needsAuth()` 把 `not_authenticated` 状态直接判 true ——
```
if (s === "not_authenticated" || s === "expired" || ...) return true
```
`not_authenticated` 只表示「store 里没有 token」，**不等于需要授权**：
context7 / exa / parallel 也是这个状态但探测确认不需要（`needsAuth=false`）。

修法（`lib/client.js`）：**以 `needsAuth` 字段为第一依据**，
`authStatus` 只用来保留「授权流程中/失败/超时」的入口：
```js
const s = authStatus?.[row.id];
if (s === "expired" || s === "failed" || s === "pending") return true;  // 流程中
const n = needsAuthMap?.[row.id];
return n === true || n === "unknown";                                    // 探测结论
```
新增 `needsAuthMap` state，轮询时一并存 `/oauth/status.needsAuth`。

### 四、真实浏览器最终验证（CDP）

服务端探测结论：
```
mcp-cf-docs         needsAuth=unknown probeFailed=True
mcp-cf-radar        needsAuth=True    probeFailed=False
mcp-cloudflare      needsAuth=True    probeFailed=False   ← 用户点名的那行
mcp-context7        needsAuth=False   probeFailed=False
mcp-exa-search      needsAuth=False   probeFailed=False
mcp-parallel-search needsAuth=False   probeFailed=False
```
前端 DOM（`.dsh-hub-auth-row`）：
```
authRows: 3
authWarnText: [
  "Could not verify whether this server needs authorization (network unreachable). You can click Authorize to try manually.",   ← unknown
  "This server needs OAuth authorization before it can be used.",                                                              ← true
  "This server needs OAuth authorization before it can be used."                                                               ← true
]
authRowBtns: ["Authorize", "Authorize", "Authorize"]
```
→ **3 个显示（2 个真需要 + 1 个探测失败）、3 个不显示。符合设计。**

### 五、顺带修：防污染哨兵用例误判

`test-oauth-wiring.mjs` 的「不得创建真实 ~/.dsh/mcp-auth.json」用例挂了 ——
因为**生产 dsh 进程**有权在那里写 DCR `clientInfo`（实测 mcp-cloudflare /
mcp-cf-radar 会被写入），原断言「文件不存在」在运行中的系统上必然失败。

改法：哨兵记录基线 mtime，`test.after()` 钩子比对「mtime 未变」。
只保证**测试自身**不碰真实路径，不禁止生产写入。

先红实证：插入一个故意写真实路径的用例 → 哨兵 fail 1；删除 → 19/19。

### 六、全量回归（10 文件 / 137 用例 / fail 0）

```
test.mjs 1 | test-routes.mjs 1 | test-yaml-safety.mjs 1 | test-client-entry.mjs 4
test-auth-store.mjs 30 | test-oauth-provider.mjs 22 | test-oauth-server.mjs 33
test-oauth-wiring.mjs 19 | test-oauth-ui.mjs 17 | test-oauth-reconnect.mjs 9
合计 pass 137 / fail 0
```

---

## 测试 MCP 全链路验证 + 修掉 DCR 缺失(P0)与 client_secret_expires_at=0 误判

**时间**：2026-10-22 07:00 - 07:40 CST
**测试产物**：`fixtures/oauth-test-mcp.mjs`（保留，供回归复用）

### 一、测试 MCP 服务器（`fixtures/oauth-test-mcp.mjs`）

与 Cloudflare 远程 MCP 协议同构的本地授权服务器，零依赖：

| 端点 | 行为 |
|---|---|
| `POST /register` | RFC 7591 DCR，返 `client_secret_expires_at: 0` |
| `GET /authorize` | 授权页（Approve/Deny）；`?__act=approve\|deny\|auto=1` 无人值守 |
| `POST /token` | `authorization_code`（PKCE S256 校验）+ `refresh_token`（轮换） |
| `POST /mcp` | MCP Streamable HTTP；无/假 token → **401 + `www-authenticate`** |
| `GET /__state` `/POST /__reset` | 测试断言用 |

实现了真实协议细节：code 一次性、120s 过期、`redirect_uri` 严格匹配、
PKCE `SHA256(verifier) === challenge`、refresh 轮换作废旧 token。

### 二、抓出并修掉：Hub 完全没实现 DCR（P0）

**现象**：`/oauth/start` 返回的 authUrl **缺 `client_id`** → 测试授权页
400 `invalid_request`。

**根因**：`lib/oauth-server.js` 的 `startHandler` 用
`clientId: provider.clientInformation()?.client_id`，而 DCR 是 **dsh 的
mcp-client 库**在连接时才触发的（`ctx.get("mcpAuth")` 拿 provider 后自己驱动
MCP SDK auth 流程）。时序上 DCR 晚于 `/oauth/start`，所以首次授权必然缺
client_id。**Cloudflare 的 /authorize 要求 client_id，故此路不通。**

**修法**：provider 新增 `async registerClient()`（RFC 7591）：
- 已有未过期 `clientInfo` → 直接复用（幂等，不发 `/register`）
- 否则 `POST /register`，body 取 `clientMetadata`（`client_name` /
  `redirect_uris` / `token_endpoint_auth_method: none` / `grant_types` …）
- 结果经 `saveClientInformation()` 落盘
- `/oauth/start` 在构造 authUrl 前调它；DCR 失败**不阻断**授权
  （有的服务器纯 PKCE 不需要 client_id），仅把 `dcrError` 带回响应

**测试**（`test-oauth-provider.mjs`，4+2 个新用例，先红后绿）：
```
✔ registerClient: POST /register 并把结果落盘
✔ registerClient: 请求体符合 RFC 7591(client_name + redirect_uris + token_endpoint_auth_method=none)
✔ registerClient: 已有 clientInfo 时复用, 不再注册(幂等)
✔ registerClient: clientSecretExpiresAt 过期 → 重新注册
✔ clientInformation: client_secret_expires_at=0 表示永不过期(RFC 7591)
✔ clientInformation: client_secret_expires_at 已过去 → 视为未注册
```
先红实证：4 个 `registerClient` 用例在实现前全挂（`registerClient is not a function`）。

### 三、顺带修掉：`client_secret_expires_at: 0` 被误判为已过期

实现 `registerClient()` 时发现**幂等失效**——每次都重新 DCR。
根因：`clientInformation()` 的过期判断是
```js
if (Number.isFinite(info.clientSecretExpiresAt) && info.clientSecretExpiresAt <= now) return undefined
```
而 RFC 7591 规定 `client_secret_expires_at: 0` = **永不过期**（Cloudflare
真实响应就是这个值）。`0 <= now` 恒 true → 永远视为未注册。

修法：加 `> 0` 前置条件：
```js
if (Number.isFinite(info.clientSecretExpiresAt) && info.clientSecretExpiresAt > 0
  && info.clientSecretExpiresAt <= Math.floor(Date.now() / 1000)) return undefined
```

### 四、全链路验证结果（真实跑通，非 mock）

```
1. /oauth/start     → status=need-auth, authUrl 带 client_id=test-client-0f6e221c
                      redirect_uri=http://127.0.0.1:32935/mcp/oauth/callback
                      code_challenge_method=S256 + state + scope
2. 用户点 Approve   → 302 回调 → 页面「授权成功 可以关闭此窗口，回到 dsh。」
3. auth store       → access_token + refresh_token + scope + clientId 全落盘
                      pendingAt / oauthState 已清除
4. /oauth/status    → status=authenticated, hasTokens=true, needsAuth=false
5. 持 token 调 MCP  → tools/list 200(2 工具); tools/call add(2,3) → "5"
                      whoami → scope 正确传递
6. 假 token         → 401(鉴权真的生效)
7. refresh 轮换     → 新 at/rt 签发; add(7,8)="15"
                      旧 access_token → 401(已作废)
                      旧 refresh_token → invalid_grant(一次性)
8. 端到端(dsh 等价路径)
   复现 dsh-mcp-client/lib/index.js:643 的调用方式:
   ctx.get("mcpAuth").getAuthProvider(serverName, config) → provider.tokens()
   → Bearer 打 MCP → add(7,8) = 15 ✓
```

### 五、全量回归（10 文件 / 143 用例 / fail 0）

```
test.mjs 1 | test-routes.mjs 1 | test-yaml-safety.mjs 1 | test-client-entry.mjs 4
test-auth-store.mjs 30 | test-oauth-provider.mjs 28 | test-oauth-server.mjs 33
test-oauth-wiring.mjs 19 | test-oauth-ui.mjs 17 | test-oauth-reconnect.mjs 9
合计 pass 143 / fail 0
```

### 六、测试后清理（已全部完成）

- 杀 `fixtures/oauth-test-mcp.mjs` 进程（残留 0）
- `cordis.patch.yml` 恢复 `bak-pre-testmcp`（8 行，无 `mcp-oauth-test`）
- `~/.dsh/mcp-auth.json` 删 `mcp-oauth-test` 条目（备份 `.bak-testclean-*`），
  剩余 `['mcp-cloudflare', 'mcp-cf-radar']`
- 删 `~/.dsh/profiles/headless/node_modules/dsh-mcp-skill-hub` symlink
  （端到端测试临时加的）
- 重启 dsh 复核：`/state` 8 行、Cloudflare 两行 `needsAuth=true` 不变

### 七、结论与遗留

**OAuth 全链路已验证可用**。剩下的只是「真机授权」这一个动作：
Cloudflare 两行的授权入口已在 UI 上（黄字 + Authorize 按钮），点它即可。

遗留：`mcp-cf-docs` 因本机网络不可达仍走 `unknown`（显示授权入口 +
「探测失败」黄字），授权能否成功取决于运行环境能否连通
`docs.mcp.cloudflare.com`。

---

## 剩余项逐项交付（P0-1 / P1-4 / P2-6 / P2-7）

**时间**：2026-10-22 07:30 - 08:00 CST
**分级**：T2（触及生产 bundle `SOURCE/RUNTIME`、CONFIG 配置、跨模块）

### 一、3b 真机授权完成（原计划最后一个「阻塞」项）

用户真机完成 Cloudflare 授权。三件待实测全部有答案：

| 待实测项 | 实测答案 |
|---|---|
| `expires_in` 实际值 | 初次授权 **~8455s**（≈2.35h）；refresh 后 **3599s** |
| refresh 是否轮换 | **是**（新旧 access/refresh token 都不同；前 20 字符相同是 JWT header 相同造成的假象） |
| `redirect_uri` 严格匹配 | **是**（`example.com` → 400；127.0.0.1 动态端口 → 200） |

**Cloudflare 特殊行为**：refresh 后**旧 token 有宽容期**（旧 access_token 仍返 200）。

真机验收（持真 token 打 Cloudflare MCP）：
```
initialize      → 200  serverInfo: cloudflare-api
tools/list      → 200  4 工具(docs / search / execute / whoami)
tools/call whoami → {"id":"user:<redacted>…","email":"<redacted-email>"}
```
→ Token 归属与 AGENTS.md 记录的 CF 账号邮箱一致。

### 二、P0-1：`scripts/verify-patch-applied.sh`（升级检测）

**背景**：dsh 升级会 npm 重装 `@deepseek-ai/dsh-mcp-client` → patch 掉的 bundle
被换回上游原版 → Hub 的 provider 永不被调用 → **OAuth 静默失效**（无报错，
只是连接时 401）。

**设计**：检查三处**结构性特征**（不硬编码 sha256——那会在升级后误报且无法
区分「换回原版」与「内容相同的新版本」）：
```
1. function createTransport(config, authProvider)
2. requestInit: { headers: config.headers }, authProvider
3. ctx.get("mcpAuth", false)?.getAuthProvider(...)
```

**退出码契约**：
| code | 含义 |
|---|---|
| 0 | 已 patch（3/3 命中），附 sha256 |
| 1 | 未 patch / 半 patch（列出缺失项 + 修复命令） |
| 2 | bundle 文件不存在 |

**测试**（`test-verify-patch.mjs`，5 用例，先红后绿）：
```
✔ 已 patch 的 bundle → exit 0 + 报告 PATCHED
✔ 未 patch 的 bundle(上游原版) → exit 1 + 报告 NOT-PATCHED
✔ bundle 文件不存在 → exit 2 + 明确错误
✔ 只 patch 了一部分 → exit 1(不静默通过)
✔ 输出不得泄露 token/secret
```
先红实证：脚本不存在时 4/5 挂；实现后 5/5。

生产实测：
```
$ scripts/verify-patch-applied.sh
PATCHED: OAuth seam 完好 (3/3 特征命中)
  bundle: /data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js
  sha256: 363a0265daf805588f5c20ee7f11cfdfc9c0881f01d05ecfa4a656706dd5ce30
exit=0
```

### 三、P1-4：`test-oauth-fixture.mjs`（fixture 回归化，15 用例）

**关键设计**：起**真实 HTTP** fixture 服务器，不用 mock fetch。
理由：2026-10-22 抓到的 P0（authUrl 缺 client_id）正是 mock 抓不到的类型 ——
单测 `buildAuthorizeUrl` 永远绿，只有真打一个要求 client_id 的授权服务器才暴露。

覆盖（与 Cloudflare 协议同构）：
```
DCR        : /register 签 client_id + secret 永不过期(expires_at=0)
authorize  : 缺 code_challenge → 400
             method 非 S256 → 400
             approve → 302 带 code + state
             deny → 302 error=access_denied
token      : 正确 PKCE → access + refresh + scope
             PKCE 校验失败 → invalid_grant
             redirect_uri 不匹配 → invalid_grant
             code 一次性(重放 → invalid_grant)
refresh    : 轮换签发新 at/rt, 旧 at 作废, 旧 rt 一次性
MCP        : 无 token → 401 + www-authenticate 带 resource_metadata
             假 token → 401
             持真 token → initialize + tools/list + tools/call add(7,8)=15
             whoami 返回授权 scope(证明 scope 透传资源服务器)
端到端      : Hub provider → registerClient(幂等) → saveTokens → tokens() → 调 MCP add(20,22)=42
```

先红实证：删掉 `registerClient`（复现 P0）→ 端到端用例挂；恢复 → 15/15。

### 四、P2-6：playwright MCP `--executable-path` 修复

**背景**：`opencode.json` 的 playwright MCP 指向 `headless_shell`（glibc 版），
在 Termux/bionic 下**根本不能执行**：
```
$ headless_shell --version
cannot execute: required file not found      ← 缺 ld-linux-aarch64
$ headless_shell.android --version
Chromium 151.0.7922.34                        ← grun -c 打过 patchelf 的版本
```

**变更**（CONFIG，已备份 `opencode.json.bak-pre-pwpath`）：
```
- .../chrome-linux/headless_shell
+ .../chrome-linux/headless_shell.android
```

**独立验证**（不是「改了就算完成」）：
```
initialize      → serverInfo: Playwright 1.63.0-alpha-2026-08-05
browser_navigate → about:blank, 返回 snapshot 引用
browser_snapshot → Page URL: about:blank
```
→ **playwright MCP 端到端可用**。清理了产生的 `.playwright-mcp/` 临时目录。

### 五、P2-5：mcp-cf-radar 状态

`radar.mcp.cloudflare.com` 探测确认 **401**（真需要授权），与 cloudflare 同因。
授权动作需用户在浏览器完成（UI 上该行已有 Authorize 按钮），**未代操作**。

### 六、全量回归（11 文件 / 158 用例 / fail 0）

```
test.mjs 1 | test-routes.mjs 1 | test-yaml-safety.mjs 1 | test-client-entry.mjs 4
test-auth-store.mjs 30 | test-oauth-provider.mjs 28 | test-oauth-server.mjs 33
test-oauth-wiring.mjs 19 | test-oauth-ui.mjs 17 | test-oauth-reconnect.mjs 9
test-verify-patch.mjs 5 | test-oauth-fixture.mjs 15
合计 pass 158 / fail 0
```

### 七、状态落盘

`.project-state/state.json`（schema v1）记录 goal_ledger / decisions / risks /
protected_assets / evidence，供新会话续跑。

### 八、残余风险

1. **A1 未验证**：「dsh 升级会重装 mcp-client」是 npm 语义推断，首次升级时
   才能证实。届时跑 `verify-patch-applied.sh` 即可确认。
2. `mcp-cf-docs` 仍受本机网络限制（`unknown` 态）。
3. `mcp-cf-radar` 未授权（需用户操作）。

### 九、收尾对账时发现的实测：refresh_token 长期有效

收尾验证时 Cloudflare MCP 返 **401**（token 已过期 216 分钟）。用 store 里的
refresh_token 换新 token：

```
POST /token  grant_type=refresh_token  → HTTP 200
  expires_in = 3600
新 token 打 initialize → HTTP 200
```

**结论**：Cloudflare 的 `refresh_token` **长期有效**（access token 过期 3.6 小时后
仍可续期）。这证明 Hub 存底 refresh_token 是有价值的——用户授权一次，
后续 access token 过期可自动续，无需重新授权。

**未把新 token 写回 store**：store 由 dsh 进程管理（RUNTIME 态），手工写入会与
dsh 的内存态冲突。dsh 下次连接 `mcp-cloudflare` 时会自行 refresh
（Hub provider 的 `tokens()` 提供 refresh_token 给 MCP SDK）。

---

## Bug 审计 + 前端打磨（2026-10-22 08:10 - 08:40 CST）

**Hub 备份**：`~/.dsh/backups/hub-phase4-visual-20261022-*`
**方法**：systematic-debugging（Phase 1 证据收集 → Phase 4 修根因）+ CDP 定量视觉审计

### 一、抓到的 3 个真 bug（均附先红后绿测试）

**Bug A（P1，i18n 不一致）：controller 的 toast 恒显中文**

- 根因：`HubController.post()` 用 `tFallback()`（硬编码返 zh），而 React 组件用
  `props.t`（跟随 `ctx.locale`）→ **英文用户看到英文 UI + 中文 toast**
  （"已保存"/"已热生效"/"已移入 .trash"）。
- 修法：controller 增加 `setT()` / `tr()`；`apply()` 里用
  `ctx.locale.bind(NS)` 注入；未注入时退回 `tFallback`。
- 测试：`test-oauth-ui.mjs` 2 个（源码级：class 内不得有裸 tFallback 调用、
  须有 locale 注入入口）。**先红实证**：回退 `this.tr` → `tFallback` 即挂。

**Bug B（P2，并发 busy 覆盖）**

- 根因：`post()` 用单一布尔 `busy`。两个并发 post 时，先完成的把 `busy` 置回
  `false` → UI 误判空闲 → 用户重复提交（服务端有 `expectedMtimeMs` 乐观锁兜底，
  故为 UI 层瑕疵而非数据损坏）。
- 修法：`_inflight` 计数器，`busy = _inflight > 0`。
- 测试：源码级断言 `post()` 用 `_inflight` 且无裸 `busy: true/false`。

**Bug C（P1，可访问性）：tab 缺 role / 焦点环被禁**

- CDP 实测（打磨前）：`role` 无、`aria-selected` 无、CSS 无 `:focus` 规则。
- 修法：tab 加 `role="tab"` + `aria-selected` + 容器 `role="tablist"`；
  CSS 加 `:focus-visible{outline:2px solid #6366f1}`（不用 `outline:none`）。
- 测试：3 个源码级断言。

### 二、视觉打磨（依据 CDP computed style 实测，非猜测）

| 项 | 打磨前（实测） | 打磨后（实测） | 依据 |
|---|---|---|---|
| 开关触达区 | 34×19 px ❌ | **40×24 px ✅** | WCAG 2.2 目标尺寸 ≥24×24 |
| 正文字号 | 12px | **13px** | 与面板基准一致 |
| 11px 字号 | 3 处 | **0 处** | 最小可读下限 12px |
| auth-warn | 12px | **13px** | 重要提示应与正文同级 |
| btn padding | 3px 10px | **4px 12px** | 触达高度 |
| badge/when/group-title | 11px | 12px | 同上 |
| 行溢出 | 0 | 0 | 无回归 |
| 焦点环 | MISSING | **PRESENT** | 键盘可用性 |
| tab role/aria | 缺 | `["tab","tab"]`/`["true","false"]` | 读屏可用 |

最终 CDP 复核输出：
```json
{
  "面板存在": true, "行数": 11,
  "tabRole": ["tab","tab"], "tabAria": ["true","false"],
  "行盒": {"w":564,"h":94}, "行溢出数": 0,
  "开关盒": {"w":40,"h":24}, "开关触达": "OK",
  "文字": {"color":"rgb(15, 17, 21)","size":"13px"},
  "focus环": "PRESENT"
}
```

### 三、审计过但**不是** bug 的项（留档避免重复排查）

1. **i18n key 缺失**：初判「33 个 key 缺失」→ 实为正则把**值内的冒号**
  误判为 key 边界。用 node eval 词典字面量复验：zh=61 / en=61，
   仅 `style` 命中且是 `document.createElement("style")` 误报。**i18n 完整**。
2. **skills/state 路由缺失**：`client.js` 调的 `/skills/*`、`/state` 在
   `oauth-server.js` grep 不到 → 实为注册在 `lib/index.js:943-1040`。**路由齐全**。
3. **只读行含删除按钮**：离屏渲染切段误判（跨过了行边界）。精确切分后：
   只读行**无** del、**无** toggle。**行为正确**。
4. **XSS**：无 `dangerouslySetInnerHTML`、无 `innerHTML`，全走 React 转义。
5. **错误信息泄露路径**：服务端 error 消息仅 2 种，均不含内部路径。

### 四、全量回归（12 文件 / 172 用例 / fail 0）

```
test.mjs 1 | test-routes.mjs 1 | test-yaml-safety.mjs 1 | test-client-entry.mjs 4
test-auth-store.mjs 30 | test-oauth-provider.mjs 28 | test-oauth-server.mjs 33
test-oauth-wiring.mjs 19 | test-oauth-ui.mjs 26 | test-oauth-reconnect.mjs 9
test-verify-patch.mjs 5 | test-oauth-fixture.mjs 15
合计 pass 172 / fail 0
```

---

## 加入 dsh-plugin-hub + npm 发布准备（2026-10-22 16:30 - 16:50 CST）

### 一、加入 `~/dsh-plugin-hub`（插件索引仓库）

`~/dsh-plugin-hub/README.md` §2「本地源码安装」新增 `dsh-mcp-skill-hub` 条目
（纯新增 21 行，无删改；备份 `hub-README.md.bak-pre-mcpskillhub`）。

写入前逐条实证，**修正了两处初稿错误**：
1. `rollback-installed.sh` 初稿写成无参调用 → 实为**必须传 `<bak-path>`**
   （无参 exit 1）。已改为 `scripts/rollback-installed.sh <bak-path>`。
2. 安装命令初稿用 `file:` → 实证本机 profile 用的是 `link:` 协议
   （`package.json:20` `"dsh-mcp-skill-hub": "link:/data/.../dsh-mcp-skill-hub"`）。
   已改为 `link:`，并注明「link: 与 file: 均可」。
3. 「Node ≥ 20」无据（package.json 无 engines 声明）→ 改为实证说法
   「本机实测 Node 26 / dsh 0.2.1-alpha.5」。

同时确认 Hub **不属于** `@240xu/dsh-suite`（suite 只聚合 4 个 npm 包，Hub 是本地源码插件）。

### 二、npm 发布准备：package.json 补齐元数据 + files 白名单

新增 `license: MIT` / `author: 240xu` / `keywords` / **`files` 白名单**。

白名单**排除**（§11 CONTENT-SCAN 结果）：
- `.project-state/`（内部状态，含服务器 IP）
- `PROGRESS.md`（2573 行，含 `<internal-ip>` 等内部 IP、脱敏 token 片段）
- `PRINCIPLES.md`（项目宪法，非用户需要）

白名单**保留** `test-*.mjs`（铁律 9 的回归资产，用户可自检）。

敏感扫描结论：无真实 token 值落盘（`Bearer static-token` 是 fixture 假值；
`user:<redacted>…` 已截断）。

### 三、⚠️ 关键实证：**不能加 @240xu scope**

尝试 `name: "@240xu/dsh-mcp-skill-hub"` 后重启 dsh，CDP 抓 client 入口清单：

```
改名后:  [0] @240xu/dsh-devkit  [1] @240xu/dsh-message-ops  [10] @240xu/dsh-websearch
         [11] @240xu/sessionfix   ← Hub 不在列(58 → 57 入口)
回退后:  [4] dsh-mcp-skill-hub/client.js   ← 恢复(58 入口)
```

**根因**：dsh 的 client 装载按 **profile `package.json` 的依赖名**解析
（`"dsh-mcp-skill-hub": "link:..."` + symlink 目录名 `dsh-mcp-skill-hub`）。
package.json 内 `name` 改成带 scope 后与之不匹配 → **整个 client 被静默跳过**
（与 2026-10-22 早先 `dsh.client.inject` 声明未安装依赖导致的黑屏**同一失败模式**：
dsh 对 client 装载失败**不报错**）。

**结论**：`name` 必须保持 `dsh-mcp-skill-hub`。要上 npm 就得接受**无 scope 包名**
（与 hub README 里的 `dsh-agent-alliance` 同形态），或先改 profile 依赖名 + symlink
目录名（改动面扩大到 dsh 运行时配置，未做）。

### 四、顺带修：`scripts/phase0-backup.sh` 断言写死测试数量

```
中止：期望 10 个 *.mjs 测试文件，实际 12 个
```

`MJS_COUNT -ne 10` 写死上限 → 每次新增测试文件都让备份脚本中止，与铁律 9
「修复须附测试」方向相反。改为 `-lt 10`（保留下限，放开上限）。

---

## npm 发布完成 + hub README 更新（2026-10-22 16:50 - 17:20 CST）

### 一、发布结果（三次迭代，每次都有独立 REMOTE-VERIFY）

| 版本 | 内容 | shasum |
|---|---|---|
| 0.1.0 | 首次发布（元数据补齐 + files 白名单） | `c7c2b47d63e9bb6bd4c7b1c79fb354223fdd22e6` |
| 0.1.1 | fixture 端口加固（`PORT=0` + `__LISTENING__` 回传） | `d0abba6b37d72e5dc7f3b4d3ce41eabb0eb23e68` |
| **0.1.2** | `test.mjs` 依赖解耦 + `.test/` 目录自建 | `e056b78a36528294789aaa51717e9b15c7f16ca3` |

**REMOTE-VERIFY（0.1.2，全部通过）**：
```
version = 0.1.2 · dist.shasum 与发布时逐字符一致 · fileCount 33 · license MIT
干净目录 npm install → added 1 package
包内跑全部测试    → pass 172 / fail 0
```

### 二、发布过程中抓到的 2 个真缺陷（都由「包内跑测试」暴露）

**缺陷 1（P1）：`test.mjs` 硬编码绝对路径 import**
```js
import { parse as parseYaml } from "/data/.../opencode/node_modules/yaml/dist/index.js";
```
→ 用户装包后跑测试直接 `ERR_MODULE_NOT_FOUND`（该路径不在 npm 包里）。
**修法**：多路径探测（dsh 自带 yaml 优先 → opencode 的 → 最小兜底解析器），
找不到时打印警告**不静默降级**。

**缺陷 2（P2）：`test.mjs` 写 `.test/patch.yml` 前不建目录**
→ 独立目录/新克隆首次跑即 `ENOENT`。已补 `mkdirSync(dirname(TMP), {recursive:true})`。
两处修复后隔离目录复跑通过。

**方法论价值**：这两个缺陷**本地跑永远发现不了**（本地两个路径都存在）。
是「在 npm 装下来的包里跑测试」这一步暴露的 —— 印证 §11 REMOTE-VERIFY 不可省。

### 三、npm 的 stage 机制（首次遇到）

`npm publish` 后 `npm view version` 短时间内返回 **`0.0.0-stage`**
（description 为 "Temporary package placeholder for staged publishing"），
maintainer 是自己、`created` 时间就是发布时间。**不是包名被占用**，是 staging 中转态。
实测 60-90 秒转正（0.1.2 耗时约 8.5 分钟）。

### 四、hub README：Hub 条目从 §2 移到 §1

`~/dsh-plugin-hub/README.md`：
- §1「自维护插件（npm）」新增 `dsh-mcp-skill-hub` 条目（纯新增 24 行）
- §2「本地源码安装」的旧条目已移除
- 附注两条：**补丁需先打**（否则 OAuth 不生效）、**包名不能加 @240xu scope**

### 五、为什么包名不能加 @240xu scope（实证）

改名 `@240xu/dsh-mcp-skill-hub` 后重启 dsh，CDP 抓 client 入口清单：
```
改名后: @240xu/dsh-devkit [0] · @240xu/dsh-message-ops [1] · @240xu/dsh-websearch [10]
        @240xu/sessionfix [11]          ← Hub 不在列(58 → 57 入口)
回退后: dsh-mcp-skill-hub/client.js [4] ← 恢复(58 入口)
```
**根因**：dsh 按 profile `package.json` 依赖名 + `node_modules` 目录名解析 client，
package.json 内 `name` 与之不匹配 → **整个 client 被静默跳过**（不报错）。
这与 `dsh.client.inject` 声明未安装依赖导致的黑屏是**同一失败模式**。

### 六、生产未改（有意）

profile 仍用 `link:` 本地源码（`package.json:20`），**未**执行
`dsh plugin --profile web add dsh-mcp-skill-hub`。理由：本地 link 版工作正常，
且正在开发中的改动需要即时生效。npm 包与本地版已实证等价（包内 172/172）。

---

## README 重写 + 0.1.3 发布（2026-10-22 19:20 - 19:40 CST）

### 一、动机

用户问「是即装即用的 npm 吗」→ 发现 README 仍是早期版本（安装节写「已完成」、
缺 OAuth 全部说明），且没回答「哪些即装即用、哪些要补丁」。

### 二、README 重写（31 → 161 行）

新增/修正：
- **即装即用范围明确化**：面板 + 增删改启停 + Skills 管理 = 即装即用；
  只有 OAuth 换 token 需补丁。
- **「⚠️ OAuth 需要先打补丁(为什么)」节**：写入三方分工表 + SDK 源码实证
  （`handleOAuthUnauthorized` / `auth()` 的自动恢复逻辑）+ 3 行 diff。
- API 路由表补全（9 条，含 `/oauth/cancel`、`/oauth/callback`）。
- 测试节改为 `node --test test-*.mjs`（12 文件 / 172 用例）。
- 卸载节更新为 `dsh plugin remove`。

### 三、写作前逐条实证（修正 2 处初稿错误）

| 初稿 | 实证后 |
|---|---|
| provider 实现「11 个成员」 | 实为 **16 个**（10 SDK 契约 + 6 Hub 扩展），已列出全部名单 |
| Node ≥ 18.8 无据 | 依据：`test.before/after` 用在 8 处（Node 18.8.0 引入）+ 全局 `fetch`（18.0） |

API method 全部核对通过（9/9 与实际注册一致）。

### 四、0.1.3 发布

```
shasum: a414225325d2dc1f0e37ef717ab8077ad5c1977b · 33 文件 · 126.7 kB
REMOTE-VERIFY: 版本/shasum 一致 · 干净安装成功 ·
               包内 README 含 9 处新内容、0 处旧标志
```

### 五、hub 索引仓库同步

`~/dsh-plugin-hub/README.md` 的 Hub 条目补「即装即用范围」段 + SDK 三方分工 diff，
让用户在看索引时就知道要补丁。

### 六、dsh 对需授权 MCP 的原本行为（本次调查结论）

**上游 mcp-client 完全没有 OAuth 逻辑**（bundle 内 grep `oauth`/`401`/`Unauthorized`
0 命中）。SDK 2.2.0 原生完整支持（`OAuthClientProvider` × 308、`UnauthorizedError`
× 135、`discoverOAuthProtectedResourceMetadata` × 21、`startAuthorization` × 19），
但 `authProvider` 是**可选参数**，dsh 不传 → SDK 走无鉴权路径 → 401 直接抛错。

故补丁只有 3 行，却激活了 SDK 内置的整套自动恢复：
`invalidateCredentials("client")` 重新 DCR、`invalidateCredentials("tokens")`
重新授权、401 重试、403 `insufficient_scope` step-up、`determineScope()` 自动追加
`offline_access`。Hub 的 provider 实现这些回调即可，token 自动刷新由 SDK 驱动。

---

## 0.2.0 即装即用 —— 运行时自愈(2026-10-22 21:30 - 22:10 CST)

### 一、postinstall 方案被 npm 12 阻断(实证)

装了 postinstall 后从 tarball 真实安装, 发现 `npm install-scripts ls` 报:

```
1 package has install scripts blocked because they are not covered by allowScripts:
  dsh-mcp-skill-hub@0.2.0 (postinstall: node scripts/postinstall.mjs)
```

查 npm 官方文档确认: **npm 12 起默认阻止依赖的 install scripts**
(preinstall/install/postinstall/prepare), 需 `npm install-scripts approve`
或 `--allow-scripts=` 或 `npm config set allow-scripts`。
→ postinstall 不可能全自动, 方案作废(代码保留作辅助路径)。

### 二、改为运行时自愈(用户选定)

新增 `lib/self-heal.mjs` + `apply()` 内调度:

```js
scheduleOauthSeamSelfHeal()   // setTimeout(0) 延 tick, try/catch 包裹, 失败不阻塞启动
```

安全性(改的是第三方包 @deepseek-ai/dsh-mcp-client):
1. **幂等** —— 已 patch 只读不写(启动开销 = 一次文件读取)
2. **必留备份** —— `.bak-selfheal`, 内容与上游原版逐字节一致
3. **写后校验** —— 逐锚点确认, 任一不符立即恢复原文件
4. **永不抛异常** —— 调用方是 dsh 启动路径
5. **可关** —— `DSH_MCP_SKILL_HUB_NO_SELF_HEAL=1`

### 三、实测抓到的 bug: ANCHORS 缩进漂移

初版把 P3+P4 的 `to` 写成 **4 tab**(真实 bundle 是 **3 tab**),
导致**已 patch 的生产 bundle 被误判为「锚点 P3+P4 未命中」**。
测试没抓到, 因为测试全用上游原版 bundle, 从没测过「已 patch + 缩进错」组合。

修法 + 防回归(两个新用例, 已实证先红):
- 场景 6: 对**真实生产 bundle**跑自愈, 断言 `already` 且零改动
- 场景 6b: 解析 ANCHORS, 逐条断言 `to` 出现在真实 patched bundle 里

先红实证: 注入 4-tab bug → 2 用例挂; 恢复 → 9/9 绿。

### 四、测试与验证

- `test-postinstall.mjs` 7 用例 + `test-self-heal.mjs` 10 用例, 连跑 3 次无顺序依赖
- 全量: **14 文件 / 190 用例全绿**
- 端到端(假 bundle): `apply()` → 自愈 → 三锚点全中 + 备份生成
- 生产(真实 dsh 重启 PID 29991 → 23481): bundle 仍 3/3、
  **无 .bak-selfheal 误生成**(幂等证据)、Hub API 200、OAuth status 正常
- 假 dsh 环境真实安装 tarball: 触发 allowScripts 阻断, 证实 postinstall 被挡

### 五、已知遗留(非本次范围)

`mcp-cloudflare` 的 `status: expired`(access token 过期 790 分钟)但
`needsAuth: false`。根因: `statusOf()` 只读文件判断, 不主动刷新;
SDK 的 refresh 是**懒触发**(下次发请求才刷)。store 里 refreshToken +
clientInfo 都在, 一旦 dsh 向该 MCP 发请求即会自动刷新。
不影响自愈功能本身。

---

## 0.3.0 全部 P0/P1/P2 修复（2026-10-23 22:10 - 23:40 CST）

### 一、触发：四路并行子代理深挖

派 4 个独立子代理（安全面 / 升级失效 / npm 安装链路 / OAuth 时序），
产出 2318 行报告。**其中 2 个 P0 直接推翻 0.2.0 的设计**。

### 二、两个 P0 级根因

**P0-1（安装链路）**：`scripts.postinstall` 让 pnpm 11 报
`ERR_PNPM_IGNORED_BUILDS` → `dsh plugin add` exit 1。dsh 的 CLI 路径不传
`approvedBuilds`（只有 Web UI 传），所以命令行用户卡死且无提示。
→ 修法：删掉 `scripts.postinstall`（自愈已覆盖同一语义），`files` 白名单
  从整目录改成精确 4 个 shell 脚本。npm 12 也实证会阻止依赖的 install scripts。

**P0-D（OAuth 功能根因）**：`setRedirectUrl` 只在 `/oauth/start` 的临时
provider 上调用，而 SDK 每请求实际用的 provider 来自
`registerAuthService().getAuthProvider()` —— 这条链上没有任何
setRedirectUrl。SDK 判 `nonInteractiveFlow = !provider.redirectUrl` 恒真，
进 `fetchToken()` 必抛，**永远到不了 refresh_token 分支**。
→ 一变量对照实验证实（同一 provider，只加一行 setRedirectUrl，
  `auth()` 从 `THREW` 变 `AUTHORIZED` 且真的刷了）。
→ 修法：`index.js` 的 `getAuthProvider()` 创建后补一行占位 redirectUrl。

### 三、P0-2：失败不再静默

`anchor-missing` / `not-applicable` / `corrupt` / `verify-failed` 以前静默
`return { ok: true }`，dsh 升级后 OAuth 死了而 UI 还显示「已授权」。
→ 现在必须 `alarm()`（默认写 stderr）+ `/oauth/status` 回报 `seam` 字段 +
  UI 顶部红色横幅（`SeamBanner`，7 个 i18n 键 × 中英）。

### 四、self-heal 加固（P1-1/2/3/4/5/6/7 + P2-1/2）

| 项 | 修法 |
|---|---|
| P1-1 半写 | tmp + `renameSync()` 原子替换 |
| P1-2 并发 | O_EXCL 锁 + 30s 陈旧锁可夺 |
| P1-3 损坏检出 | NUL / 过小 / 括号不配对 / **末行非 `};`** / 未闭合注释 |
| P1-4 备份失配 | sha 比对不同源 → 换时间戳命名 + `.sha256` sidecar |
| P1-5 启动阻塞 | `execFile` 异步化（原 `execSync` 冻结事件循环 0.3–5s） |
| P1-6 判定 bug | `anchorMissing` 不再依赖 `anyTo`（全漂移时旧版返回 null） |
| P1-7 锚点漂移 | `FALLBACKS` 短特征片段兜底（prettier 重排后仍能 patch） |
| P2-1 元数据 | `.patch-state.json` sidecar（版本 / 前后 sha / 时间 / 锚点） |
| P2-2 symlink | `lstatSync` 过滤 + `realpathSync` 归一化 |

### 五、P0-3：rollback 不再不可隔离

`rollback-installed.sh` 的 `PKG_DIR` 曾硬编码生产路径（审计任务已实际踩中，
把生产 bundle 滚回上游原版）。现在：
- `DSH_MCP_CLIENT_PKG_DIR` / `DSH_MCP_CLIENT_BUNDLE` 可覆盖
- **版本闸门**：备份与当前 dsh-mcp-client 版本不一致 → exit 4 拒绝
  （sha 自比对只能证明「写入成功」，证不了「版本正确」）
- 实测：同版本放行 / 不同版本拦住 / 生产零接触

### 六、测试（TDD 先红后绿）

- `test-oauth-refresh.mjs` 7 用例：组1 对照（无 redirectUrl → 抛错）/
  组2 修复目标 / 组3 / 2 个 P0-D 产品路径回归（`__internals.registerAuthService`）
- `test-self-heal.mjs` 23 用例：新增 P1-3 ×2 / P0-2 ×2 / P1-1 / P1-2 /
  P1-4 ×2 / P2-1 / P1-7 / P1-6
- `test-oauth-ui.mjs` 31 用例：新增 seam 横幅 5 个
- **全量 216/216 全绿**；`scripts/run-tests.sh` 固化（含 `--test-force-exit`，
  否则起过 HTTP server 的测试文件会让 `node --test` 挂 149s）

修了一个**既有测试缺陷**：`test-auth-store.mjs` 的「并入真实结构数据」把
opencode 真实凭据 merge 进 fixture 后仍用写死值断言，真实数据一刷新就红
（2026-10-23 踩中）。改为结构断言 + 只对 fixture 独有键做值断言。

### 七、真机验证

- dsh 重启（PID 20462 → 14605），`/oauth/status` 回报
  `seam.status = "already"` + `via: "npm-prefix"` + 路径
- **生产 store 的 `expiresAt` 从「13 小时前」变成「未来 1 小时」**
  → P0-D 修复在真实数据上生效的最强证据（修复前刷新从未发生过）
- 沙箱复验：生产 store 副本 + 真实 Hub provider + 真实 SDK →
  `auth() = AUTHORIZED`、token 轮换、`expiresAt` 上移、生产文件零写入
- 生产 bundle 3/3、无 `.selfheal.lock` / `.tmp` / `.bak-selfheal` 残留
- P0-3 隔离模式实测：版本闸门放行/拦截、生产 sha 全程不变

### 八、审计期间的两次生产 bundle 事故（已恢复）

子代理 B 执行 `rollback-installed.sh` 时因脚本硬编码生产路径，把生产 bundle
滚回上游原版；子代理 C 的 npm 实验让 npm 12 静默执行了 postinstall。
两次都已用 `patch-installed.sh --apply` 恢复，当前 sha256
`363a0265daf805588f5c20ee7f11cfdfc9c0881f01d05ecfa4a656706dd5ce30`、3/3 命中。
**这两次事故本身就是 P0-3 与 P0-1 的实证**。

---

## 0.3.2 前端打磨（2026-10-24 14:00 - 14:30 CST）

### 一、先跑门镜再动手（design-doctrine 教义）

诊断出的客观缺陷（非目测）：

| # | 缺陷 | 门镜证据 |
|---|---|---|
| 1 | 9 个 emoji/pictograph 混在 UI 文案与注释 | `check_no_emoji.py` FAIL ×7 行 |
| 2 | 76 处硬编码，含 6 个裸 hex | `lint_hardcodes.py` |
| 3 | 焦点环硬编码 `#6366f1` | dsh 无此品牌色，与宿主不一致 |
| 4 | 状态色裸 hex（`#22c55e`/`#eab308`/`#ef4444`） | dsh 有完整语义 token 却没用 |

### 二、Taste preflight（建前先写）

```
Domain: dev-tool（dsh 设置面板内的一个分区）
Mood: "precise" —— 与宿主同一视觉语言，看不出是第三方插件
Motion: none（设置面板只有开关 150ms 位移）
Reference: dsh 自己的 settings card（--dsw-alias-settings-card-fill/-stroke）
```

### 三、修复

1. **去 emoji**：加 `Icon` 组件（lucide 风格内联 SVG，`currentColor`，`aria-hidden`），
   三个图标 zap/warn/x。SSR 下实测产出 `<path>`（`dangerouslySetInnerHTML` 在
   `renderToStaticMarkup` 下不会被剥离）。
2. **颜色 100% token 化**：裸 hex 76 → **0**。按 dsh 自己的 alert 三层分工：
   - 文字 = `state-warn-label` / `label-error` / `state-error-primary`
   - 背景 = `state-*-tertiary`
   - 边框 = `state-*-secondary`
3. **radius token 化**：8 处 `border-radius` → `--dsw-radius-xs/sm/md`
4. **焦点环**：`#6366f1` → `var(--dsw-alias-brand-primary)`
5. **btn.primary**：改用 `--dsw-alias-button-primary-fill` + `label-primary-foreground`
   （原先是半透明 indigo 底 + inherit 文字，主次不清）
6. **补 `hotBadge` 死键**：i18n 键存在但无渲染处。hmr 开启时常驻显示 zap 图标徽章，
   同时让 Icon 有稳定落点（CDP 实测 `svgCount: 0 → 1`）

### 四、px 不动的依据（避免做无用功）

`lint_hardcodes.py` 仍报 66 处 px。实测 dsh 官方 `dsh-client-ui-plugin-manager`
自己也用裸 px（`gap:8px` ×12、`font-size:13px` ×17、`height:18px` ×19），
但**零裸 hex**。且 dsh **没有间距 token**（只有 radius/font/focus-ring）。
→ 结论：px 与宿主一致，保留；颜色必须 token 化，已做到 0。

### 五、验证（真实渲染，非仅门镜）

CDP 读真实 dsh DOM computed style：

```
svgCount   : 1（12×12，Icon 常驻）
emojiLeft  : false
badgeOk    : rgb(34,197,94)   ← 来自 --dsw-alias-state-success-primary
badgeWarn  : rgb(221,134,41)  ← 来自 --dsw-alias-state-warn-label(amber-600)
authWarn   : rgb(221,134,41)
row radius : 8px              ← --dsw-radius-sm
switch box : [40,24]          ← WCAG 2.2 达标
focusRing  : 2px solid        ← 宿主品牌色(不再硬编码 indigo)
```

注：`getPropertyValue` 在 documentElement 上取 alias token 得 `(unset)`，
但 computed style 解析正确 —— 说明 dsh 把 token 定义在更具体的元素/内联样式上，
探测方式问题，非功能问题。

### 六、测试

`test-oauth-ui.mjs` 31 → **38 用例**（新增 5 个 taste：emoji / 裸 hex / 焦点环 /
状态色 / `<select>`；再加 2 个：Icon SSR 产出 `<path>`、Icon 有常驻落点）。
**全量 214/214 全绿**，0.3.2 干净安装后包内 214/214。

---

## GitHub 公开仓库（2026-10-24 15:00 CST）

### 决定
用户选：**公开仓库 + PROGRESS.md 脱敏后上传**。

### 脱敏清单（上传前处理）
本表只记**类型 → 占位符**，不记真实值（真实值仅存在于本地未公开副本）。

| 项 | 替换为 |
|---|---|
| 内部 VPS 公网 IP（2 个） | `<internal-ip>` / `<internal-ip-2>` |
| 家用 LAN IP（2 个） | `<lan-ip>` / `<lan-ip-2>` |
| 云主机主机名（2 个） | `<host-alias>` / `<host-alias-2>` |
| 内部域名（一族自有域名） | `<internal-host>` |
| 个人邮箱 | `<redacted-email>` |
| OAuth token / user id 片段（3 个） | `<redacted>` |

保留项（判断为无风险）：Termux 绝对路径（部署说明必要，不含凭据）、
作者名 `240xu`（package.json 本就公开）、测试用假 IP `192.168.1.9`
（loopback 语义，非真实内网地址）。

教训：第一版脱敏后，我又在「脱敏清单」表格的「原值」列把真实值写了回去，
导致 GitHub 上的文件仍有 4 处命中。**脱敏文档自身也是脱敏面** ——
已改为只记类型与占位符。

### .gitignore 排除
`.project-state/`（含邮箱的内部状态）、`.test/`、`*.tgz`、`*.log`、`*.bak*`。

### 推送路径（github.com 被墙）
本机 `github.com:443` 不通（133s 超时），`api.github.com` 通。
按既定做法：`git bundle` → scp 到 wuming → 用 `ghp_` token 经
`http.extraHeader` 不落 argv 的方式推 → **远端 token 与临时文件用完即删**。

坑：`hosts.yml` 里有两个 token，第一次误抓 `gho_`（被拒
`Permission denied to gh218`），必须取 `ghp_` 那个。

### 结果
- 仓库：<https://github.com/240xu/dsh-mcp-skill-hub>（public）
- commit `ec78c4c`，**42 个 blob**，与本地逐字节一致
- `package.json` 补了 `repository` / `bugs` / `homepage`
- **独立复核**：从 GitHub API 拉回 PROGRESS.md 实内容，2981 行，
  8 类敏感模式全部 0 命中

---

## 0.3.3 授权提示移到授权按钮同行（2026-10-24 16:00 CST）

### 用户反馈
「授权已超时,请重新点击授权」显示在 MCP 名称右侧的徽章里，而授权按钮在
另起一行 —— 两者分居两处，用户看不出关联，以为超时是另一个问题。

### 改法
超时提示移入授权行（`dsh-hub-auth-row`），与授权按钮同行。黄字按状态分级：

| 状态 | 文案 |
|---|---|
| `expired` | authExpired（授权已超时,请重新点击授权） |
| `failed` | authFailed |
| 探测不可达 | authProbeFailed |
| 其它 | authRowHint（该服务器需要 OAuth 授权后才能使用） |

同时 `AuthBadge` 不再渲染 `expired` / `failed` —— 信息已移到授权行，
徽章再显示就是重复。主行保持「只有删除 + 开关」（用户此前的要求不变）。

### 过程中抓到的真 bug（自己引入的）
第一版把 `authRowHint` 定义在 `McpTab` **外**，却引用其内部的
`authStatus` / `needsAuthMap` —— 渲染时直接
`ReferenceError: authStatus is not defined`。

这个 bug **测试没抓到**（测试只做源码正则，没真正渲染带该状态的行）。
修法 + 防回归：
1. 改成显式传参的纯函数：`authRowHint(row, t, authStatus, needsAuthMap)`
2. 加测试锁定签名形态（4 个参数），防闭包错误复发
3. **把该用例从源码正则改成渲染级**：monkey-patch `useState` 按调用顺序
   注入 `authStatus`，再断言 DOM 里授权行同时含黄字与按钮

渲染级验证输出（真实中文文案）：

```html
<div class="dsh-hub-row">                          ← 主行
  <span class="dsh-hub-name">mcp-cloudflare http</span>
  <span class="dsh-hub-desc">https://mcp.cloudflare.com/mcp</span>
  <span class="dsh-hub-badge ok">运行中</span>
  <button class="dsh-hub-switch on">…</button>
  <button class="dsh-hub-btn danger">删除</button>
</div>
<div class="dsh-hub-row dsh-hub-auth-row">          ← 授权行(缩进)
  <span class="dsh-hub-auth-warn">授权已超时,请重新点击授权</span>
  <button class="dsh-hub-btn">授权</button>
</div>
```

### 测试与发布
- `test-oauth-ui.mjs` 38 → 40 用例；全量 **216/216 全绿**
- 0.3.3 已发布，干净安装后包内 216/216
- 生产 dsh 已重启（PID 30511），Hub API 200
- 当前 `mcp-cloudflare` 为 `authenticated`（token 已自动刷新），
  故授权行不显示 —— 只有真需要时才出现，符合设计

---

## 0.3.4 逐字审核(2026-10-24)

用户指令「逐字审核」。对 GitHub 仓库 42 个文件全量审完, 输出 3 个 P0 + 若干 P1/P2/P3。
**所有结论均附可独立复跑的命令与真实输出**, 子代理报的全部项目由主会话逐项复现后才定性。

### 发现并修复的 P0(3 个)

| # | 缺陷 | 影响 | 修复 |
|---|---|---|---|
| P0-A | `scanMcpBlocks` 的括号深度计数用**原文**, 注释里未闭合的 `[`/`{` 把 depth 永久抬高 | patch 中任意 MCP 行之前出现 `# TODO[ revisit` 这样的注释 → **所有 MCP 行从 UI 消失且无法增删改** | 计数前剥离注释; 注意 `stripComment` 要求 `#` 前有空白才算注释起点, 整行注释(# 在列 0)要单独判空 |
| P0-B | `parseBlockFields` 的 map 子键判据只看 `currentMap` 是否置位, **不看缩进** | config 内 `headers:` 之后的 `reconnect:`/`url:` 等顶层键被吞进 headers map; `out.url` 丢失 → **保存时改写 MCP 连接目标**、未知字段错位 | 加缩进闸门 `ind > configIndent + 2`; 回到 config 直接子级时清零 map/list 态 |
| P0-C | `rawHeaders`/`rawEnv` 未 mask 原值挂在 row 上, 而 `/state` 处理器 `out.mcp = r.rows` 整行返回 | **任何能打 loopback API 的调用方(含已配对设备)都能从 /state 读到明文 API Token** | 原值改由 `readMcpRows` 单列 `rawSecrets`(Map: rowId → {headers,env}) 返回; `/oauth/*` 探测路径经 `rawHeadersFor(id)` 按需取用 |

P0-A 实证(修复前):
```
无注释          : 2 行 (期望 2)
含 # TODO[      : 0 行 (期望 2)   ← 全部消失
含 # see [docs] : 2 行 (期望 2)   ← 闭合的不受影响, 所以此前从未暴露
```

P0-B 实证(修复前):
```
f.url      = undefined                        (期望 https://leak.example.com/mcp)
f.headers  = {"Authorization":"Bearer real-token","reconnect":"","enabled":"true","delayMs":"500"}
f.enabled  = undefined
```

P0-C 实证(修复前, 端到端):
```
row.config.headers (masked): {"Authorization":"•••"}
row.rawHeaders     (RAW!)   : {"Authorization":"Bearer <fixture-token>"}
/state 响应体会含明文?  ❌ 会
```
修复后:
```
/state 响应体长度: 216
含明文 Token: ✅ 否(已修复)
含 mask 值 •••: ✅ 是(正确打码)
```

### 先红后绿(铁律 9)
新增 `test-yaml-block-parse.mjs` 8 用例, 修复前 **7 红 1 绿**:
```
✖ P0-A: 注释含未闭合 "[" 时 MCP 行仍全部可见
✖ P0-A: 注释出现在两个 MCP 行之间也不影响第二行
✖ P0-B: headers 后的未知嵌套块不得吞掉 url / enabled
✖ P0-B: headers 在 url 之前时 url 同样不得丢失
✖ P0-B: env map 后的未知键同样不得被吞
✖ P0-B: 未知嵌套块本身必须保留在 extraLines(回写不丢配置)
✖ 源码: 注释必须在校验/计数前被剥离(防复发)
```
修复后 8/8 全绿。另在 `test-oauth-server.mjs` 补 1 个 P0-C 回归
(`M3: 原值不得挂在 row 上`), 直接打 `readMcpRows` 断言 rows 序列化后不含明文。

**过程中自己写错 2 次, 均当场纠正**:
1. 断言 `f.enabled === true` —— 实际行级启停是块级 `disabled:` 字段, `enabled` 是
   `buildRowLines` 的独立入参, 根本不是解析产物。改为断言 `f.disabled === false` +
   headers 不混入。
2. 新回归测试里引用了不存在的 `h.seenRows` 帮助方法, 回退成断言测试自己的 fixture
   对象(等于测空气)。改为直接 `import` host 半的 `readMcpRows` 打真实代码路径。

### 顺带修的小项
- `lib/self-heal.mjs`: 删未使用的 `mkdirSync` 导入与 `shaPrefix` 函数; 删 178 行
  永假分支(`buf.length < 1024` 已在 146 行返回过); 修 170 行注释(声称「偏差 >20%」
  但代码里没有任何 20% 比较); 修 440 行冗余判定(`!x || x === false`); 
  `DSH_POSTINSTALL_NO_FALLBACK` → `DSH_SELF_HEAL_NO_FALLBACK`(postinstall 方案已废弃,
  旧名误导)。
- `lib/index.js`: `SEAM_STATE` 注释声称「经 /oauth/status 与 /state 暴露」, 实际
  `stateHandler` 从未带 seam 字段 → 按实际行为改正; 从枚举里删掉死值 `locked`
  (self-heal 把它映射为 already 后才上报, 永远到不了 UI); `checkedAt` 补注释说明用途。
- `lib/client.js`: 删 4 个死 i18n 键(`saved`/`authNotAuth`/`authAlready`/`confirmDeleteSkill`)
  —— 均为 0.3.x 设计演变后遗留; 加测试**反向断言**防它们复活。
  其中 `confirmDeleteSkill` 一度以为对应功能缺口, 查证后确认技能删除已有确认
  (`confirmPath` 状态 + 确认/取消两钮, 用的是通用 `confirmDelete`), 删除键是正确的。
- `lib/index.js`: 删空注释的 `// eslint-disable-line`。
- **6 个 `.sh` 的 shebang**: `#!/data/data/com.termux/files/usr/bin/bash` → `#!/usr/bin/env bash`。
  原值是我本机 Termux 路径, 公开仓库用户装在 Linux/macOS 上直接 `bad interpreter`。
  ⚠️ 但 Termux 自己**没有 `/usr/bin/env`**(它在 `$PREFIX/bin/env`)—— 所以 README 与
  `test-verify-patch.mjs` 全部改成 `bash script.sh` 调用, 不依赖 shebang。
  这是「改 A 坏 B」的典型: 修跨平台时把本机搞坏了, 靠跑测试才发现(4 个 exit null)。
- `README.md`: 测试数字 15/217 → 16/226; 脚本用法全部改 `bash scripts/xxx.sh`;
  「任何失败只记日志」改为「异常状态一定会发声」(P0-2 后的真实行为); 补 0.3.3 授权行说明;
  注明裸 glob 会多跑已废弃的 `test-postinstall.mjs`。
- `scripts/run-tests.sh`: 文件清单加入 `test-yaml-block-parse.mjs`。
- `package.json`: `files` 加入 `test-yaml-block-parse.mjs`(28 → 29 项)。

### 审核中确认「不是问题」的项(避免重复排查)
- 所有 `sk-`/`Bearer` 命中均为测试 fixture 假值(`sk-test'123`/`sk-x`/`Bearer static-token`
  /`Bearer REAL-TOKEN`); `password`/`passwd` 命中是打码正则与 `file://` 协议校验测试。
- 无真实邮箱、无内网 IP、无 `/home/<user>` 路径(仅 Termux 绝对路径, 部署说明必要)。
- PROGRESS.md 脱敏彻底(唯一 `192.168.1.9` 是文档已说明的测试假 IP; `ghp_`/`gho_` 是
  token 类型前缀而非 token 值)。
- README 声称的 14 条 API 路由与实际注册逐一核对一致(`mcp/upsert|toggle|delete` 与
  `skills/create|update|toggle|delete` 是合并写法)。

### 复核后判定为「子代理报错」的项
- 子代理称 `resolveRowId` 空 url 分支是 P0。复核: `getAuthProvider` 已有
  `if (!url) return undefined` 早退, 该分支实际不可达; 且空 url 时行 id 键仍安全
  (另一行会被同一早退挡掉)。降级为注释与代码承诺不一致, 未改。
- 子代理称 `scanMcpBlocks` 0 行是「完全坏了」。复核: 是我第一次传参类型错了(传字符串,
  实参要数组), 且漏了 `name: '@deepseek-ai/dsh-mcp-client'` 行 —— 与代码无关。
  **教训: 子代理的验证脚本同样可能错, 主会话必须用自己的输入重跑一遍才定性。**

### 测试与状态
- 15 文件 226 用例(runner 口径, 不含已废弃的 test-postinstall.mjs)
- 裸 glob 235 用例(多跑的 9 个来自废弃文件)
- 生产 bundle sha256 仍为 `363a0265daf80558…`(未触碰)
- 生产 profile 2 个 MCP 行解析结果与修复前一致(url 均正确)

## 卸载按钮 + 官方重构风险评估（2026-10-25 14:00 CST）

### 起因（用户三问）
1. 「安装会更改官方的那个配置文件，对吧？」
2. 「官方的预览最新版是否解决了这个问题，直接官方原生能够 mcp 授权？」
3. 「如果说安装这个会更改官方的配置文件的话，那卸载应该做一个按钮，让它安全回退到原来官方的配置。」

### 一、官方最新版是否已支持原生 MCP OAuth —— 没有

实测（下载 tarball 逐个 grep 锚点，非看 release note）：

| 版本 | `createTransport(config)` 原版形态 | `authProvider` 透传 | 结论 |
|---|---|---|---|
| `@deepseek-ai/dsh-mcp-client@0.2.1-alpha.5`（本机在用） | 0（已打我方补丁） | 1 处（补丁写入） | 需补丁 |
| `0.2.1-rc.2` | 1 | 0 | 需补丁 |
| `0.2.1-rc.3`（npm 最新） | 1 | 0 | 需补丁 |

rc.2/rc.3 的 `StreamableHTTPClientTransport` 仍不收 provider，`createTransport(config)`
仍不接收第二个参数 —— 补丁依然必需。

### 二、官方重构的影响面 —— 补丁在 rc.3 上完整适用（推翻初判）

**初判错误及修正**：先 grep rc.3 发现 `mcpAuth` 字样消失，一度判定「官方删了服务，补丁
无法工作」。复跑实测推翻：

```
rc.3 原始 bundle      : patched=false, missing=[P1, P2, P3+P4]
rc.3 打补丁后         : status=patched, applied=[P1, P2, P3+P4]
rc.3 打补丁后 sha256  : 363a0265daf80558…
alpha.5 打补丁后 sha  : 363a0265daf80558…   ← 逐字节相同
```

sha 完全相同即证明官方重构没碰这三个函数。`mcpAuth` 之所以在 rc.3 里搜不到，是因为它
**本来就不是官方代码** —— 它是补丁写进去的一行，provider 由本插件自己的
`registerAuthService` 提供（dsh 主包 lib/dist 全树 grep `mcpAuth` 零命中，已实证）。
即补丁只依赖 mcp-client 里那三行形态，与 dsh 主包解耦。

**仍需持续盯的风险**：官方若改 `createTransport` 签名，自愈会报 `anchor-missing`
红色横幅 + stderr 告警，不会静默失效；官方若原生支持 OAuth，补丁变多余，届时可主动停用。

### 三、卸载按钮（TDD，20 用例先红后绿）

**设计定案（用户选「完整卸载 + 还原补丁」）**：设置页常驻「危险区」，两个 Tab 之外
（卸载与「当前在看哪个 Tab」无关）。

- `lib/uninstall.js`：纯逻辑 + 路由 + worker 源码生成。
- 三条路由：`GET /uninstall/plan`（只读预览）、`POST /uninstall/run`（需
  `{"confirm":"UNINSTALL"}`，202 后立刻返回）、`GET /uninstall/status`（回看步骤日志）。
- **安全不变量**：
  1. 先校验备份 sha256 与 sidecar 记录一致，**不符就不动 bundle** —— 否则备份损坏会把
     「半 patched」写死进 bundle 且再无原版可拿；
  2. 原子替换：同目录临时文件 + `renameSync`；
  3. 计划有阻断项（无可信备份 / bundle 不存在 / 插件已不在）→ 409 且不 spawn；
  4. worker 必须是**脱离插件的独立文件**（写在 `~/.dsh/`）—— 卸载由插件自己的路由触发，
     而插件随后会被删、dsh 会重启，worker 活在插件进程内必被打断；
  5. `confirm` 令牌只活在路由层，不进 worker 参数（白名单字段）；
  6. worker 不接触任何凭据字段（accessToken/client_secret/code_verifier）。

**安装形态兼容**：`pnpm remove` 对软链（开发态，只删软链+依赖声明，源码不动）与副本
（发布态）都适用；计划里如实报告是哪种。

### 四、实测踩中并修掉的真 bug

**`plan` 是 async 但路由同步调用**：`findBundle()` 是 async（P1-5 用 execFile 避免冻结
dsh 事件循环），`findBundle() || fallback` 拿到 Promise（truthy）直接传给
`planUninstall`，被类型闸门拒掉报「bundlePath required」，整条卸载计划不可用。
修：路由 `await plan()` + index.js 的 plan 注入改 async 并解包 `{path}` / string 两种返回。
回归用例：`路由: plan 为 async 时也能正常工作（回归: 未 await 会 500）`。

### 五、独立验证

```
# 卸载计划路由（生产真实数据）
$ curl -s -H "x-dsh-token: ***" http://127.0.0.1:3080/api/dsh-mcp-skill-hub/uninstall/plan
{ "canRestore": true, "blockers": [],
  "bundle": { "currentSha": "363a0265daf80558…", "patched": true },
  "restoreTarget": { "path": "…index.js.bak-20261023T092048Z", "sha": "758d8fc473b700b5…" },
  "plugin": { "installMode": "link", "linkedPath": "../../../../dsh-plugins-src/dsh-mcp-skill-hub" },
  "dsh": { "pid": 10967 },
  "steps": ["restore-bundle","verify-restore","remove-plugin","restart-dsh"] }

# 鉴权闸门（不得误卸）
$ curl -X POST -d '{}' …/uninstall/run            → 400
$ curl -X POST -d '{"confirm":"yes"}' …/uninstall/run → 400

# 误伤检查
软链仍在 → ../../../../dsh-plugins-src/dsh-mcp-skill-hub
bundle sha 仍为 363a0265daf80558…（未触碰）
```

测试：17 文件 / 246 用例全绿（runner 口径，新增 `test-uninstall.mjs` 20 用例）。
worker 端到端用真实 fs 跑（临时目录）：可信备份 → 还原成功；备份 sha 不符 → 拒绝覆盖且
bundle 保持原样；备份缺失 → 失败且不留临时文件。

### 六、遗留
- UI 渲染未做浏览器级实测（SPA 设置入口需多点交互，探测成本高）；已由
  `test-oauth-ui.mjs` 41 用例覆盖键集一致性/无 emoji/字号/反向断言，且 dsh 直接加载
  源码 `lib/client.js`（软链、无编译中间层），新代码即生效代码。
- 已发版：0.3.4（含 3 个 P0 + 卸载按钮），干净安装后包内 246/246。
