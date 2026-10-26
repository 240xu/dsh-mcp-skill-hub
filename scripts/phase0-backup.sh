#!/usr/bin/env bash
# 阶段备份脚本 — dsh-mcp-skill-hub
# 用途：在任何阶段开工前创建「真实现场快照」全量备份（含 .test/ 夹具状态）。
# 语义：备份用于回滚到真实现场，不用于重建可跑环境；不做任何清理（铁律 1、3）。
# 复用：阶段 0/1/2/4 开工前各跑一次，PHASE 参数区分。
#
# 用法：scripts/phase0-backup.sh <PHASE>    例如：scripts/phase0-backup.sh phase0
# 输出：~/.dsh/backups/hub-<PHASE>-<UTC+8时间戳>/  + SHA256SUMS + BACKUP-INFO.txt

set -euo pipefail

PHASE="${1:?用法: $0 <PHASE>  (例如 phase0)}"
HUB="/data/data/com.termux/files/home/dsh-plugins-src/dsh-mcp-skill-hub"
BACKUP_ROOT="/data/data/com.termux/files/home/.dsh/backups"
TS="$(TZ=Asia/Shanghai date +%Y%m%d-%H%M%S)"
DEST="$BACKUP_ROOT/hub-$PHASE-$TS"

# ── 前置断言：任一条不成立立即停（铁律 9：缺测试/缺断言不算完成） ──

# 断言 1：测试夹具数量必须 ≥ 10（*.mjs）
# 注: 2026-10-22 从 "必须为 10" 改为 "≥10" —— 写死上限会导致每次新增测试文件
# (test-verify-patch.mjs / test-oauth-fixture.mjs) 都让备份脚本中止, 与铁律 9
# 「修复须附测试」的方向相反。下限仍保留: 少于 10 个说明测试被误删。
MJS_COUNT="$(cd "$HUB" && ls -1 *.mjs 2>/dev/null | wc -l | tr -d ' ')"
if [ "$MJS_COUNT" -lt 10 ]; then
  echo "中止：期望 ≥10 个 *.mjs 测试文件，实际 $MJS_COUNT 个" >&2
  cd "$HUB" && ls -1 *.mjs >&2 || true
  exit 1
fi

# 断言 2：lib/ 下必须同时存在 host 半与 client 半
for f in index.js client.js; do
  [ -f "$HUB/lib/$f" ] || { echo "中止：缺少 lib/$f" >&2; exit 1; }
done

# 断言 3：目标目录不得已存在（防止时间戳碰撞覆盖旧备份）
[ -e "$DEST" ] && { echo "中止：目标已存在 $DEST" >&2; exit 1; }

# ── 全量备份（含 .test/；排除无意义的大日志/临时产物） ──
mkdir -p "$DEST"
# --exclude 只排除构建噪音，不排除任何状态文件
tar -C "$HUB" \
  --exclude='*.log' \
  --exclude='.DS_Store' \
  -cf - . | tar -C "$DEST" -xf -

# ── 全量 SHA256SUMS（覆盖备份内所有文件，含 .test/） ──
( cd "$DEST" && find . -type f ! -name SHA256SUMS ! -name BACKUP-INFO.txt -print0 \
    | sort -z | xargs -0 sha256sum > SHA256SUMS )

# ── .test/ 残留单独记录（用于区分备份前后残留变化，不做清理） ──
TEST_INFO="$DEST/.test-inventory.txt"
{
  echo "# .test/ 清单 — 生成于 $TS (UTC+8)"
  echo "# 用途：区分备份前后残留变化；不得借备份之名清理（铁律 1、3）"
  echo
  du -sh "$DEST/.test" 2>/dev/null || echo "(无 .test/)"
  echo
  find "$DEST/.test" -type f -print0 2>/dev/null | sort -z | xargs -0 sha256sum 2>/dev/null || true
} > "$TEST_INFO"

# ── BACKUP-INFO：可追溯元数据 ──
{
  echo "phase:    $PHASE"
  echo "time:     $(TZ=Asia/Shanghai date '+%Y-%m-%d %H:%M:%S %Z')"
  echo "source:   $HUB"
  echo "dest:     $DEST"
  echo "mjs:      $MJS_COUNT (断言通过)"
  echo "hub-size: $(du -sh "$DEST" | cut -f1)"
  echo "files:    $(find "$DEST" -type f ! -name SHA256SUMS ! -name BACKUP-INFO.txt ! -name .test-inventory.txt | wc -l | tr -d ' ')"
  echo "dsh-head: $(git -C /data/data/com.termux/files/home/dsh-src rev-parse HEAD 2>/dev/null || echo '(dsh-src 不可读)')"
  echo "dsh-dirty:$(git -C /data/data/com.termux/files/home/dsh-src status --porcelain 2>/dev/null | wc -l | tr -d ' ') 个未提交改动"
} > "$DEST/BACKUP-INFO.txt"

# ── 自校验：备份必须能通过自身的 SHA256SUMS ──
if ! ( cd "$DEST" && sha256sum -c SHA256SUMS --quiet ); then
  echo "中止：备份自校验失败，备份不可信" >&2
  exit 1
fi

echo "OK 备份完成: $DEST"
echo "   大小 $(du -sh "$DEST" | cut -f1)  ·  文件 $(find "$DEST" -type f | wc -l | tr -d ' ') 个  ·  自校验通过"
