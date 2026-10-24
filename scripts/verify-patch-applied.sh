#!/usr/bin/env bash
# 验证 dsh 生产 bundle 的 OAuth seam patch 是否仍然生效。
#
# 为什么需要: dsh 升级(npm 重装 @deepseek-ai/dsh-mcp-client)会把 patch 掉的
# bundle 换回上游原版 → Hub 的 OAuth provider 永远不会被 mcp-client 调用 →
# **所有 MCP 授权静默失效**(不报错, 只是连接时 401)。
#
# 判定方式: 检查三处结构性特征(不硬编码 sha256, 那样升级后会误报且无法
# 区分「升级换回原版」与「内容相同的新版本」)。
#
#   exit 0 = 已 patch
#   exit 1 = 未 patch(或只 patch 了一部分)
#   exit 2 = bundle 文件不存在
#
# 用法:
#   scripts/verify-patch-applied.sh [bundle 路径]
# 不带参数时用生产默认路径。
set -u

BUNDLE="${1:-/data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js}"

if [[ ! -f "$BUNDLE" ]]; then
  echo "NOT-PATCHED: bundle 不存在: $BUNDLE"
  echo "  → dsh 可能未安装, 或路径已变。查: npm root -g"
  exit 2
fi

# 三处结构性特征(patch 的全部内容, 见 patch-installed.sh 的 V1-V4)
# 1. createTransport 接受 authProvider 参数
SIG_OK=$(grep -c 'function createTransport(config, authProvider)' "$BUNDLE" || true)
# 2. streamable-http transport 透传 authProvider
PASS_OK=$(grep -c 'requestInit: { headers: config.headers }, authProvider' "$BUNDLE" || true)
# 3. 调用点从 ctx 取 provider 并传入
CALL_OK=$(grep -c 'ctx.get("mcpAuth", false)?.getAuthProvider' "$BUNDLE" || true)

MISSING=()
[[ "$SIG_OK" -ge 1 ]] || MISSING+=("createTransport 签名未含 authProvider")
[[ "$PASS_OK" -ge 1 ]] || MISSING+=("StreamableHTTPClientTransport 未透传 authProvider")
[[ "$CALL_OK" -ge 1 ]] || MISSING+=("调用点未从 ctx.get(\"mcpAuth\") 取 provider")

if [[ ${#MISSING[@]} -eq 0 ]]; then
  echo "PATCHED: OAuth seam 完好 (3/3 特征命中)"
  echo "  bundle: $BUNDLE"
  echo "  sha256: $(sha256sum "$BUNDLE" | cut -d' ' -f1)"
  exit 0
fi

# 未 patch 或半 patch
HIT=$(( (SIG_OK >= 1 ? 1 : 0) + (PASS_OK >= 1 ? 1 : 0) + (CALL_OK >= 1 ? 1 : 0) ))
echo "NOT-PATCHED: OAuth seam 失效 (命中 $HIT/3)"
echo "  bundle: $BUNDLE"
for m in "${MISSING[@]}"; do
  echo "    - 缺失: $m"
done
echo ""
echo "影响: Hub 的 OAuth provider 不会被 mcp-client 调用,"
echo "      MCP 授权将静默失效(连接时 401, 但 UI 无任何提示)。"
echo ""
echo "修复(二选一):"
echo "  a. 重打 patch:  scripts/patch-installed.sh --apply"
echo "  b. 回滚原版:   scripts/rollback-installed.sh"
echo ""
echo "详情见 APPLY-RUNBOOK.md。"
exit 1
