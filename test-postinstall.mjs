/**
 * ⚠️ 已废弃 —— 保留作历史记录, 不随 npm 包分发, 也不进 run-tests.sh。
 *
 * 背景: 曾用 postinstall 实现「npm 即装即用」。后被两个实证否决:
 *   1. npm 12 起默认阻止依赖的 install scripts(需 `npm install-scripts approve`);
 *   2. 更严重: pnpm 11 遇 scripts.postinstall 会以 ERR_PNPM_IGNORED_BUILDS
 *      把 `dsh plugin add` 卡到 exit 1, 而 dsh 的 CLI 路径不传 approvedBuilds
 *      (只有 Web UI 传) —— 官方安装命令直接不可用。
 * 现方案: lib/self-heal.mjs 的运行时自愈(见 test-self-heal.mjs)。
 *
 * 若仍要本地验证这份脚本: node --test test-postinstall.mjs
 *
 * 原说明:
 * postinstall.mjs 的行为测试 —— 先红后绿(铁律 9)。
 *
 * 背景: 用户要求「npm 即装即用」。postinstall 自动给 dsh 的 mcp-client 打
 * OAuth seam 补丁,让装完重启 profile 即可用 OAuth。
 *
 * 覆盖三种场景:
 *   1. 已 patch 的 bundle  → 幂等跳过, exit 0
 *   2. 未 patch 的 bundle  → 自动 patch, exit 0, 事后 verify 通过
 *   3. bundle 不存在       → 警告但不阻断安装, exit 0
 *   4. 半 patch            → 补全, exit 0
 *   5. patch 失败(备份失败/写失败) → 不阻断安装, exit 0
 *
 * 运行: node --test test-postinstall.mjs
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, copyFileSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(HERE, 'scripts', 'postinstall.mjs')

// 上游原版 bundle(未 patch) 与已 patch 版
const INSTALLED = '/data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js'
const ORIG_BAK = INSTALLED + '.bak-20261021T113912Z'

// postinstall 用环境变量注入 bundle 路径(便于测试隔离, 不影响生产探测逻辑)。
// DSH_MCP_CLIENT_BUNDLE=<不存在的路径> 且 DSH_POSTINSTALL_NO_FALLBACK=1 → 跳过全部探测。
function run(bundlePath, extraEnv = {}) {
  const r = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, DSH_MCP_CLIENT_BUNDLE: bundlePath || '', ...extraEnv },
    timeout: 30000,
  })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

const tmp = mkdtempSync('/data/data/com.termux/files/usr/tmp/opencode/pi-')
const patched = join(tmp, 'patched.js')
const pristine = join(tmp, 'pristine.js')
copyFileSync(INSTALLED, patched)      // 生产版 = 已 patch
copyFileSync(ORIG_BAK, pristine)      // 上游原版 = 未 patch

test('场景 1: 已 patch 的 bundle → 幂等跳过, exit 0', () => {
  const before = readFileSync(patched, 'utf8')
  const r = run(patched)
  assert.equal(r.code, 0, `应 exit 0: ${r.out}`)
  assert.match(r.out, /已.*patch|already|跳过|skip/i, '应报告已 patch')
  assert.equal(readFileSync(patched, 'utf8'), before, '已 patch 时不得改动 bundle')
})

test('场景 2: 未 patch 的 bundle → 自动 patch, exit 0, 事后 verify 通过', () => {
  const r = run(pristine)
  assert.equal(r.code, 0, `应 exit 0: ${r.out}`)
  const after = readFileSync(pristine, 'utf8')
  // 三处结构特征都应在
  assert.ok(after.includes('function createTransport(config, authProvider)'), 'P1 签名未 patch')
  assert.ok(after.includes('requestInit: { headers: config.headers }, authProvider'), 'P2 透传未 patch')
  assert.ok(after.includes('ctx.get("mcpAuth", false)?.getAuthProvider'), 'P3/P4 调用点未 patch')
  // 备份应生成
  const baks = existsSync(pristine + '.bak-postinstall')
  assert.ok(baks, '应生成 .bak-postinstall 备份')
})

test('场景 2b: 自动 patch 后原版可回滚(备份内容 == 上游原版)', () => {
  const bak = pristine + '.bak-postinstall'
  assert.ok(existsSync(bak), '备份应存在')
  assert.equal(readFileSync(bak, 'utf8'), readFileSync(ORIG_BAK, 'utf8'),
    '备份内容应与上游原版逐字节一致')
})

test('场景 3: bundle 不存在 → 警告但不阻断安装(exit 0)', () => {
  const r = run(join(tmp, 'no-such-bundle.js'), { DSH_POSTINSTALL_NO_FALLBACK: '1' })
  assert.equal(r.code, 0, `bundle 缺失时仍应 exit 0(不阻断安装): ${r.out}`)
  assert.match(r.out, /未找到|not found|找不到|no bundle/i, '应警告说明原因')
  assert.match(r.out, /verify-patch-applied|patch-installed|手工|手动|manual/i,
    '应告诉用户事后如何手工处理')
})

test('场景 4: 半 patch → 补全剩余锚点', () => {
  const half = join(tmp, 'half.js')
  // 只 patch 签名, 其余保持原版
  let s = readFileSync(ORIG_BAK, 'utf8')
  s = s.replace('function createTransport(config) {', 'function createTransport(config, authProvider) {')
  writeFileSync(half, s)
  const r = run(half)
  assert.equal(r.code, 0, `应 exit 0: ${r.out}`)
  const after = readFileSync(half, 'utf8')
  assert.ok(after.includes('requestInit: { headers: config.headers }, authProvider'), '半 patch 未补全')
  assert.ok(after.includes('ctx.get("mcpAuth", false)?.getAuthProvider'), '半 patch 未补全调用点')
})

test('场景 6: 已 patch 的真实生产 bundle → 幂等识别(缩进回归) ', () => {
  // 回归: 初版把 P3+P4 的 to 写成 4 tab(实际 3 tab), 导致已 patch 的生产
  // bundle 被误判为「锚点未命中」。测试用原版 bundle, 抓不到这个错——
  // 必须直接对生产已 patch 的 bundle 断言。
  if (!existsSync(INSTALLED)) return   // 非本机环境跳过
  const before = readFileSync(INSTALLED, 'utf8')
  const r = run(INSTALLED)
  assert.equal(r.code, 0)
  assert.match(r.out, /已就位|already|幂等/, `已 patch 应被识别: ${r.out}`)
  assert.equal(readFileSync(INSTALLED, 'utf8'), before, '已 patch 时严禁改动')
})

test('场景 6b: ANCHORS 的 to 字符串缩进与真实 patched bundle 一致', () => {
  // 直接解析 postinstall.mjs 的 ANCHORS, 逐条比对 patched bundle 的实际文本。
  if (!existsSync(INSTALLED)) return
  const src = readFileSync(SCRIPT, 'utf8')
  const bundle = readFileSync(INSTALLED, 'utf8')
  for (const id of ['P1', 'P2', 'P3+P4']) {
    const m = new RegExp(`id: '${id.replace('+', '\\+')}',[\\s\\S]*?to: '(.*?)',`).exec(src)
    assert.ok(m, `ANCHORS 里应找到 ${id}`)
    const to = m[1].replace(/\\n/g, '\n').replace(/\\t/g, '\t')
    assert.ok(bundle.includes(to), `${id} 的 to 字符串未出现在已 patch 的 bundle 中(缩进/内容不符)`)
  }
})

test('场景 5: bundle 内容异常(非预期形态) → 不阻断安装, exit 0', () => {
  const junk = join(tmp, 'junk.js')
  writeFileSync(junk, 'console.log("not a dsh bundle")\n')
  const r = run(junk)
  assert.equal(r.code, 0, `异常 bundle 仍应 exit 0(不阻断安装): ${r.out}`)
  assert.match(r.out, /跳过|skip|形态|anchor|锚点|不是/i, '应说明跳过的原因')
  assert.equal(readFileSync(junk, 'utf8'), 'console.log("not a dsh bundle")\n',
    '形态不符时不得改动文件')
})

test('输出不得泄露 token/secret(安全红线)', () => {
  const r = run(pristine)
  assert.ok(!/[A-Za-z0-9_-]{40,}/.test(r.out), '输出不应含长随机串(疑似凭据)')
})

test.after(() => {
  try { rmSync(tmp, { recursive: true, force: true }) } catch { /* best effort */ }
})
