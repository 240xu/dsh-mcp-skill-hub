/**
 * 验证 1: resolveRowId 在真实 patch 上跑一遍。
 * 只读，不写任何文件。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const HUB = '/data/data/com.termux/files/home/dsh-plugins-src/dsh-mcp-skill-hub'
const { __internals } = await import(HUB + '/lib/index.js')

const PATCH = join(process.env.HOME, '.dsh/profiles/web/cordis.patch.yml')
console.log('真实 patch:', PATCH)

const { readMcpRows } = __internals
const fakeCtx = { get: () => undefined }
const { rows } = readMcpRows(PATCH, fakeCtx)

console.log('\n=== 所有 MCP 行（含 serverName/url/transport）===')
for (const r of rows) {
  console.log(`  id=${r.id}  serverName=${r.config?.serverName ?? '(无)'}  transport=${r.config?.transport ?? '?'}  enabled=${r.enabled}  url=${r.config?.url ?? '-'}`)
}

// resolveRowId 的同形实现（与 lib/index.js 内一致，抽出来便于单跑）
function resolveRowId(serverName, config, rows) {
  const url = typeof config?.url === 'string' ? config.url : ''
  const hit = rows.filter((r) =>
    r.config?.serverName === serverName && (url === '' || r.config?.url === url))
  return { rowId: hit.length === 1 ? hit[0].id : undefined, hitLength: hit.length }
}

console.log('\n=== 对每个 http 行跑 resolveRowId(serverName, config) ===')
let bad = 0
for (const r of rows) {
  if (r.config?.transport !== 'streamable-http') continue
  const sn = r.config?.serverName
  if (!sn) { console.log(`  ⚠️ id=${r.id} 无 serverName, 跳过`); continue }
  const { rowId, hitLength } = resolveRowId(sn, { url: r.config.url }, rows)
  const ok = rowId === r.id && hitLength === 1
  if (!ok) bad++
  console.log(`  ${ok ? '✅' : '❌'} serverName=${sn.padEnd(14)} url=${String(r.config.url).padEnd(46)} hit.length=${hitLength} → rowId=${rowId ?? 'undefined'}`)
}

console.log('\n=== 反向: 若底座用 serverName 直接索引(原缺陷) 会怎样 ===')
for (const r of rows) {
  if (r.config?.transport !== 'streamable-http') continue
  const sn = r.config?.serverName
  if (!sn) continue
  const same = sn === r.id
  console.log(`  ${same ? '⚠️ 巧合相同' : '❌ 不同'}  行id=${r.id.padEnd(16)} serverName=${sn}`)
}

console.log(`\n映射异常行数: ${bad}`)
process.exit(bad === 0 ? 0 : 1)
