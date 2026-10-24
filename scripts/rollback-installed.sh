#!/data/data/com.termux/files/usr/bin/bash
# 回滚 mcp-client 的 bundle 至 patch-installed.sh 的备份。
#
# ⚠️ 由人手动执行，不由 agent 执行（铁律 5）。
#
# 用法:
#   ./scripts/rollback-installed.sh <bak-path>
#
#   <bak-path> 两种形态都支持:
#     a) patch-installed.sh 的单文件备份
#        .../node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js.bak-<ts>
#     b) replace-installed.sh 的整包备份目录
#        .../node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-mcp-client.bak-<ts>
#
# 隔离(2026-10-23 P0-3): INSTALL_ROOT 曾被硬编码, 导致任何"模拟测试"都会打到
# 生产 bundle(审计任务已实际踩中一次)。现在可用环境变量覆盖:
#     DSH_MCP_CLIENT_PKG_DIR  直接指定 dsh-mcp-client 包目录
#     DSH_MCP_CLIENT_BUNDLE   直接指定 bundle 文件(优先级高于 PKG_DIR)
#   不设则回退到默认生产路径。
#
# 版本闸门(P0-3): 备份与当前安装的 dsh-mcp-client 版本不一致时拒绝执行,
# 避免把"旧上游"写进"新 dsh"的 bundle。
#
# 行为: 用备份覆盖当前 bundle/包，替换后立即验证 dsh 可用；失败则尝试恢复原状。
# 退出码: 0=成功  1=参数/前置失败  2=回滚失败  3=验证失败  4=版本不匹配(拒绝)
set -uo pipefail

TS="$(date -u +%Y%m%dT%H%M%SZ)"
DEFAULT_INSTALL_ROOT="/data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai"
INSTALL_ROOT="${DSH_MCP_CLIENT_PKG_DIR:+$(dirname "${DSH_MCP_CLIENT_PKG_DIR}")}"
INSTALL_ROOT="${INSTALL_ROOT:-$DEFAULT_INSTALL_ROOT}"
PKG_DIR="${DSH_MCP_CLIENT_PKG_DIR:-$INSTALL_ROOT/dsh-mcp-client}"
# DSH_MCP_CLIENT_BUNDLE 优先: 显式指定 bundle 时, PKG_DIR 只用于取版本号
BUNDLE_OVERRIDE="${DSH_MCP_CLIENT_BUNDLE:-}"
LOG_DIR="${TMPDIR:-/data/data/com.termux/files/usr/tmp/opencode}"
LOG="$LOG_DIR/rollback-installed-$TS.log"

exec > >(tee -a "$LOG") 2>&1
echo "=== rollback-installed.sh  $TS ==="
echo "日志: $LOG"
echo "PKG_DIR: $PKG_DIR"
[ -n "$BUNDLE_OVERRIDE" ] && echo "BUNDLE(env 覆盖): $BUNDLE_OVERRIDE"
if [ "$PKG_DIR" != "$DEFAULT_INSTALL_ROOT/dsh-mcp-client" ]; then
  echo "⚠️ 非默认路径(隔离模式) —— 不会碰到生产安装"
fi

BAK="${1:-}"
if [ -z "$BAK" ]; then
  echo "用法: $0 <bak-path>" >&2
  echo "  a) 单文件: $PKG_DIR/lib/index.js.bak-<ts>" >&2
  echo "  b) 整包:   $INSTALL_ROOT/dsh-mcp-client.bak-<ts>" >&2
  exit 1
fi

# 形态判定: 文件 → 单 bundle 回滚; 目录 → 整包回滚
if [ -f "$BAK" ]; then
  MODE="bundle"
  TARGET="${BUNDLE_OVERRIDE:-$PKG_DIR/lib/index.js}"
  echo "✅ 备份文件: $BAK"
  echo "   目标:     $TARGET"
elif [ -d "$BAK" ]; then
  MODE="package"
  TARGET="$PKG_DIR"
  if [ ! -f "$BAK/package.json" ]; then
    echo "拒绝: $BAK/package.json 不存在，不像有效整包备份" >&2
    exit 1
  fi
  echo "✅ 备份目录: $BAK"
  echo "   目标:     $TARGET"
else
  echo "拒绝: 备份不存在: $BAK" >&2
  exit 1
fi

# ── 版本闸门(P0-3) ──
# 备份与当前安装的 dsh-mcp-client 版本不一致 → 拒绝。
# 理由: dsh 升级后 bundle 变回上游新版, 此时拿旧备份回滚等于把"旧上游"
# 写进"新 dsh", 只会更坏。sha 自比对只能证明"写入成功", 证不了"版本正确"。
pkg_version() {
  node -e "try{process.stdout.write(require('$1/package.json').version||'')}catch(e){process.stdout.write('')}" 2>/dev/null
}
CUR_VER="$(pkg_version "$PKG_DIR")"
BAK_PKG="$BAK"; [ "$MODE" = "bundle" ] && BAK_PKG="$(dirname "$(dirname "$BAK")")"
BAK_VER="$(pkg_version "$BAK_PKG")"
if [ -n "$CUR_VER" ] && [ -n "$BAK_VER" ] && [ "$CUR_VER" != "$BAK_VER" ]; then
  echo "❌ 版本不匹配: 当前 dsh-mcp-client=$CUR_VER, 备份来自=$BAK_VER" >&2
  echo "   这说明 dsh 已升级。回滚旧版 bundle 不会修复问题, 反而更坏。" >&2
  echo "   正确做法: 让插件自愈重新打补丁, 或跑 scripts/patch-installed.sh --apply。" >&2
  echo "   若确实要强制回滚, 请手工 cp(脚本不冒险)。" >&2
  exit 4
fi
echo "── 版本闸门 ──"
echo "✅ dsh-mcp-client 版本一致: ${CUR_VER:-未知}"

# 若备份带校验和文件，先自校验（防止备份本身已损坏）
SUM_FILE="$BAK.sha256"
if [ -f "$SUM_FILE" ]; then
  echo "── 备份自校验 ──"
  if sha256sum -c "$SUM_FILE" >/dev/null 2>&1; then
    echo "✅ sha256sum -c 全部通过"
  else
    echo "❌ 备份校验和不符（备份可能已损坏）。仍要继续？" >&2
    echo "   若确认要继续，请手动执行（脚本不冒险覆盖生产）。" >&2
    exit 1
  fi
else
  echo "⚠️ 无 $SUM_FILE，跳过自校验"
fi

BEFORE_SHA=""
if [ -f "$TARGET" ]; then
  BEFORE_SHA="$(sha256sum "$TARGET" | cut -d' ' -f1)"
  echo "回滚前 bundle sha256: $BEFORE_SHA"
fi

# 暂存当前态，便于失败时恢复
rm -rf "$TARGET.rollback-stash"
if [ -e "$TARGET" ]; then cp -a "$TARGET" "$TARGET.rollback-stash"; fi

if [ "$MODE" = "bundle" ]; then
  # 单文件回滚: 直接用备份覆盖 bundle
  if ! cp -a "$BAK" "$TARGET"; then
    echo "❌ 回滚失败，正在恢复原状…" >&2
    [ -e "$TARGET.rollback-stash" ] && cp -a "$TARGET.rollback-stash" "$TARGET"
    rm -rf "$TARGET.rollback-stash"
    echo "已尽力恢复，请人工检查" >&2
    exit 2
  fi
  rm -rf "$TARGET.rollback-stash"
else
  # 整包回滚: 替换整个包目录
  if [ ! -d "$PKG_DIR" ]; then
    echo "⚠️ 当前安装版目录不存在，直接恢复备份"
  fi
  rm -rf "$PKG_DIR"
  if ! cp -a "$BAK" "$PKG_DIR"; then
    echo "❌ 回滚失败，正在恢复原状…" >&2
    rm -rf "$PKG_DIR"
    [ -d "$PKG_DIR.rollback-stash" ] && cp -a "$PKG_DIR.rollback-stash" "$PKG_DIR"
    rm -rf "$PKG_DIR.rollback-stash"
    echo "已尽力恢复，请人工检查" >&2
    exit 2
  fi
  rm -rf "$PKG_DIR.rollback-stash"
fi

# ── 验证 ──
echo ""
echo "── 回滚后验证 ──"
if ! dsh --version >/dev/null 2>&1; then
  echo "❌ 回滚后 dsh --version 失败" >&2
  exit 3
fi
echo "✅ dsh --version: $(dsh --version 2>&1 | head -1)"

if ! dsh --help 2>&1 | head -3 | grep -q "Usage: dsh"; then
  echo "❌ 回滚后 dsh --help 输出异常" >&2
  exit 3
fi
echo "✅ dsh --help 正常"

# 模块可加载(真实 import, 不是只看 sha)
if node --input-type=module -e "
const m = await import('$TARGET')
const need = ['name','inject','apply','Config']
const miss = need.filter(k => !(k in m))
if (miss.length) { console.error('缺导出: ' + miss.join(',')); process.exit(1) }
if (m.name !== 'mcp-client') { console.error('插件 name 变了: ' + m.name + ' (期望 mcp-client)'); process.exit(1) }
" 2>&1; then
  echo "✅ mcp-client 模块形态正常(name/inject/apply/Config)"
else
  echo "❌ mcp-client 模块形态异常" >&2
  exit 3
fi

AFTER_SHA="$(sha256sum "$TARGET" | cut -d' ' -f1)"
if [ "$MODE" = "bundle" ]; then
  BAK_SHA="$(sha256sum "$BAK" | cut -d' ' -f1)"
else
  BAK_SHA="$(sha256sum "$BAK/lib/index.js" | cut -d' ' -f1)"
fi
if [ "$AFTER_SHA" != "$BAK_SHA" ]; then
  echo "❌ bundle sha256 与备份不符（$AFTER_SHA != $BAK_SHA）" >&2
  exit 3
fi
echo "✅ bundle sha256 与备份一致: $AFTER_SHA"

echo ""
echo "=== 回滚成功 ==="
echo "bundle sha256: $BEFORE_SHA → $AFTER_SHA"
echo "恢复自:       $BAK"
exit 0
