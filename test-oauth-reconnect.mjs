/**
 * 冷启动补偿重连测试 —— 追问 1 场景 A 的补偿（TDD 先红）。
 *
 * 背景（Cordis 可见性实测结论）：mcp-client 若先于 Hub mount，其
 * startConnection 里的 ctx.get('mcpAuth') 首读为 undefined，且 consumer
 * 已跑完不会被唤醒 → 冷启动有 token 的 MCP 行也拿不到 authProvider。
 *
 * 补偿：Hub 在 apply 末尾
 *   1. provide mcpAuth 后，读 mcp-auth.json 中所有有 tokens 的 entry
 *   2. 与 patch 中 enabled 的 http 行求交集
 *   3. 对交集每行触发一次重载（复用 applyAfterWrite 的 pm.reload 路径）
 *   4. setTimeout(0) 延到下一 tick
 *   5. 幂等、失败不阻塞启动、不无限重试
 *
 * 运行: node --test test-oauth-reconnect.mjs
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const HUB = '/data/data/com.termux/files/home/dsh-plugins-src/dsh-mcp-skill-hub'
let apply = null
let authStore = null
try {
  apply = (await import(HUB + '/lib/index.js')).apply
  authStore = await import(HUB + '/lib/auth-store.js')
} catch (error) {
  apply = null
}

test('lib/index.js 可加载（实现缺失即失败，不是 skip）', () => {
  assert.ok(apply, 'lib/index.js 应可 import')
  assert.ok(authStore, 'lib/auth-store.js 应可 import')
})

const tmpdirs = []
let uid = 0
const nextId = () => 'mcp-r' + (++uid)

function sandbox(id) {
  const dir = mkdtempSync('/data/data/com.termux/files/usr/tmp/opencode/rc-')
  tmpdirs.push(dir)
  const patchPath = join(dir, 'cordis.patch.yml')
  writeFileSync(patchPath, [
    '# 用户注释',
    '- insert:',
    '    - id: ' + id,
    "      name: '@deepseek-ai/dsh-mcp-client'",
    '      config:',
    '        serverName: demo',
    '        transport: streamable-http',
    '        url: https://demo.example.com/mcp',
    '',
  ].join('\n'))
  return { dir, patchPath, authPath: join(dir, 'mcp-auth.json') }
}
test.after(() => { for (const d of tmpdirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} } })

const MOUNT_KEY = '__dshMcpSkillHubMounted'

/** 造一个带 reload 计数的 ctx。 */
function env(s, id, { hmr = true, tokens = true } = {}) {
  delete globalThis[MOUNT_KEY]
  const reloads = []
  const ctx = {
    logger: { info: () => {}, warn: () => {} },
    effect: (fn) => fn(),
    get: (n) => {
      if (n === 'loader') return { entries: () => [{ options: { id }, fiber: {} }] }
      if (n === 'hmr') return hmr ? {} : undefined
      if (n === 'pluginManager') return { reload: async (ids) => { reloads.push([...ids]); return 'ok' } }
      return undefined
    },
    provide: () => {},
    webServer: { register: () => () => {} },
    skills: { list: async () => [] },
  }
  apply(ctx, { dshHome: s.dir, agentsHome: join(s.dir, 'agents'), profileDir: s.dir, patchPath: s.patchPath })
  return { ctx, reloads }
}

/** 等补偿重连的 setTimeout(0) 触发完。 */
const tick = () => new Promise((r) => setTimeout(r, 30))

test('补偿: 有 tokens + enabled http 行 → 触发一次 reload', async () => {
  const id = nextId()
  const s = sandbox(id)
  const now = Math.floor(Date.now() / 1000)
  authStore.setTokens(s.authPath, id, { accessToken: 'AT', refreshToken: 'RT', expiresAt: now + 3600 })
  const e = env(s, id)
  await tick()
  assert.equal(e.reloads.length, 1, '应对有 token 的行触发一次 reload, 实际 ' + e.reloads.length)
  assert.deepEqual(e.reloads[0], [id], 'reload 的应是该行 id')
})

test('补偿: 无 tokens → 不触发 reload（不需要 OAuth 的行）', async () => {
  const id = nextId()
  const s = sandbox(id)
  const e = env(s, id)
  await tick()
  assert.equal(e.reloads.length, 0, '无 token 不应 reload, 实际 ' + e.reloads.length)
})

test('补偿: 无 hmr 服务 → 不触发 reload 且不抛', async () => {
  const id = nextId()
  const s = sandbox(id)
  const now = Math.floor(Date.now() / 1000)
  authStore.setTokens(s.authPath, id, { accessToken: 'AT', expiresAt: now + 3600 })
  const e = env(s, id, { hmr: false })
  await tick()
  assert.equal(e.reloads.length, 0, '无 hmr 不应 reload')
})

test('补偿: disabled 行不触发 reload（patch 里 disabled 的行不该被重载）', async () => {
  const id = nextId()
  const dir = mkdtempSync('/data/data/com.termux/files/usr/tmp/opencode/rc-')
  tmpdirs.push(dir)
  const patchPath = join(dir, 'cordis.patch.yml')
  writeFileSync(patchPath, [
    '- insert:',
    '    - id: ' + id,
    "      name: '@deepseek-ai/dsh-mcp-client'",
    '      disabled: true',
    '      config:',
    '        serverName: demo',
    '        transport: streamable-http',
    '        url: https://demo.example.com/mcp',
    '',
  ].join('\n'))
  const authPath = join(dir, 'mcp-auth.json')
  const now = Math.floor(Date.now() / 1000)
  authStore.setTokens(authPath, id, { accessToken: 'AT', expiresAt: now + 3600 })
  const reloads = []
  delete globalThis[MOUNT_KEY]
  const ctx = {
    logger: { info: () => {}, warn: () => {} },
    effect: (fn) => fn(),
    get: (n) => {
      if (n === 'loader') return { entries: () => [] }
      if (n === 'hmr') return {}
      if (n === 'pluginManager') return { reload: async (ids) => { reloads.push([...ids]); return 'ok' } }
      return undefined
    },
    provide: () => {},
    webServer: { register: () => () => {} },
    skills: { list: async () => [] },
  }
  apply(ctx, { dshHome: dir, agentsHome: join(dir, 'a'), profileDir: dir, patchPath })
  await tick()
  assert.equal(reloads.length, 0, 'disabled 行不应被 reload, 实际 ' + reloads.length)
})

test('补偿: reload 抛错不阻塞启动（幂等 + 失败静默）', async () => {
  const id = nextId()
  const s = sandbox(id)
  const now = Math.floor(Date.now() / 1000)
  authStore.setTokens(s.authPath, id, { accessToken: 'AT', expiresAt: now + 3600 })
  delete globalThis[MOUNT_KEY]
  let calls = 0
  const ctx = {
    logger: { info: () => {}, warn: () => {} },
    effect: (fn) => fn(),
    get: (n) => {
      if (n === 'loader') return { entries: () => [{ options: { id }, fiber: {} }] }
      if (n === 'hmr') return {}
      if (n === 'pluginManager') return { reload: async () => { calls++; throw new Error('reload boom') } }
      return undefined
    },
    provide: () => {},
    webServer: { register: () => () => {} },
    skills: { list: async () => [] },
  }
  await apply(ctx, { dshHome: s.dir, agentsHome: join(s.dir, 'a'), profileDir: s.dir, patchPath: s.patchPath })
  await tick()
  assert.equal(calls, 1, '应尝试一次(不无限重试), 实际 ' + calls)
})

test('补偿: 多行只 reload 有 token 的那些（交集语义）', async () => {
  const dir = mkdtempSync('/data/data/com.termux/files/usr/tmp/opencode/rc-')
  tmpdirs.push(dir)
  const idA = nextId()
  const idB = nextId()
  const patchPath = join(dir, 'cordis.patch.yml')
  writeFileSync(patchPath, [
    '- insert:',
    '    - id: ' + idA,
    "      name: '@deepseek-ai/dsh-mcp-client'",
    '      config:',
    '        serverName: a',
    '        transport: streamable-http',
    '        url: https://a.example.com/mcp',
    '    - id: ' + idB,
    "      name: '@deepseek-ai/dsh-mcp-client'",
    '      config:',
    '        serverName: b',
    '        transport: streamable-http',
    '        url: https://b.example.com/mcp',
    '',
  ].join('\n'))
  const authPath = join(dir, 'mcp-auth.json')
  const now = Math.floor(Date.now() / 1000)
  authStore.setTokens(authPath, idA, { accessToken: 'AT_A', expiresAt: now + 3600 })
  // idB 不写 tokens
  const reloads = []
  delete globalThis[MOUNT_KEY]
  const ctx = {
    logger: { info: () => {}, warn: () => {} },
    effect: (fn) => fn(),
    get: (n) => {
      if (n === 'loader') return { entries: () => [{ options: { id: idA }, fiber: {} }, { options: { id: idB }, fiber: {} }] }
      if (n === 'hmr') return {}
      if (n === 'pluginManager') return { reload: async (ids) => { reloads.push([...ids]); return 'ok' } }
      return undefined
    },
    provide: () => {},
    webServer: { register: () => () => {} },
    skills: { list: async () => [] },
  }
  apply(ctx, { dshHome: dir, agentsHome: join(dir, 'a'), profileDir: dir, patchPath })
  await tick()
  assert.equal(reloads.length, 1, '只 reload 有 token 的那行, 实际 ' + reloads.length)
  assert.deepEqual(reloads[0], [idA], 'reload 的应是 ' + idA)
})

test('补偿: 重复 apply（清守卫后强制再挂）不叠加无限重试', async () => {
  const id = nextId()
  const s = sandbox(id)
  const now = Math.floor(Date.now() / 1000)
  authStore.setTokens(s.authPath, id, { accessToken: 'AT', expiresAt: now + 3600 })
  // 共享计数器: 验证每次 apply 最多触发一次, 不会叠加
  let total = 0
  const mkctx = () => ({
    logger: { info: () => {}, warn: () => {} },
    effect: (fn) => fn(),
    get: (n) => {
      if (n === 'loader') return { entries: () => [{ options: { id }, fiber: {} }] }
      if (n === 'hmr') return {}
      if (n === 'pluginManager') return { reload: async (ids) => { total++; return 'ok' } }
      return undefined
    },
    provide: () => {},
    webServer: { register: () => () => {} },
    skills: { list: async () => [] },
  })
  delete globalThis[MOUNT_KEY]
  apply(mkctx(), { dshHome: s.dir, agentsHome: join(s.dir, 'a'), profileDir: s.dir, patchPath: s.patchPath })
  await tick()
  assert.equal(total, 1, '首次 apply 触发一次')
  // 生产里 MOUNT_KEY 守卫会挡掉重复 apply; 这里清掉守卫模拟 HMR 重复挂载
  delete globalThis[MOUNT_KEY]
  apply(mkctx(), { dshHome: s.dir, agentsHome: join(s.dir, 'a'), profileDir: s.dir, patchPath: s.patchPath })
  await tick()
  assert.equal(total, 2, '第二次 apply 再触发一次(每次 apply 一次, 不无限)')
})

test('补偿: stdio 行即使有 token 也不 reload（只补 http 行）', async () => {
  const id = nextId()
  const dir = mkdtempSync('/data/data/com.termux/files/usr/tmp/opencode/rc-')
  tmpdirs.push(dir)
  const patchPath = join(dir, 'cordis.patch.yml')
  writeFileSync(patchPath, [
    '- insert:',
    '    - id: ' + id,
    "      name: '@deepseek-ai/dsh-mcp-client'",
    '      config:',
    '        serverName: s',
    '        transport: stdio',
    '        command: /bin/echo',
    '',
  ].join('\n'))
  const authPath = join(dir, 'mcp-auth.json')
  const now = Math.floor(Date.now() / 1000)
  authStore.setTokens(authPath, id, { accessToken: 'AT', expiresAt: now + 3600 })
  const reloads = []
  delete globalThis[MOUNT_KEY]
  const ctx = {
    logger: { info: () => {}, warn: () => {} },
    effect: (fn) => fn(),
    get: (n) => {
      if (n === 'loader') return { entries: () => [{ options: { id }, fiber: {} }] }
      if (n === 'hmr') return {}
      if (n === 'pluginManager') return { reload: async (ids) => { reloads.push([...ids]); return 'ok' } }
      return undefined
    },
    provide: () => {},
    webServer: { register: () => () => {} },
    skills: { list: async () => [] },
  }
  apply(ctx, { dshHome: dir, agentsHome: join(dir, 'a'), profileDir: dir, patchPath })
  await tick()
  assert.equal(reloads.length, 0, 'stdio 行无 authProvider 概念, 不应 reload')
})
