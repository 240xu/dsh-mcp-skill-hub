#!/usr/bin/env bash
# 替换安装版 @deepseek-ai/dsh-mcp-client 为 dsh-src 构建产物。
#
# ⚠️ 由人手动执行，不由 agent 执行（铁律 5：失败时只有本机人在场能救）。
#
# 用法:
#   ./scripts/replace-installed.sh <built-pkg-dir>
#
#   <built-pkg-dir> = 从 dsh-src build 出来的包目录(含 package.json 与 lib/)
#                     例如: ~/dsh-src/packages/mcp/mcp-client(已 npm run build:lib)
#                     或临时构建目录。
#
# 五条硬要求(用户回执第三节):
#   1. 前置断言: dsh --version 可跑, 否则拒绝执行
#   2. 完整备份 node_modules/<pkg> 至 <pkg>.bak-<ts>, 记录 sha256sum
#   3. 替换: cp -a <built> <pkg>/
#   4. 替换后立即验证: dsh --version && dsh --help 2>&1 | head; 任一步失败自动回滚
#   5. 独立回滚脚本 scripts/rollback-installed.sh <bak-path>
#   6. 打印替换前后 dsh 版本与 bundle 路径
#
# 退出码: 0=成功  1=前置断言失败  2=备份失败  3=替换失败  4=验证失败(已自动回滚)
set -uo pipefail

TS="$(date -u +%Y%m%dT%H%M%SZ)"
INSTALL_ROOT="/data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai"
PKG_NAME="dsh-mcp-client"
PKG_DIR="$INSTALL_ROOT/$PKG_NAME"
LOG_DIR="${TMPDIR:-/data/data/com.termux/files/usr/tmp/opencode}"
LOG="$LOG_DIR/replace-installed-$TS.log"

exec > >(tee -a "$LOG") 2>&1
echo "=== replace-installed.sh  $TS ==="
echo "日志: $LOG"

# ── 1. 前置断言(任一条不成立即拒绝, 不做任何改动) ──
echo ""
echo "── 前置断言 ──"

BUILT="${1:-}"
if [ -z "$BUILT" ]; then
  echo "拒绝：缺少 <built-pkg-dir> 参数" >&2
  echo "用法: $0 <built-pkg-dir>" >&2
  exit 1
fi
if [ ! -f "$BUILT/package.json" ]; then
  echo "拒绝：$BUILT/package.json 不存在（不是有效构建产物目录）" >&2
  exit 1
fi
if [ ! -d "$BUILT/lib" ]; then
  echo "拒绝：$BUILT/lib 不存在（构建产物应含 lib/）" >&2
  exit 1
fi
echo "✅ 构建产物目录有效: $BUILT"

if [ ! -d "$PKG_DIR" ]; then
  echo "拒绝：安装版目录不存在: $PKG_DIR" >&2
  exit 1
fi
echo "✅ 安装版目录存在: $PKG_DIR"

# dsh --version 必须可跑(证明替换前 dsh 本体健康, 否则替换后无法归因)
if ! dsh --version >/dev/null 2>&1; then
  echo "拒绝：dsh --version 不可运行（替换前 dsh 已坏，勿替换以免混淆归因）" >&2
  exit 1
fi
echo "✅ 替换前 dsh --version: $(dsh --version 2>&1 | head -1)"

# 版本一致性: 构建产物与安装版的 package.json version 必须相同
BUILT_VER="$(node -e "console.log(require('$BUILT/package.json').version)" 2>/dev/null)"
PKG_VER="$(node -e "console.log(require('$PKG_DIR/package.json').version)" 2>/dev/null)"
if [ -z "$BUILT_VER" ] || [ -z "$PKG_VER" ]; then
  echo "拒绝：无法读取 version（构建产物='$BUILT_VER' 安装版='$PKG_VER'）" >&2
  exit 1
fi
if [ "$BUILT_VER" != "$PKG_VER" ]; then
  echo "拒绝：版本不一致（构建产物=$BUILT_VER  安装版=$PKG_VER）" >&2
  exit 1
fi
echo "✅ 版本一致: $PKG_VER"

# 防呆: 拒绝把目录替换成自身
if [ "$(cd "$BUILT" && pwd -P)" = "$(cd "$PKG_DIR" && pwd -P)" ]; then
  echo "拒绝：构建产物目录就是安装版目录本身" >&2
  exit 1
fi
echo "✅ 构建产物与安装版非同目录"

# ── 2. 完整备份 + sha256sum ──
echo ""
echo "── 备份 ──"
BAK="$INSTALL_ROOT/$PKG_NAME.bak-$TS"
if ! cp -a "$PKG_DIR" "$BAK"; then
  echo "备份失败，中止（未做任何改动）" >&2
  exit 2
fi
echo "✅ 备份完成: $BAK"

# 全量校验和(替换前)
find "$BAK" -type f -print0 | sort -z | xargs -0 sha256sum > "$BAK.sha256"
BAK_SUM_LINES="$(wc -l < "$BAK.sha256" | tr -d ' ')"
echo "✅ 校验和: $BAK.sha256 ($BAK_SUM_LINES 个文件)"

# 验证备份自洽(回滚可用性)
if ! sha256sum -c "$BAK.sha256" >/dev/null 2>&1; then
  echo "备份自校验失败，中止" >&2
  exit 2
fi
echo "✅ 备份自校验通过"

# 记录替换前的 bundle 形态(供回滚后比对)
BEFORE_ENTRY="$(readlink -f "$PKG_DIR/lib/index.js" 2>/dev/null || echo "$PKG_DIR/lib/index.js")"
BEFORE_SHA="$(sha256sum "$BEFORE_ENTRY" | cut -d' ' -f1)"
BEFORE_SIZE="$(wc -c < "$BEFORE_ENTRY" | tr -d ' ')"
echo "替换前 bundle: $BEFORE_ENTRY"
echo "  sha256: $BEFORE_SHA"
echo "  大小:   $BEFORE_SIZE B"

# ── 3. 替换 ──
echo ""
echo "── 替换 ──"
rm -rf "$PKG_DIR.replacing"
if ! cp -a "$PKG_DIR" "$PKG_DIR.replacing"; then
  echo "暂存副本失败，中止（安装版未动）" >&2
  exit 3
fi
rm -rf "$PKG_DIR"
if ! cp -a "$BUILT" "$PKG_DIR"; then
  echo "替换失败，正在从暂存副本恢复…" >&2
  rm -rf "$PKG_DIR"
  cp -a "$PKG_DIR.replacing" "$PKG_DIR"
  rm -rf "$PKG_DIR.replacing"
  echo "已恢复到替换前状态，请人工检查" >&2
  exit 3
fi
rm -rf "$PKG_DIR.replacing"
echo "✅ 替换完成: $BUILT → $PKG_DIR"

# ── 4. 替换后立即验证(失败自动回滚) ──
echo ""
echo "── 替换后验证 ──"
ROLLBACK_NEEDED=0

if ! dsh --version >/dev/null 2>&1; then
  echo "❌ 替换后 dsh --version 失败" >&2
  ROLLBACK_NEEDED=1
else
  echo "✅ 替换后 dsh --version: $(dsh --version 2>&1 | head -1)"
fi

if ! dsh --help 2>&1 | head -3 | grep -q "Usage: dsh"; then
  echo "❌ 替换后 dsh --help 输出异常" >&2
  ROLLBACK_NEEDED=1
else
  echo "✅ 替换后 dsh --help 正常:"
  dsh --help 2>&1 | head -3 | sed 's/^/    /'
fi

# mcp-client 可加载性(真实 import 构建产物)
if ! node --input-type=module -e "
  const m = await import('$PKG_DIR/lib/index.js')
  const need = ['name','inject','apply','Config']
  const miss = need.filter(k => !(k in m))
  if (miss.length) { console.error('缺导出: ' + miss.join(',')); process.exit(1) }
  if (m.name !== '$PKG_NAME') { console.error('name 变了: ' + m.name); process.exit(1) }
" 2>&1; then
  echo "❌ 替换后 mcp-client 模块加载/形态异常" >&2
  ROLLBACK_NEEDED=1
else
  echo "✅ 替换后 mcp-client 形态正常(name/inject/apply/Config)"
fi

if [ "$ROLLBACK_NEEDED" -ne 0 ]; then
  echo ""
  echo "── 自动回滚 ──"
  rm -rf "$PKG_DIR"
  cp -a "$BAK" "$PKG_DIR"
  echo "✅ 已回滚至: $BAK"
  echo "❌ 替换失败并已回滚。安装版保持替换前状态。" >&2
  exit 4
fi

# ── 6. 打印替换前后对照 ──
AFTER_ENTRY="$PKG_DIR/lib/index.js"
AFTER_SHA="$(sha256sum "$AFTER_ENTRY" | cut -d' ' -f1)"
AFTER_SIZE="$(wc -c < "$AFTER_ENTRY" | tr -d ' ')"

echo ""
echo "=== 替换成功 ==="
cat <<EOF
版本:        $PKG_VER (替换前后相同)
bundle 路径: $AFTER_ENTRY
  sha256  before: $BEFORE_SHA
  sha256  after:  $AFTER_SHA
  大小    before: $BEFORE_SIZE B
  大小    after:  $AFTER_SIZE B
备份:        $BAK
回滚命令:    $(dirname "$0")/rollback-installed.sh "$BAK"
校验和:      $BAK.sha256
EOF

echo ""
echo "=== PROGRESS.md 记录片段（请追加） ==="
cat <<EOF
### 替换生产 mcp-client（$TS）

- 备份: \`$BAK\`（校验和 \`$BAK.sha256\`）
- 替换: \`$BUILT\` → \`$PKG_DIR\`
- 版本: $PKG_VER
- bundle: $AFTER_ENTRY
- sha256: $BEFORE_SHA → $AFTER_SHA
- 大小: $BEFORE_SIZE B → $AFTER_SIZE B
- 验证: dsh --version ✅ / dsh --help ✅ / 模块形态 ✅
- 回滚: \`./scripts/rollback-installed.sh "$BAK"\`
EOF

exit 0
