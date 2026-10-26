#!/usr/bin/env node
/**
 * postinstall —— 装完自动给 dsh 的 mcp-client 打 OAuth seam 补丁,
 * 让 dsh-mcp-skill-hub 真正做到「npm 即装即用」。
 *
 * 为什么需要: MCP SDK 2.2.0 原生有完整 OAuth 能力, 但 dsh 上游的
 * createTransport 不透传 authProvider, SDK 收不到 provider。补丁只改 3 处
 * (见 scripts/patch-installed.sh 的 P1-P4)。
 *
 * 设计原则(安装副作用的最小化):
 *   1. **永不阻断安装** —— 任何失败都只警告 + exit 0。npm install 失败比
 *      OAuth 不可用严重得多。
 *   2. **幂等** —— 已 patch 则原样不动。
 *   3. **必留备份** —— patch 前写 .bak-postinstall, 内容与上游原版逐字节一致。
 *   4. **多路径定位** —— 不硬编码 Termux 路径; 依次试环境变量 / npm 全局前缀 /
 *      require.resolve / 常见安装位置。
 *   5. **不泄露凭据** —— 输出只含路径、sha256 与状态词(铁律 6)。
 *
 * 退出码: 恒 0(除非脚本自身崩溃, 那时 npm 会显示但不阻断)。
 */

import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { createRequire } from 'node:module'

const HERE = dirname(fileURLToPath(import.meta.url))
const req = createRequire(join(HERE, 'index.js'))

// ── 三处结构特征(与 patch-installed.sh / verify-patch-applied.sh 同口径) ──
const ANCHORS = [
  {
    id: 'P1',
    name: 'createTransport 签名接受 authProvider',
    from: 'function createTransport(config) {',
    to: 'function createTransport(config, authProvider) {',
  },
  {
    id: 'P2',
    name: 'StreamableHTTPClientTransport 透传 authProvider',
    from: 'case "streamable-http": return new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers } });',
    to: 'case "streamable-http": return new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers }, authProvider });',
  },
  {
    id: 'P3+P4',
    name: '调用点从 ctx.get("mcpAuth") 取 provider 并传入',
    from: 'transport = createTransport(config);',
    to: 'const authProvider = ctx.get("mcpAuth", false)?.getAuthProvider(config.serverName, config);\n\t\t\ttransport = createTransport(config, authProvider);',
  },
]

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

// ── 1. 定位 bundle(多路径探测, 不硬编码) ──
function findBundle() {
  const tries = []

  // a) 测试/调试注入。不存在则忽略(否则假路径会掩盖真实探测, 且测试无法隔离)
  if (process.env.DSH_MCP_CLIENT_BUNDLE && existsSync(process.env.DSH_MCP_CLIENT_BUNDLE)) {
    tries.push(['env DSH_MCP_CLIENT_BUNDLE', process.env.DSH_MCP_CLIENT_BUNDLE])
  }

  // 测试专用: 只信 env, 不探测真实环境(用于模拟「bundle 不存在」场景)
  if (process.env.DSH_POSTINSTALL_NO_FALLBACK) return null

  // b) npm 全局前缀(Termux: /data/data/com.termux/files/usr)
  try {
    const prefix = execSync('npm prefix -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    if (prefix) {
      tries.push([`npm prefix -g (${prefix})`, join(prefix, 'lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js')])
      tries.push([`npm prefix -g/${'node_modules'}`, join(prefix, 'node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js')])
    }
  } catch { /* npm 不可用 */ }

  // c) require.resolve(从 Hub 位置与进程路径解析)
  for (const paths of [HERE, process.cwd()]) {
    try {
      const pkg = req.resolve('@deepseek-ai/dsh-mcp-client/package.json', { paths: [paths] })
      tries.push([`require.resolve (${paths})`, join(dirname(pkg), 'lib/index.js')])
    } catch { /* 不在依赖树 */ }
  }

  // d) 常见绝对位置兜底
  tries.push(['termux 全局', '/data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js'])
  tries.push(['linux 全局', '/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js'])
  tries.push(['npm 全局 node_modules', '/usr/local/lib/node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js'])

  for (const [via, p] of tries) {
    if (p && existsSync(p)) return { path: p, via }
  }
  return null
}

// ── 2. patch(幂等 + 备份 + 逐锚点校验) ──
function patchBundle(bundlePath) {
  const original = readFileSync(bundlePath)
  let text = original.toString('utf8')

  const state = ANCHORS.map((a) => {
    const alreadyTo = text.includes(a.to)
    const hasFrom = text.includes(a.from)
    return { ...a, alreadyTo, hasFrom }
  })

  // 形态判定: 没有任一 from 且没有任一 to → 不是预期的 bundle
  const anyFrom = state.some((s) => s.hasFrom)
  const anyTo = state.some((s) => s.alreadyTo)
  if (!anyFrom && !anyTo) {
    return { status: 'not-applicable', applied: [], skipped: [] }
  }

  const applied = []
  const skipped = []
  let next = text
  for (const a of state) {
    if (a.alreadyTo) { skipped.push(a.id); continue }
    if (!a.hasFrom) {
      // 有其它锚点命中但这个没有 → 形态变体, 不猜
      return { status: 'anchor-missing', anchor: a.id, applied, skipped }
    }
    next = next.replace(a.from, a.to)
    applied.push(a.id)
  }

  if (applied.length === 0) {
    return { status: 'already', applied: [], skipped }
  }

  // 备份(只在真要写时)
  const bak = bundlePath + '.bak-postinstall'
  if (!existsSync(bak)) copyFileSync(bundlePath, bak)

  // 写后逐字节校验: 不符则恢复
  writeFileSync(bundlePath, next)
  const verify = readFileSync(bundlePath).toString('utf8')
  for (const a of ANCHORS) {
    if (!verify.includes(a.to)) {
      writeFileSync(bundlePath, original)
      return { status: 'verify-failed', anchor: a.id, applied, skipped }
    }
  }
  return { status: 'patched', applied, skipped }
}

// ── main ──
function main() {
  const found = findBundle()
  if (!found) {
    console.log('[dsh-mcp-skill-hub] postinstall: 未找到 dsh 的 mcp-client bundle')
    console.log('  → OAuth 需要该补丁才能工作; 装完 dsh 后手工执行:')
    console.log('    <本插件目录>/scripts/patch-installed.sh --apply')
    console.log('  → 或运行 <本插件目录>/scripts/verify-patch-applied.sh 体检')
    return 0
  }

  const before = sha256(readFileSync(found.path))
  let r
  try {
    r = patchBundle(found.path)
  } catch (e) {
    console.log(`[dsh-mcp-skill-hub] postinstall: patch 失败(${e.message})`)
    console.log('  → 不影响安装; 手工执行 scripts/patch-installed.sh --apply')
    return 0
  }

  const after = sha256(readFileSync(found.path))
  console.log(`[dsh-mcp-skill-hub] postinstall: bundle 定位成功 (via ${found.via})`)

  switch (r.status) {
    case 'already':
      console.log('  ✅ OAuth seam 已就位(幂等跳过)')
      break
    case 'patched':
      console.log(`  ✅ OAuth seam 补丁已应用: ${r.applied.join(', ')}`)
      console.log(`     备份: ${found.path}.bak-postinstall`)
      console.log(`     sha256: ${before.slice(0, 16)}… → ${after.slice(0, 16)}…`)
      console.log('     重启 dsh profile 后 OAuth 即可用')
      break
    case 'not-applicable':
      console.log('  ⚠ 该 bundle 不含预期的 createTransport 形态, 已跳过(未改动)')
      console.log('     dsh 版本可能已变; 如 OAuth 不可用, 手工跑 scripts/verify-patch-applied.sh')
      break
    case 'anchor-missing':
      console.log(`  ⚠ 锚点 ${r.anchor} 未命中(bundle 形态可能已变), 已跳过(未改动)`)
      console.log('     如 OAuth 不可用, 手工跑 scripts/patch-installed.sh 看详细报告')
      break
    case 'verify-failed':
      console.log(`  ⚠ 写入后校验失败(锚点 ${r.anchor}), 已自动恢复原文件`)
      console.log('     不影响安装; 请手工跑 scripts/patch-installed.sh')
      break
    default:
      console.log(`  ⚠ 未知状态 ${r.status}, 未改动`)
  }
  return 0
}

process.exit(main())
