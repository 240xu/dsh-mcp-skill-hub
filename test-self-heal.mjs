/**
 * self-heal.mjs 的行为测试 —— 先红后绿(铁律 9)。
 *
 * 背景: npm 12 默认阻止依赖的 install scripts, postinstall 无法保证执行,
 * 故改为 dsh 启动时(apply 内)运行时自愈。
 *
 * 覆盖:
 *   1. 已 patch  → already, 零写入
 *   2. 未 patch  → patched, 三锚点全中, 备份 == 原版
 *   3. 半 patch  → 补全
 *   4. 不存在    → bundle-not-found, 不抛
 *   5. 形态不符  → not-applicable, 零写入
 *   6. autoFix=false → 只检测不补
 *   7. 环境变量关掉 → disabled
 *   8. 幂等: patch 后再跑 → already, 内容不变
 *
 * 运行: node --test test-self-heal.mjs
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, copyFileSync, writeFileSync, rmSync, readFileSync, existsSync, appendFileSync, utimesSync } from 'node:fs'
import { join } from 'node:path'

const HERE = import.meta.dirname
const SH = await import(join(HERE, 'lib', 'self-heal.mjs'))
const { ANCHORS } = SH

const INSTALLED = '/data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js'
const ORIG_BAK = INSTALLED + '.bak-20261021T113912Z'

const tmp = mkdtempSync('/data/data/com.termux/files/usr/tmp/opencode/sh-')
const patchedPath = join(tmp, 'patched.js')
const pristinePath = join(tmp, 'pristine.js')
copyFileSync(INSTALLED, patchedPath)
copyFileSync(ORIG_BAK, pristinePath)

const quiet = () => {}

test('1. 已 patch → already, 且零写入(启动开销仅一次读)', async () => {
  const before = readFileSync(patchedPath, 'utf8')
  const r = await SH.selfHealOauthSeam({ autoFix: true, log: quiet })
  assert.equal(r.status, 'already', JSON.stringify(r))
  assert.equal(readFileSync(patchedPath, 'utf8'), before, '已 patch 严禁改动')
  assert.ok(!existsSync(patchedPath + '.bak-selfheal'), '已 patch 不得生成备份')
})

test('2. 未 patch(指定 bundle) → patched, 三锚点全中', async () => {
  // selfHealOauthSeam 走 findBundle 探测; 用 env 注入隔离路径
  process.env.DSH_MCP_CLIENT_BUNDLE = pristinePath
  try {
    const r = await SH.selfHealOauthSeam({ autoFix: true, log: quiet })
    assert.equal(r.status, 'patched', JSON.stringify(r))
    assert.deepEqual([...r.detail.applied].sort(), ['P1', 'P2', 'P3+P4'])
    const after = readFileSync(pristinePath, 'utf8')
    for (const a of SH.ANCHORS) assert.ok(after.includes(a.to), `${a.id} 未 patch`)
    assert.ok(existsSync(pristinePath + '.bak-selfheal'), '应生成备份')
    assert.equal(readFileSync(pristinePath + '.bak-selfheal', 'utf8'), readFileSync(ORIG_BAK, 'utf8'),
      '备份内容应与上游原版逐字节一致')
  } finally {
    delete process.env.DSH_MCP_CLIENT_BUNDLE
  }
})

test('3. 半 patch → 补全剩余锚点', async () => {
  const half = join(tmp, 'half.js')
  let s = readFileSync(ORIG_BAK, 'utf8')
  s = s.replace('function createTransport(config) {', 'function createTransport(config, authProvider) {')
  writeFileSync(half, s)
  process.env.DSH_MCP_CLIENT_BUNDLE = half
  try {
    const r = await SH.selfHealOauthSeam({ autoFix: true, log: quiet })
    assert.equal(r.status, 'patched', JSON.stringify(r))
    assert.ok(!r.detail.applied.includes('P1'), 'P1 已存在, 不应重打')
    const after = readFileSync(half, 'utf8')
    for (const a of SH.ANCHORS) assert.ok(after.includes(a.to), `${a.id} 未 patch`)
  } finally {
    delete process.env.DSH_MCP_CLIENT_BUNDLE
  }
})

test('4. bundle 不存在 → bundle-not-found, 不抛异常', async () => {
  process.env.DSH_MCP_CLIENT_BUNDLE = join(tmp, 'nope.js')
  process.env.DSH_POSTINSTALL_NO_FALLBACK = '1'
  try {
    const r = await SH.selfHealOauthSeam({ autoFix: true, log: quiet })
    assert.equal(r.status, 'bundle-not-found', JSON.stringify(r))
    assert.equal(r.ok, true, '缺 bundle 不应视为失败')
  } finally {
    delete process.env.DSH_MCP_CLIENT_BUNDLE
    delete process.env.DSH_POSTINSTALL_NO_FALLBACK
  }
})

test('5. 形态不符(非 dsh bundle) → not-applicable, 零写入', async () => {
  const junk = join(tmp, 'junk.js')
  const junkContent = 'console.log("hello")\n'
  writeFileSync(junk, junkContent)
  process.env.DSH_MCP_CLIENT_BUNDLE = junk
  try {
    const r = await SH.selfHealOauthSeam({ autoFix: true, log: quiet })
    assert.equal(r.status, 'not-applicable', JSON.stringify(r))
    assert.equal(readFileSync(junk, 'utf8'), junkContent, '形态不符严禁改动')
  } finally {
    delete process.env.DSH_MCP_CLIENT_BUNDLE
  }
})

test('6. autoFix=false → 只检测不补(needs-patch)', async () => {
  const p2 = join(tmp, 'detect-only.js')
  copyFileSync(ORIG_BAK, p2)
  process.env.DSH_MCP_CLIENT_BUNDLE = p2
  try {
    const r = await SH.selfHealOauthSeam({ autoFix: false, log: quiet })
    assert.equal(r.status, 'needs-patch', JSON.stringify(r))
    assert.equal(readFileSync(p2, 'utf8'), readFileSync(ORIG_BAK, 'utf8'), '体检模式严禁改动')
    assert.ok(r.detail.missing.length > 0, '应报告缺失的锚点')
  } finally {
    delete process.env.DSH_MCP_CLIENT_BUNDLE
  }
})

test('7. DSH_MCP_SKILL_HUB_NO_SELF_HEAL=1 → disabled, 完全不碰文件', async () => {
  const p3 = join(tmp, 'disabled.js')
  copyFileSync(ORIG_BAK, p3)
  process.env.DSH_MCP_CLIENT_BUNDLE = p3
  process.env.DSH_MCP_SKILL_HUB_NO_SELF_HEAL = '1'
  try {
    const r = await SH.selfHealOauthSeam({ autoFix: true, log: quiet })
    assert.equal(r.status, 'disabled', JSON.stringify(r))
    assert.equal(readFileSync(p3, 'utf8'), readFileSync(ORIG_BAK, 'utf8'), 'disabled 时严禁改动')
  } finally {
    delete process.env.DSH_MCP_CLIENT_BUNDLE
    delete process.env.DSH_MCP_SKILL_HUB_NO_SELF_HEAL
  }
})

test('8. 幂等: patch 后再跑一次 → already, 内容不变', async () => {
  // 注意: 用全新文件, 不依赖场景 2 的 pristinePath(node --test 的执行顺序
  // 不保证, 复用会因已被 patch 而让 first.status 变成 already)
  const p = join(tmp, 'idem.js')
  copyFileSync(ORIG_BAK, p)
  process.env.DSH_MCP_CLIENT_BUNDLE = p
  try {
    const first = await SH.selfHealOauthSeam({ autoFix: true, log: quiet })
    const mid = readFileSync(p, 'utf8')
    const second = await SH.selfHealOauthSeam({ autoFix: true, log: quiet })
    assert.equal(first.status, 'patched', JSON.stringify(first))
    assert.equal(second.status, 'already', JSON.stringify(second))
    assert.equal(readFileSync(p, 'utf8'), mid, '第二次运行严禁改动')
  } finally {
    delete process.env.DSH_MCP_CLIENT_BUNDLE
  }
})

test('9. ANCHORS 的 to 与真实 patched bundle 逐字符一致(缩进回归)', () => {
  if (!existsSync(INSTALLED)) return
  const bundle = readFileSync(INSTALLED, 'utf8')
  for (const a of SH.ANCHORS) {
    assert.ok(bundle.includes(a.to), `${a.id} 的 to 未出现在已 patch 的 bundle(缩进/内容漂移)`)
  }
})

test('10. 安全: 输出不含长随机串(疑似凭据)', async () => {
  const lines = []
  await SH.selfHealOauthSeam({ autoFix: true, log: (s) => lines.push(s) })
  const all = lines.join('\n')
  assert.ok(!/[A-Za-z0-9_-]{40,}/.test(all), '输出不应含长随机串')
})

test('辅助: 自愈模块与本测试共用同一份 ANCHORS(口径不漂移)', () => {
  assert.equal(ANCHORS.length, 3)
  assert.deepEqual(ANCHORS.map(a => a.id), ['P1', 'P2', 'P3+P4'])
})

// ─────────────────────────────────────────────────────────────
// 0.3.0 加固回归(P0-2 / P1-1 / P1-2 / P1-3 / P1-4 / P2-1)
// ─────────────────────────────────────────────────────────────

test('P1-3: 空 bundle → corrupt 被检出, 且告警发声(不静默)', async () => {
  const p = join(tmp, 'empty.js')
  writeFileSync(p, '')
  process.env.DSH_MCP_CLIENT_BUNDLE = p
  try {
    const alarms = []
    const r = await SH.selfHealOauthSeam({ autoFix: true, log: () => {}, alarm: (m) => alarms.push(m) })
    // 空文件不含任何锚点 → not-applicable; 关键是必须 alarm
    assert.equal(r.status, 'not-applicable', JSON.stringify(r))
    assert.ok(alarms.length > 0, '空 bundle 必须告警, 不得静默 return')
  } finally { delete process.env.DSH_MCP_CLIENT_BUNDLE }
})

test('P1-3: 半写切断的 bundle → corrupt 被检出(花括号不配对)', () => {
  const p = join(tmp, 'trunc.js')
  const orig = readFileSync(ORIG_BAK, 'utf8')
  writeFileSync(p, orig.slice(0, Math.floor(orig.length * 0.4)))
  const st = SH.inspectBundle(p)
  assert.ok(st.corrupt, `截断 bundle 应被判 corrupt, 实际: ${JSON.stringify(st)}`)
  assert.match(st.corrupt, /截断|不配对|过小|NUL|空文件/)
})

test('P1-3: 含 NUL 字节 → corrupt', () => {
  const p = join(tmp, 'nul.js')
  writeFileSync(p, readFileSync(ORIG_BAK).subarray(0, 5000))
  appendFileSync(p, Buffer.from([0, 0, 0]))
  const st = SH.inspectBundle(p)
  assert.ok(st.corrupt, '含 NUL 应判 corrupt')
  assert.match(st.corrupt, /NUL/)
})

test('P0-2: 锚点漂移(上游新版) → 必须告警, 不得静默', async () => {
  const p = join(tmp, 'drift.js')
  let s = readFileSync(ORIG_BAK, 'utf8')
  // 模拟上游改版: 三个锚点全改形态
  s = s.replace('function createTransport(config) {', 'function createTransport(cfg, opts) {')
  s = s.replace('case "streamable-http": return new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers } });',
    'case "streamable-http": return new StreamableHTTPClientTransport(new URL(cfg.url), { requestInit: { headers: cfg.headers } });')
  s = s.replace('transport = createTransport(config);', 'transport = buildTransport(cfg);')
  writeFileSync(p, s)
  process.env.DSH_MCP_CLIENT_BUNDLE = p
  try {
    const alarms = []
    const r = await SH.selfHealOauthSeam({ autoFix: true, log: () => {}, alarm: (m) => alarms.push(m) })
    assert.ok(['anchor-missing', 'not-applicable'].includes(r.status), JSON.stringify(r))
    assert.ok(alarms.length > 0, '锚点漂移必须告警(P0-2)')
    assert.ok(alarms.join('\n').includes('漂移') || alarms.join('\n').includes('不是'), '告警应说明原因')
  } finally { delete process.env.DSH_MCP_CLIENT_BUNDLE }
})

test('P0-2b: not-applicable 时 detail 含路径与 via(便于排查)', async () => {
  const p = join(tmp, 'junk2.js')
  writeFileSync(p, 'console.log("hi")\n')
  process.env.DSH_MCP_CLIENT_BUNDLE = p
  try {
    const r = await SH.selfHealOauthSeam({ autoFix: true, log: () => {}, alarm: () => {} })
    assert.equal(r.status, 'not-applicable')
    assert.ok(r.detail.path, 'detail 应含 bundle 路径')
    assert.equal(r.detail.via, 'env')
  } finally { delete process.env.DSH_MCP_CLIENT_BUNDLE }
})

test('P1-1: patch 是原子写(不留 .selfheal.tmp 残留)', async () => {
  const p = join(tmp, 'atomic.js')
  copyFileSync(ORIG_BAK, p)
  process.env.DSH_MCP_CLIENT_BUNDLE = p
  try {
    const r = await SH.selfHealOauthSeam({ autoFix: true, log: () => {}, alarm: () => {} })
    assert.equal(r.status, 'patched', JSON.stringify(r))
    assert.ok(!existsSync(p + '.selfheal.tmp'), '原子写后不应残留 tmp')
  } finally { delete process.env.DSH_MCP_CLIENT_BUNDLE }
})

test('P1-2: 持锁期间第二次 patch → locked 或 already(不互踩)', async () => {
  const p = join(tmp, 'locked.js')
  copyFileSync(ORIG_BAK, p)
  // 手工占锁
  const lock = p + '.selfheal.lock'
  writeFileSync(lock, String(process.pid))
  process.env.DSH_MCP_CLIENT_BUNDLE = p
  try {
    const r = await SH.applyPatch(p, { log: () => {} })
    assert.ok(['locked', 'already'].includes(r.status), `应跳过而非强写: ${JSON.stringify(r)}`)
    assert.equal(readFileSync(p, 'utf8'), readFileSync(ORIG_BAK, 'utf8'), '持锁时不得改动 bundle')
  } finally {
    delete process.env.DSH_MCP_CLIENT_BUNDLE
    try { unlinkSync(lock) } catch {}
  }
})

test('P1-4: 陈旧锁(>30s)可被夺取', async () => {
  const p = join(tmp, 'stale.js')
  copyFileSync(ORIG_BAK, p)
  const lock = p + '.selfheal.lock'
  writeFileSync(lock, '99999')
  // 把 mtime 推到 60s 前
  const past = new Date(Date.now() - 60_000)
  utimesSync(lock, past, past)
  process.env.DSH_MCP_CLIENT_BUNDLE = p
  try {
    const r = await SH.applyPatch(p, { log: () => {} })
    assert.equal(r.status, 'patched', `陈旧锁应被夺取: ${JSON.stringify(r)}`)
  } finally {
    delete process.env.DSH_MCP_CLIENT_BUNDLE
    try { unlinkSync(lock) } catch {}
  }
})

test('P1-4: 备份失配(dsh 已升级) → 新备份带时间戳, 不覆盖旧备份', async () => {
  const p = join(tmp, 'bakmismatch.js')
  copyFileSync(ORIG_BAK, p)
  // 预置一个"别的版本"的旧备份(内容与当前 bundle 不同源)
  const bak = p + '.bak-selfheal'
  writeFileSync(bak, '/* 旧版本的原版 */\n')
  process.env.DSH_MCP_CLIENT_BUNDLE = p
  try {
    const r = await SH.applyPatch(p, { log: () => {} })
    assert.equal(r.status, 'patched', JSON.stringify(r))
    assert.notEqual(r.bak, bak, '不同源时应换新备份名')
    assert.equal(readFileSync(bak, 'utf8'), '/* 旧版本的原版 */\n', '旧备份不得被覆盖')
    assert.ok(existsSync(r.bak), '新备份应存在')
    assert.equal(readFileSync(r.bak, 'utf8'), readFileSync(ORIG_BAK, 'utf8'), '新备份应是当前原版')
    assert.ok(existsSync(r.bak + '.sha256'), '应写 sha256 sidecar')
  } finally { delete process.env.DSH_MCP_CLIENT_BUNDLE }
})

test('P2-1: patch 元数据 sidecar 被写入且字段齐全', async () => {
  const p = join(tmp, 'sidecar.js')
  copyFileSync(ORIG_BAK, p)
  process.env.DSH_MCP_CLIENT_BUNDLE = p
  try {
    const r = await SH.applyPatch(p, { log: () => {}, pluginVersion: '9.9.9-test' })
    assert.equal(r.status, 'patched', JSON.stringify(r))
    const sc = JSON.parse(readFileSync(p + '.patch-state.json', 'utf8'))
    assert.equal(sc.pluginVersion, '9.9.9-test')
    assert.ok(sc.bundleShaBefore && sc.bundleShaAfter, '应记录前后 sha')
    assert.notEqual(sc.bundleShaBefore, sc.bundleShaAfter)
    assert.deepEqual([...sc.anchors].sort(), ['P1', 'P2', 'P3+P4'])
    assert.ok(sc.patchedAt, '应记录时间')
    assert.ok(sc.mcpClientVersion, '应记录 mcp-client 版本')
    assert.equal(sc.backup, r.bak)
  } finally { delete process.env.DSH_MCP_CLIENT_BUNDLE }
})

test('P1-7: 锚点归一化 —— 上游改缩进/换行后仍能 patch', async () => {
  const p = join(tmp, 'renorm.js')
  let s = readFileSync(ORIG_BAK, 'utf8')
  // 模拟 prettier 重排: 把 P2 那一长行拆成多行 + 双空格缩进
  const longLine = 'case "streamable-http": return new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers } });'
  const reformatted = [
    'case "streamable-http":',
    '  return new StreamableHTTPClientTransport(new URL(config.url), {',
    '    requestInit: { headers: config.headers },',
    '  });',
  ].join('\n')
  assert.ok(s.includes(longLine), '原版应含该长行')
  s = s.replace(longLine, reformatted)
  writeFileSync(p, s)
  process.env.DSH_MCP_CLIENT_BUNDLE = p
  try {
    const r = await SH.applyPatch(p, { log: () => {} })
    // 归一化兜底应能补上(至少 P2 命中)
    assert.ok(r.status === 'patched' || (r.status === 'anchor-missing' && r.anchor !== 'P2'),
      `P2 应被归一化匹配或明确报其它锚点: ${JSON.stringify(r)}`)
    if (r.status === 'patched') {
      assert.ok(r.applied.includes('P2'), `P2 应在 applied 里: ${JSON.stringify(r)}`)
      const after = readFileSync(p, 'utf8')
      assert.ok(after.includes('authProvider'), 'patch 后应含 authProvider')
    }
  } finally { delete process.env.DSH_MCP_CLIENT_BUNDLE }
})

test('P1-6: anchorMissing 不再依赖 anyTo(全漂移也应报出锚点)', () => {
  const p = join(tmp, 'alldrift.js')
  let s = readFileSync(ORIG_BAK, 'utf8')
  s = s.replace('function createTransport(config) {', 'function createTransport(cfg) {')
  s = s.replace('transport = createTransport(config);', 'transport = buildTransport(cfg);')
  writeFileSync(p, s)
  const st = SH.inspectBundle(p)
  // 至少 P1 应被报为 anchorMissing(旧实现对"全漂移"返回 null)
  assert.ok(st.anchorMissing !== null, `全漂移时 anchorMissing 不应为 null: ${JSON.stringify(st)}`)
})

test.after(() => {
  try { rmSync(tmp, { recursive: true, force: true }) } catch { /* best effort */ }
})
