# apply 操作手册（人照着跑，agent 不执行）

> 每一步都有预期输出。任何一步与预期不符就停，把输出贴回来。
> 全程预计 3-5 分钟。

---

## 第 0 步：确认前置状态（3 条，只读）

```bash
# 0.1 磁盘（应 > 6G；清完后应 > 11G）
df -h /data | tail -1

# 0.2 生产 bundle 当前 sha（必须等于这个值，否则说明已被人动过）
sha256sum /data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js
# 期望: 758d8fc473b700b5d351158d06ce9f9e92c16e8b25497b08bb7bd2122a87f5dd

# 0.3 确认没有残留 .bak（上次失败留下的）
ls /data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-mcp-client/lib/
# 期望: 只有 index.js 和 types/，无 *.bak-*
```

## 第 1 步：磁盘清理（4.7G）

```bash
rm -rf ~/.npm ~/.bun/install/cache
rm -rf $PREFIX/tmp/pip-install-* $PREFIX/tmp/pip-unpack-*
df -h /data | tail -1
# 期望: Avail 从 6.7G 涨到约 11.6G
```

## 第 2 步：确认 dsh 进程状态（重启影响评估）

```bash
# 当前 dsh 在跑（PID 会变）：
pgrep -af "dsh --profile" | grep -v grep
```

**已知实况**：dsh 正在跑 `--profile web --port 3080`（PID 12455，CPU 82:50）。
它的会话状态持久化在 `~/.dsh/profiles/web/` 下（dsh-session-persistence-jsonl 插件负责），
**重启不会丢历史会话**（jsonl 落盘）。但**当前未完成的对话上下文会中断**——
如果此刻 web UI 上有正在进行的重要对话，先等它结束或手动保存。

确认可以重启后，记下 PID（下面第 6 步用）。

## 第 3 步：确认回滚路径可用

```bash
cd ~/dsh-plugins-src/dsh-mcp-skill-hub
./scripts/rollback-installed.sh
# 期望看到用法输出（含 a/b 两种形态路径），不报错
```

回滚命令（出事时用，`<bak-path>` 换成 apply 时打印的那个）：
```bash
./scripts/rollback-installed.sh /data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js.bak-<ts>
```

## 第 4 步：dry-run（确认没变化）

```bash
cd ~/dsh-plugins-src/dsh-mcp-skill-hub
./scripts/patch-installed.sh
```

期望输出（关键 4 行）：
```
✅ bundle 存在 (35041 B, 835 行)
✅ 替换前 dsh --version: 0.2.1-alpha.5
✅ P1 锚点唯一(未 patch)
✅ P2 锚点唯一(未 patch)
✅ P3 锚点唯一(未 patch)
```
如果任何一条不是「锚点唯一」→ **停**，贴回来。

## 第 5 步：apply（唯一写生产的动作）

```bash
./scripts/patch-installed.sh --apply
```

期望输出（关键行）：
```
✅ 备份: .../lib/index.js.bak-<ts>
✅ 备份自校验通过
  ✅ P1 签名 已应用
  ✅ P2 http透传 已应用
  ✅ P3 读+传 已应用
✅ 已应用 3 处 patch
✅ V1 bundle 可 import 且 name/inject/apply/Config 形态正常
✅ V2 dsh --version: 0.2.1-alpha.5
✅ V3 dsh --help 正常
✅ V4 patch 形态: ...（4 条全过）
=== patch 成功 ===
sha256: 758d8fc473b700b5d351158d06ce9f9e92c16e8b25497b08bb7bd2122a87f5dd → <新sha>
```

**把 `<新sha>` 和完整输出贴回来**（第 7 步要补录 PROGRESS.md）。

如果任何 V 项失败 → 脚本自动回滚，输出会显示「── 自动回滚 ──」。
**把失败输出贴回来，不要手动重试。**

## 第 6 步：重启 dsh（patch 前那份已在内存里，不重启不生效）

```bash
# 6.1 优雅停止（用第 2 步记下的 PID，不用 pkill -f）
kill <PID>
sleep 3
pgrep -af "dsh --profile" | grep -v grep    # 期望空

# 6.2 重新启动（按你原来的启动方式；原进程带 --port 3080）
#     如果你原来是用某个脚本/tmux 起的，用同一个方式起。
dsh --profile web --no-open --port 3080 &
# 或者你原来的启动命令（请按实际替换）
```

## 第 7 步：dsh --version

```bash
dsh --version
# 期望: 0.2.1-alpha.5（版本号不变 —— patch 不改版本，只改 bundle 内容）
```

## 第 8 步：stdio 工具调用验证（bundle 未损坏的**唯一**行为级证据）

这一步用**独立 fixture + 临时 patch 叠加**，不依赖现有 profile、不依赖网络、
不依赖 OAuth。fixture 与 patch 我已生成好：

```bash
# 8.1 先自测 fixture（不经过 dsh，证明 fixture 本身没问题）
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"add","arguments":{"a":2,"b":3}}}' \
  | /data/data/com.termux/files/usr/bin/node /data/data/com.termux/files/usr/tmp/opencode/fixture-server.mjs
# 期望: 最后一行 {"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"5"}]}}
```

```bash
# 8.2 起一个 headless profile + 叠加 fixture patch，让 dsh 真的连一次 stdio MCP
cd /data/data/com.termux/files/usr/tmp/opencode
timeout 180 dsh headless \
  --patch ./verify-patch.yml \
  "调用 mcp__fixture__add 工具，参数 a=2 b=3，把结果原样告诉我" 2>&1 | tail -30
```

**期望**：输出里出现 `5`（工具被调用且返回正确）。
- 出现 `5` → bundle 未损坏，stdio 路径完整可用 ✅
- 出现 `tool not found` / `mcp__fixture__add` 不存在 → bundle 或 patch 有问题，**停**
- 超时无输出 → 贴回来（可能是 headless profile 本身的问题，不是 patch 的问题）

**如果 8.2 因 headless profile 缺依赖跑不起来**，退而求其次的最小验证：
```bash
# 8.3 直接驱动 patched bundle 的 stdio 分支（不经过 dsh CLI）
node --input-type=module -e "
// 从 patched bundle 里取出 createTransport 不可行(私有), 故用黑盒沙箱:
// 用 blackbox 沙箱 + patched 副本跑一次 stdio 连接
" 
# 或直接用这条：验证 bundle 的 stdio 分支语法与形态（V1 已覆盖）
node --input-type=module -e "
const m = await import('/data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js')
console.log('name:', m.name, '| inject:', JSON.stringify(m.inject), '| apply:', typeof m.apply)
"
```

## 第 9 步：贴回两样东西

1. **patch 后的 bundle sha256**（第 5 步输出的新值）
2. **第 8 步的输出**（出现 `5` 的截图/文本）

拿到后我补录 PROGRESS.md（含"已 patch，非上游原版"标注），然后进 3b 真机授权。

---

## 附：出事时的回滚

```bash
# 单文件回滚（patch-installed.sh 的 .bak）
cd ~/dsh-plugins-src/dsh-mcp-skill-hub
./scripts/rollback-installed.sh <第5步打印的 .bak 路径>
# 然后重启 dsh（同第 6 步）
```

脚本会：自校验备份 sha256 → 覆盖 bundle → 验证 `dsh --version`/`--help`/模块形态 → 比对 sha。
任一步失败会尝试恢复原状并报错。
