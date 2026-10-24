#!/usr/bin/env bash
# 跑全部测试, 任何失败都输出完整详情(不丢证据)。
#
# --test-force-exit 必需: test-oauth-refresh.mjs / test-self-heal.mjs 起过
# HTTP server, node --test 会等事件循环空转而挂起 149s+ 不退出。
set -uo pipefail
TARGET="${1:-.}"
cd "$TARGET" || exit 1

FILES=(
  test.mjs test-routes.mjs test-yaml-safety.mjs test-client-entry.mjs
  test-auth-store.mjs test-oauth-provider.mjs test-oauth-server.mjs
  test-oauth-wiring.mjs test-oauth-ui.mjs test-oauth-reconnect.mjs
  test-verify-patch.mjs test-oauth-fixture.mjs
  test-self-heal.mjs test-oauth-refresh.mjs test-yaml-block-parse.mjs
)

TOT_P=0; TOT_F=0; FAILED_FILES=""
for f in "${FILES[@]}"; do
  [ -f "$f" ] || { echo "⚠ 缺文件: $f"; continue; }
  out=$(timeout 300 node --test --test-force-exit "$f" 2>&1)
  p=$(echo "$out" | grep -oE 'pass [0-9]+' | grep -o '[0-9]*' | head -1)
  fl=$(echo "$out" | grep -oE 'fail [0-9]+' | grep -o '[0-9]*' | head -1)
  TOT_P=$((TOT_P + ${p:-0})); TOT_F=$((TOT_F + ${fl:-0}))
  if [ "${fl:-0}" != "0" ]; then
    FAILED_FILES="$FAILED_FILES $f"
    echo "════════ $f (pass=$p fail=$fl) ════════"
    echo "$out" | sed -n '/✖ failing tests:/,$p' | head -30
  fi
done
echo "════════════════════════════════"
echo "合计: pass=$TOT_P fail=$TOT_F"
[ -n "$FAILED_FILES" ] && echo "失败文件:$FAILED_FILES"
exit $(( TOT_F > 0 ? 1 : 0 ))
