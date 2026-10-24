#!/data/data/com.termux/files/usr/bin/bash
# patch-installed.sh —— 对生产 bundle 精准 patch dsh-mcp-client（人执行）。
#
# ⚠️ 由人手动执行，不由 agent 执行（铁律 5）。
#
# 背景: dsh-src 的 seam 改动在 android-arm64 上无法 build（pnpm 无法自校验 + 磁盘不足），
# 故直接对安装版的编译产物打同形 patch。seam 在 bundle 里共 **4 处**（比源码层多 1 处，
# 因为 bundle 没有 import 段，provider 的读取要塞进调用点所在函数）：
#
#   P1  createTransport 签名            function createTransport(config) {              → (config, authProvider)
#   P2  streamable-http 分支透传        { requestInit: { headers: config.headers } }    → + authProvider
#   P3  调用点所在函数读服务            （connectGeneration 内新增 const authProvider = ...）
#   P4  调用点传参                      createTransport(config)                          → (config, authProvider)
#
# 幂等: 每处 patch 前先检测"是否已是 patch 后形态"，已是则跳过（可重复跑）。
# 回滚: patch 前对 bundle 做 sha256 + 全量备份；任一处失败自动从备份恢复。
#
# 用法:
#   ./scripts/patch-installed.sh            # dry-run(只报告会改什么)
#   ./scripts/patch-installed.sh --apply    # 实际 patch
#
# 退出码: 0=成功/已是 patched  1=前置断言失败  2=备份失败  3=patch 失败(已回滚)  4=验证失败(已回滚)
set -uo pipefail

TS="$(date -u +%Y%m%dT%H%M%SZ)"
PKG="/data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-mcp-client"
BUNDLE="$PKG/lib/index.js"
LOGDIR="${TMPDIR:-/data/data/com.termux/files/usr/tmp/opencode}"
LOG="$LOGDIR/patch-installed-$TS.log"
MODE="dry-run"
[ "${1:-}" = "--apply" ] && MODE="apply"

exec > >(tee -a "$LOG") 2>&1
echo "=== patch-installed.sh  mode=$MODE  $TS ==="
echo "bundle: $BUNDLE"
echo "日志:   $LOG"

# ── 前置断言 ──
echo ""
echo "── 前置断言 ──"
if [ ! -f "$BUNDLE" ]; then
  echo "拒绝: bundle 不存在: $BUNDLE" >&2
  exit 1
fi
echo "✅ bundle 存在 ($(wc -c < "$BUNDLE" | tr -d ' ') B, $(wc -l < "$BUNDLE" | tr -d ' ') 行)"

if ! dsh --version >/dev/null 2>&1; then
  echo "拒绝: dsh --version 不可运行（patch 前 dsh 已坏, 勿 patch 以免混淆归因）" >&2
  exit 1
fi
echo "✅ 替换前 dsh --version: $(dsh --version 2>&1 | head -1)"

if ! grep -q "createTransport" "$BUNDLE"; then
  echo "拒绝: bundle 内无 createTransport（形态已变, 脚本不适用）" >&2
  exit 1
fi
echo "✅ bundle 内含 createTransport"

# 锚点唯一性: 每个 BEFORE 串必须恰好出现 1 次，否则 patch 会改错地方
anchor_count() {
  printf '%s' "$1" | grep -c -F -- "$2" || true
}

P1_BEFORE='function createTransport(config) {'
P1_AFTER='function createTransport(config, authProvider) {'
P2_BEFORE='case "streamable-http": return new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers } });'
P2_AFTER='case "streamable-http": return new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers }, authProvider });'
P3_BEFORE='			transport = createTransport(config);'
P3_AFTER='			const authProvider = ctx.get("mcpAuth", false)?.getAuthProvider(config.serverName, config);
			transport = createTransport(config, authProvider);'
for pair in "P1|$P1_BEFORE" "P2|$P2_BEFORE" "P3|$P3_BEFORE"; do
  name="${pair%%|*}"; anchor="${pair#*|}"
  n="$(anchor_count "$(cat "$BUNDLE")" "$anchor")"
  if [ "$n" -gt 1 ]; then
    echo "拒绝: $name 锚点不唯一(出现 $n 次) —— 形态已变, 停止" >&2
    exit 1
  fi
  if [ "$n" -eq 1 ]; then echo "✅ $name 锚点唯一(未 patch)"; else echo "✅ $name 锚点不存在(已 patch 或形态变)"; fi
done

# ── 幂等检测: 判断当前是否已 patch ──
ALL_PATCHED=1
for anchor in "$P1_AFTER" "$P2_AFTER" 'ctx.get("mcpAuth", false)?.getAuthProvider'; do
  n="$(anchor_count "$(cat "$BUNDLE")" "$anchor")"
  [ "$n" -eq 1 ] || ALL_PATCHED=0
done

if [ "$ALL_PATCHED" -eq 1 ]; then
  echo ""
  echo "✅ bundle 已是 patched 形态 —— 无需重复 patch（幂等）"
  exit 0
fi

# ── dry-run: 只报告 ──
if [ "$MODE" = "dry-run" ]; then
  echo ""
  echo "── dry-run 报告（未改任何文件）──"
  echo "  P1 将应用 (1 行):"
  echo "    - function createTransport(config) {"
  echo "    + function createTransport(config, authProvider) {"
  echo ""
  echo "  P2 将应用 (1 行):"
  echo "    - ...new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers } });"
  echo "    + ...new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers }, authProvider });"
  echo ""
  echo "  P3 将应用 (第 643 行, 1 行 → 2 行, 缩进 3 tab):"
  echo "    - <TAB><TAB><TAB>transport = createTransport(config);"
  echo "    + <TAB><TAB><TAB>const authProvider = ctx.get(\"mcpAuth\", false)?.getAuthProvider(config.serverName, config);"
  echo "    + <TAB><TAB><TAB>transport = createTransport(config, authProvider);"
  echo ""
  echo "  合计: 3 个 hunk, 4 处改动(签名 / http 透传 / 读服务 / 传参)"
  echo ""
  echo "确认无误后执行: $0 --apply"
  exit 0
fi

# ── 备份（含 sha256 + 自校验）──
echo ""
echo "── 备份 ──"
BAK="$PKG/lib/index.js.bak-$TS"
if ! cp -a "$BUNDLE" "$BAK"; then
  echo "备份失败, 中止(未改任何文件)" >&2
  exit 2
fi
sha256sum "$BAK" > "$BAK.sha256"
BEFORE_SHA="$(sha256sum "$BUNDLE" | cut -d' ' -f1)"
BEFORE_SIZE="$(wc -c < "$BUNDLE" | tr -d ' ')"
echo "✅ 备份: $BAK"
echo "   sha256: $BEFORE_SHA"
echo "   大小:   $BEFORE_SIZE B"
# 备份自校验: 必须与 patch 前的 BEFORE_SHA 比对。
# 仅对 .bak 自身重算再 sha256sum -c 是恒真的(磁盘满写半个文件也能过),
# 拦不住"备份与源不一致"这一唯一真正危险的场景。
BAK_SHA="$(sha256sum "$BAK" | cut -d' ' -f1)"
if [ "$BAK_SHA" = "$BEFORE_SHA" ]; then
  echo "✅ 备份自校验通过 (与源逐字节一致)"
else
  echo "❌ 备份与源不一致 ($BAK_SHA != $BEFORE_SHA), 中止(未改任何文件)" >&2
  rm -f "$BAK" "$BAK.sha256"
  exit 2
fi

# ── 应用 patch（4 处, 逐处原子替换 + 计数校验）──
echo ""
echo "── 应用 patch ──"
WORK="$BUNDLE.patching"
cp "$BUNDLE" "$WORK"
APPLIED=0
apply_one() {
  local name="$1" before="$2" after="$3"
  local n
  n="$(anchor_count "$(cat "$WORK")" "$before")"
  if [ "$n" -eq 0 ]; then echo "  $name 已是 patched 形态(跳过)"; return 0; fi
  if [ "$n" -gt 1 ]; then echo "  $name 锚点不唯一, 回滚" >&2; return 1; fi
  # 用 python 做精确单次替换(避免 sed 对特殊字符的转义地狱)
  if ! python3 - "$WORK" "$before" "$after" <<'PY'
import sys
path, before, after = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path, 'r', encoding='utf-8') as f: text = f.read()
if text.count(before) != 1:
    print(f'  anchor count = {text.count(before)}, expected 1', file=sys.stderr)
    sys.exit(1)
with open(path, 'w', encoding='utf-8') as f: f.write(text.replace(before, after, 1))
PY
  then echo "  $name 替换失败, 回滚" >&2; return 1; fi
  echo "  ✅ $name 已应用"
  APPLIED=$((APPLIED + 1))
  return 0
}

FAILED=0
apply_one "P1 签名"      "$P1_BEFORE" "$P1_AFTER" || FAILED=1
[ "$FAILED" -eq 0 ] && apply_one "P2 http透传" "$P2_BEFORE" "$P2_AFTER" || FAILED=1
[ "$FAILED" -eq 0 ] && apply_one "P3 读+传"     "$P3_BEFORE" "$P3_AFTER" || FAILED=1

if [ "$FAILED" -ne 0 ]; then
  echo ""
  echo "── 回滚 ──"
  rm -f "$WORK"
  echo "✅ 未替换 bundle（work 文件已删, 原文件未动）" >&2
  exit 3
fi

# ── 替换 ──
mv "$WORK" "$BUNDLE"
echo "✅ 已应用 $APPLIED 处 patch → $BUNDLE"

# ── 验证 ──
echo ""
echo "── 验证 ──"
VERIFY_FAIL=0
# V1 语法: bundle 可被 import
if node --input-type=module -e "
const m = await import('$BUNDLE')
const need = ['name','inject','apply','Config']
const miss = need.filter(k => !(k in m))
if (miss.length) { console.error('缺导出: ' + miss.join(',')); process.exit(1) }
if (m.name !== 'mcp-client') { console.error('插件 name 变了: ' + m.name + ' (期望 mcp-client)'); process.exit(1) }
" 2>&1; then
  echo "✅ V1 bundle 可 import 且 name/inject/apply/Config 形态正常"
else
  echo "❌ V1 bundle 加载/形态异常" >&2; VERIFY_FAIL=1
fi

# V2 dsh CLI 可用
if dsh --version >/dev/null 2>&1; then
  echo "✅ V2 dsh --version: $(dsh --version 2>&1 | head -1)"
else
  echo "❌ V2 dsh --version 失败" >&2; VERIFY_FAIL=1
fi

if dsh --help 2>&1 | head -3 | grep -q "Usage: dsh"; then
  echo "✅ V3 dsh --help 正常"
else
  echo "❌ V3 dsh --help 输出异常" >&2; VERIFY_FAIL=1
fi

# V4 patch 形态自检。锚点必须互不为超串, 否则计数必然 >1 导致假失败。
# 历史教训: 第 4 锚点原写 'createTransport(config, authProvider)', 它是第 1 锚点
# 'function createTransport(config, authProvider) {' 的超串 → patch 成功后计数恒为 2
# → 必然触发自动回滚, 脚本永远无法留下 patch。
# 第 4 锚点刻意不含前导 tab: bash 单引号不展开 \t, 写 '\t\t\ttransport...' 会匹配
# 反斜杠字面量而永远 n=0(历史教训: 曾因此每次 apply 都被自动回滚)。
for anchor in "$P1_AFTER" "$P2_AFTER" 'ctx.get("mcpAuth", false)?.getAuthProvider' 'transport = createTransport(config, authProvider);'; do
  n="$(anchor_count "$(cat "$BUNDLE")" "$anchor")"
  if [ "$n" -eq 1 ]; then echo "✅ V4 patch 形态: $(printf '%s' "$anchor" | cut -c1-50)…"; else echo "❌ V4 patch 形态缺失: $anchor (出现 $n 次)" >&2; VERIFY_FAIL=1; fi
done

if [ "$VERIFY_FAIL" -ne 0 ]; then
  echo ""
  echo "── 自动回滚 ──"
  cp -a "$BAK" "$BUNDLE"
  dsh --version >/dev/null 2>&1 && echo "✅ 已回滚, dsh --version 恢复" || echo "⚠️ 已回滚但 dsh --version 仍异常, 请人工检查" >&2
  exit 4
fi

# ── 报告 ──
AFTER_SHA="$(sha256sum "$BUNDLE" | cut -d' ' -f1)"
AFTER_SIZE="$(wc -c < "$BUNDLE" | tr -d ' ')"
echo ""
echo "=== patch 成功 ==="
cat <<EOF
bundle:     $BUNDLE
sha256:     $BEFORE_SHA → $AFTER_SHA
大小:       $BEFORE_SIZE B → $AFTER_SIZE B (+$((AFTER_SIZE - BEFORE_SIZE)) B)
应用处数:   $APPLIED / 3 hunk(P3 内含读+传两步)
备份:       $BAK
回滚命令:   cp -a "$BAK" "$BUNDLE"
幂等:       重复跑本脚本会检测到已 patch 并退出 0
EOF

echo ""
echo "=== PROGRESS.md 记录片段（请追加） ==="
cat <<EOF
### patch 生产 bundle mcp-client（$TS）

- 备份: \`$BAK\`（校验和 \`$BAK.sha256\`）
- sha256: $BEFORE_SHA → $AFTER_SHA
- 大小: $BEFORE_SIZE B → $AFTER_SIZE B
- 应用: $APPLIED 处 hunk（签名 / http 透传 / 读服务+传参）
- 验证: V1 模块形态 ✅ / V2 dsh --version ✅ / V3 dsh --help ✅ / V4 patch 形态 ✅
- 回滚: \`cp -a "$BAK" "$BUNDLE"\`
EOF

exit 0
