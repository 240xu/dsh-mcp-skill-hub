/**
 * verify-patch-applied.sh 的行为测试 —— 先红后绿(铁律 9)。
 *
 * 覆盖: 已 patch / 未 patch / 文件不存在 / 半 patch / 输出不泄露凭据。
 *
 * 背景: dsh 升级会把 patch 掉的 mcp-client bundle 换回上游原版 → OAuth 静默失效。
 * 本测试保证检测脚本能识别全部四种状态。
 *
 * 运行: node --test test-verify-patch.mjs
 */

/**
 * verify-patch-applied.sh 的行为测试(先红后绿)。
 * 用一个假 bundle 文件测三种状态: 已 patch / 未 patch / 文件不存在。
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, copyFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import * as SH from './lib/self-heal.mjs'
import assert from 'node:assert/strict'

import { fileURLToPath } from 'node:url'
import { dirname, join as pjoin } from 'node:path'
const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = pjoin(HERE, 'scripts', 'verify-patch-applied.sh')
const INSTALLED_PATH = '/data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js'
/**
 * 原版样本: 动态定位, 不硬编码某次安装留下的时间戳备份。
 * 2026-11-06: 硬编码的 .bak-20261021T113912Z 被 dsh 升级清掉后, 本文件
 * 三个用例直接 ENOENT —— 测试依赖生产目录的历史残留是脆弱设计。
 */
function pickOrig() {
  const cands = [INSTALLED_PATH + '.bak-selfheal']
  try {
    const dir = INSTALLED_PATH.slice(0, INSTALLED_PATH.lastIndexOf('/'))
    const base = INSTALLED_PATH.slice(INSTALLED_PATH.lastIndexOf('/') + 1)
    for (const n of readdirSync(dir)) {
      if (n.startsWith(base + '.bak-') && !n.endsWith('.sha256') && !n.endsWith('.bak-selfheal')) {
        cands.push(dir + '/' + n)
      }
    }
  } catch {}
  for (const c of cands) if (existsSync(c)) return c
  return null
}
const ORIG = pickOrig()
if (!ORIG) {
  // 没有原版备份就无从验证「未 patch / 半 patch」两种形态, 明确 skip 而非崩溃
  console.error('SKIP: 未找到 dsh-mcp-client 的原版备份(.bak-selfheal / .bak-<ts>)')
  process.exit(0)
}

/**
 * 经 bash 调用, 不直接执行脚本文件:
 * 脚本的 shebang 是 `#!/usr/bin/env bash`(Linux/macOS 可移植),
 * 但 Termux 没有 /usr/bin/env 这个绝对路径, 直接 exec 会 ENOENT。
 * README 教用户 `bash scripts/xxx.sh` 也是这个原因。
 */
function run(bundlePath) {
  try {
    const out = execFileSync('bash', [SCRIPT, bundlePath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') }
  }
}

const dir = mkdtempSync('/data/data/com.termux/files/usr/tmp/opencode/vp-')

test('已 patch 的 bundle → exit 0 + 报告 PATCHED', async () => {
  const p = join(dir, 'patched.js')
  // 0.3.6 起生产 bundle 默认是官方原版, 不能直接当"已 patch"夹具。
  // 用自愈模块对临时副本打一次, 得到稳定的已 patch 输入。
  copyFileSync(ORIG, p)
  process.env.DSH_MCP_CLIENT_BUNDLE = p
  try { await SH.selfHealOauthSeam({ autoFix: true, log: () => {} }) }
  finally { delete process.env.DSH_MCP_CLIENT_BUNDLE }
  const r = run(p)
  assert.equal(r.code, 0, `应 exit 0, 实际 ${r.code}: ${r.out}`)
  assert.match(r.out, /PATCHED|已patch/, '应报告已 patch')
})

test('未 patch 的 bundle(上游原版) → exit 1 + 报告 NOT-PATCHED', () => {
  const p = join(dir, 'orig.js')
  copyFileSync(ORIG, p)
  const r = run(p)
  assert.equal(r.code, 1, `应 exit 1, 实际 ${r.code}: ${r.out}`)
  assert.match(r.out, /NOT-PATCHED|未patch|not patched/i, '应报告未 patch')
  assert.match(r.out, /patch-installed\.sh|apply/, '应提示如何修复')
})

test('bundle 文件不存在 → exit 2 + 明确错误', () => {
  const r = run(join(dir, 'nope.js'))
  assert.equal(r.code, 2, `应 exit 2, 实际 ${r.code}: ${r.out}`)
  assert.match(r.out, /不存在|not found|NO.?FILE/i, '应报告文件不存在')
})

test('只 patch 了一部分 → exit 1(不静默通过)', () => {
  // 只改签名不改传参: 半 patch 状态必须报警
  const p = join(dir, 'half.js')
  copyFileSync(ORIG, p)
  execFileSync('sed', ['-i', 's/function createTransport(config) {/function createTransport(config, authProvider) {/', p])
  const r = run(p)
  assert.equal(r.code, 1, `半 patch 应 exit 1, 实际 ${r.code}: ${r.out}`)
})

test('输出不得泄露 token/secret', () => {
  const p = join(dir, 'orig2.js')
  copyFileSync(ORIG, p)
  const r = run(p)
  // 脚本只做结构检查, 不应输出凭据。检查不含长随机串。
  assert.ok(!/[A-Za-z0-9_-]{40,}/.test(r.out), '输出不应含长随机串(疑似凭据)')
})
