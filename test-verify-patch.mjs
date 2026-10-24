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
import { mkdtempSync, writeFileSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

import { fileURLToPath } from 'node:url'
import { dirname, join as pjoin } from 'node:path'
const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = pjoin(HERE, 'scripts', 'verify-patch-applied.sh')
const ORIG = '/data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js.bak-20261021T113912Z'

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

test('已 patch 的 bundle → exit 0 + 报告 PATCHED', () => {
  const p = join(dir, 'patched.js')
  copyFileSync(ORIG.replace('.bak-20261021T113912Z', ''), p)  // 生产版(已 patch)
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
