/**
 * 验证 2: try/catch 是否真的覆盖 readMcpRows 自身。
 * 实测三种故障注入，确认没有异常冒泡到调用方（= 不会到 connectGeneration）。
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const HUB = '/data/data/com.termux/files/home/dsh-plugins-src/dsh-mcp-skill-hub'
const { apply } = await import(HUB + '/lib/index.js')

const tmpdirs = []
function sandbox(withPatch = true) {
  const dir = mkdtempSync('/data/data/com.termux/files/usr/tmp/opencode/v2-')
  tmpdirs.push(dir)
  const patchPath = join(dir, 'cordis.patch.yml')
  if (withPatch) {
    writeFileSync(patchPath, [
      '- insert:',
      '    - id: mcp-cloudflare',
      "      name: '@deepseek-ai/dsh-mcp-client'",
      '      config:',
      '        serverName: cloudflare',
      '        transport: streamable-http',
      '        url: https://mcp.cloudflare.com/mcp',
      '',
    ].join('\n'))
  }
  return { dir, patchPath }
}

let fails = 0
const T = (ok, msg) => { if (!ok) fails++; console.log((ok ? '✅ ' : '❌ ') + msg) }

function mount(s) {
  delete globalThis.__dshMcpSkillHubMounted
  const warns = []
  const ctx = {
    logger: { info: () => {}, warn: (m) => warns.push(String(m)) },
    effect: (fn) => fn(),
    get: (n) => {
      if (n === 'loader') return { entries: () => [] }
      return undefined
    },
    provide: (name, svc) => { ctx.__svc = svc },
    webServer: { register: () => () => {} },
    skills: { list: async () => [] },
  }
  apply(ctx, { dshHome: s.dir, agentsHome: join(s.dir, 'a'), profileDir: s.dir, patchPath: s.patchPath })
  return { ctx, warns }
}

console.log('=== 2a: patch 文件不存在 → readMcpRows 抛 ENOENT → resolveRowId 吞掉 ===')
{
  const s = sandbox(false)          // 不写 patch 文件
  const { ctx, warns } = mount(s)
  let threw = null
  let ret
  try { ret = ctx.__svc?.getAuthProvider('cloudflare', { url: 'https://mcp.cloudflare.com/mcp' }) }
  catch (e) { threw = e }
  T(threw === null, `getAuthProvider 未抛错(实际: ${threw ? threw.message : '未抛'})`)
  T(ret !== undefined, `仍返回 provider(退回 serverName 索引): ${ret ? 'yes' : 'undefined'}`)
  T(warns.some((w) => /ENOENT|mcpAuth/.test(w)), `有 warn 日志记录(不静默): ${warns.length} 条`)
}

console.log('\n=== 2b: config 异常形状(让 createAuthProvider 抛) → getAuthProvider 吞掉 ===')
{
  const s = sandbox(true)
  const { ctx, warns } = mount(s)
  let threw = null
  let ret
  try { ret = ctx.__svc?.getAuthProvider('', { url: 'https://x/mcp' }) }   // 空 serverName → key 空 → createAuthProvider 抛
  catch (e) { threw = e }
  T(threw === null, `getAuthProvider 未抛错(实际: ${threw ? threw.message : '未抛'})`)
  T(ret === undefined, `返回 undefined(降级): ${ret}`)
}

console.log('\n=== 2c: ctx.get 抛错(底座 ctx 异常) → 仍不冒泡 ===')
{
  const s = sandbox(true)
  delete globalThis.__dshMcpSkillHubMounted
  const ctx = {
    logger: { info: () => {}, warn: () => {} },
    effect: (fn) => fn(),
    get: (n) => { throw new Error('ctx.get boom') },
    provide: (name, svc) => { ctx.__svc = svc },
    webServer: { register: () => () => {} },
    skills: { list: async () => [] },
  }
  let applyThrew = null
  try { apply(ctx, { dshHome: s.dir, agentsHome: join(s.dir, 'a'), profileDir: s.dir, patchPath: s.patchPath }) } catch (e) { applyThrew = e }
  T(applyThrew === null, `apply 本身未抛(实际: ${applyThrew ? applyThrew.message : '未抛'})`)
  let gtpThrew = null
  try { ctx.__svc?.getAuthProvider('cloudflare', { url: 'https://mcp.cloudflare.com/mcp' }) } catch (e) { gtpThrew = e }
  T(gtpThrew === null, `getAuthProvider 未抛(实际: ${gtpThrew ? gtpThrew.message : '未抛'})`)
}

console.log('\n=== 2d: authPath 是目录(读必失败) → provider 仍构造成功, tokens() 返 undefined ===')
{
  const s = sandbox(true)
  const authAsDir = join(s.dir, 'auth-is-dir')
  const { mkdirSync } = await import('node:fs')
  mkdirSync(authAsDir, { recursive: true })
  delete globalThis.__dshMcpSkillHubMounted
  const ctx = {
    logger: { info: () => {}, warn: () => {} },
    effect: (fn) => fn(),
    get: (n) => {
      if (n === 'loader') return { entries: () => [] }
      return undefined
    },
    provide: (name, svc) => { ctx.__svc = svc },
    webServer: { register: () => () => {} },
    skills: { list: async () => [] },
  }
  apply(ctx, { dshHome: s.dir, agentsHome: join(s.dir, 'a'), profileDir: s.dir, patchPath: s.patchPath })
  // 直接造一个指向目录的 provider
  const { createAuthProvider } = await import(HUB + '/lib/oauth-provider.js')
  const p = createAuthProvider({ name: 'mcp-cloudflare', serverUrl: 'https://mcp.cloudflare.com/mcp', filePath: authAsDir })
  let threw = null
  let tokens
  try { tokens = p.tokens() } catch (e) { threw = e }
  T(threw === null, `tokens() 未抛(实际: ${threw ? threw.message : '未抛'})`)
  T(tokens === undefined, `tokens() 返 undefined: ${tokens}`)
}

for (const d of tmpdirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\nfails: ${fails}`)
process.exit(fails === 0 ? 0 : 1)
