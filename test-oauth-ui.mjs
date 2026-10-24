/**
 * client.js OAuth UI 回归。
 *
 * 三条硬要求:
 *   1. 源码级: 授权按钮 + 状态徽章 + 轮询逻辑存在（无 DOM 环境时的最低保障）
 *   2. 渲染级: 用 profile 里的真实 react 渲染 McpTab，验证 http 行出现「授权」按钮
 *      与状态徽章，stdio 行不出现
 *   3. 脱敏: UI 层不得出现 token/verifier 字样被直接渲染的逻辑
 *
 * 运行: node --test test-oauth-ui.mjs
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const HUB = '/data/data/com.termux/files/home/dsh-plugins-src/dsh-mcp-skill-hub'
const CLIENT = join(HUB, 'lib', 'client.js')

const src = readFileSync(CLIENT, 'utf8')

// ── 1. 源码级 ──
test('源码: 授权按钮调用 /oauth/start', () => {
  assert.ok(/\/oauth\/start/.test(src), '应有 /oauth/start 调用')
  assert.ok(/\/oauth\/status/.test(src), '应有 /oauth/status 轮询')
})

test('源码: window.open 带 noopener,noreferrer（防反向 tabnabbing）', () => {
  assert.ok(/window\.open\([^)]*noopener/.test(src), 'window.open 必须带 noopener')
  assert.ok(/noreferrer/.test(src), 'window.open 必须带 noreferrer')
})

test('i18n: 授权相关键齐备(zh + en 各一份)', () => {
  for (const key of ['authorize', 'authPending', 'authOk', 'authExpired', 'authFailed', 'authProbeFailed', 'authRowHint']) {
    const hits = src.match(new RegExp(key + ':', 'g')) || []
    assert.equal(hits.length, 2, `键 ${key} 应有中英各一份, 实际 ${hits.length}`)
  }
})

test('i18n: 已废弃的死键不得复活', () => {
  // 这 4 个键是 0.3.x 设计演变后遗留的(改用了 appliedHot/Watch/Restart 三态、
  // 授权行提示、通用 confirmDelete), 曾在 0.3.3 逐字审核中删掉。
  // 若有人把它们加回来, 说明要么功能退化, 要么又新增了没人调的键。
  for (const key of ['saved:', 'authNotAuth:', 'authAlready:', 'confirmDeleteSkill:']) {
    const hits = src.match(new RegExp(key, 'g')) || []
    assert.equal(hits.length, 0, `死键 ${key} 又出现了(共 ${hits.length} 处) —— 确认它是被真正调用, 而不是又一次加而不用`)
  }
})

test('源码: 授权按钮必须挂在 needsAuth 守卫后面（不预渲染给每行）', () => {
  // 新设计（用户反馈「所有 MCP 都挂授权按钮很莫名」后重做）：
  // 授权按钮只在 needsAuth() 判定为真的行出现，stdio 行永不出现。
  assert.ok(/needsAuth\(row, authStatus, needsAuthMap\) && react_jsx_runtime\.jsx\("div", \{ className: "dsh-hub-row dsh-hub-auth-row"/.test(src),
    '授权按钮必须挂在 needsAuth(row, authStatus, needsAuthMap) 守卫后面')
  assert.ok(/const needsAuth = \(row, authStatus, needsAuthMap\) => \{/.test(src),
    '应有 needsAuth 判定函数')
  // 守卫内部必须排除 stdio
  const seg = src.slice(src.indexOf('const needsAuth ='), src.indexOf('function McpTab'))
  assert.ok(/row\.config\?\.transport !== "streamable-http"/.test(seg),
    'needsAuth 必须排除非 streamable-http 行（stdio 永不显示授权）')
})

test('脱敏: UI 层不渲染 token/verifier 值', () => {
  assert.ok(!/(accessToken|access_token|code_verifier)\s*[:=]\s*[a-z]/i.test(src),
    'client.js 不得出现 token/verifier 赋值')
})

// ── 2. 渲染级（真实 react；profile 里无 react，用 dsh-tui 自带的 react 19） ──
const TUI_NM = '/data/data/com.termux/files/usr/lib/node_modules/@deepseek-harness-tui/dsh-tui/node_modules'
let renderAuthBadge = null
try {
  const req = createRequire(join(TUI_NM, 'index.js'))
  const React = req('react')
  const jsx = req('react/jsx-runtime')
  // AuthBadge 内部调用 Badge，故切片要从 Badge 定义开始取（含 AuthBadge 全体）。
  const badgeStart = src.indexOf('const Badge = ({ children, tone })')
  const mapEnd = src.indexOf('};', src.indexOf('const map =', badgeStart)) + 2
  const badgeSrc = src.slice(badgeStart, src.indexOf('\t\t};', mapEnd) + 4)
  const factory = new Function('react', 'react_jsx_runtime', 't', 'status', `
    ${badgeSrc}
    return AuthBadge({ status, t });
  `)
  renderAuthBadge = (status, t) => factory(React, jsx, t, status)
} catch (error) {
  renderAuthBadge = null
}

/**
 * 把 element tree 拍平成可搜索文本。
 * 压: className / tone / title 等字符串 props + children（断言 tone 与文案都靠它）。
 */
function flatten(node, out = []) {
  if (node == null || node === false || node === true) return out
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out }
  if (Array.isArray(node)) { for (const n of node) flatten(n, out); return out }
  const props = node.props || {}
  for (const key of ['className', 'tone', 'title', 'href']) {
    if (typeof props[key] === 'string') out.push(key + '=' + props[key])
  }
  if (typeof props.children !== 'undefined') flatten(props.children, out)
  return out
}

test('渲染: AuthBadge 只显示有授权状态的行(not_authenticated/already-works 不渲染)', { skip: renderAuthBadge === null && 'react 不可用' }, () => {
  const t = (k) => k
  const dump = (s) => flatten(renderAuthBadge(s, t)).join(' ')
  assert.match(dump('authenticated'), /authOk/)
  assert.match(dump('pending'), /authPending/)
  // 2026-10-24: expired / failed 改由授权行的黄字承担(与授权按钮同处一行),
  // 徽章不再显示 —— 分居两行会让用户以为「授权已超时」与授权按钮无关。
  assert.equal(flatten(renderAuthBadge('expired', t)).join(''), '',
    'expired 不得渲染徽章(应移到授权行黄字, 与授权按钮同行)')
  assert.equal(flatten(renderAuthBadge('failed', t)).join(''), '',
    'failed 不得渲染徽章(同上)')
  // 新设计: not_authenticated 由另起一行的黄字提示承担, 徽章不渲染
  assert.equal(flatten(renderAuthBadge('not_authenticated', t)).join(''), '',
    'not_authenticated 不得渲染徽章(交给 auth-row 黄字行)')
  // already-works = 静态 Token 已够用, 无需任何 OAuth 信息
  assert.equal(flatten(renderAuthBadge('already-works', t)).join(''), '',
    'already-works 不得渲染徽章(静态 Token 已够用)')
  // tone 正确传给内层 Badge（ok = 绿, warn = 黄）
  assert.match(dump('authenticated'), /tone=ok/)
  assert.match(dump('pending'), /tone=warn/)
  // expired/failed 已无徽章(见上), tone 断言随之移除
  // 未知/空状态 → 不渲染（null 拍平为空串）
  assert.equal(flatten(renderAuthBadge('nonsense', t)).join(''), '')
  assert.equal(flatten(renderAuthBadge(undefined, t)).join(''), '')
})

test('渲染: 授权按钮的 title 是 authHint（可访问性）', () => {
  assert.ok(/title: t\("authHint"\)/.test(src), '授权按钮应有 title=提示文案')
})

// ── 3. 轮询行为 ──
test('轮询: 10s 间隔 + alive 守卫（卸载后不再 setState）', () => {
  assert.ok(/setInterval\(poll, 10000\)/.test(src), '应 10s 轮询')
  assert.ok(/let alive = true;/.test(src), '应有 alive 守卫')
  assert.ok(/alive = false; clearInterval\(timer\)/.test(src), '卸载时应清理 timer')
})

test('轮询: 单行失败不影响其它行', () => {
  const seg = src.slice(src.indexOf('const poll = async'), src.indexOf('const startAuth'))
  assert.ok(/catch \{\s*\/\*/.test(seg), '轮询应有 try/catch 包住单行')
})

// ── 新设计回归: needsAuth 判定（学 opencode MCPStatus 口径）──
// 用户反馈「所有 MCP 都挂授权按钮很莫名」→ 重做为「要授权的才显示」。
// 这里把判定函数抽出来真实执行，不是源码级 grep。
const NEEDS_AUTH_SRC = (() => {
  const start = src.indexOf('const needsAuth = (row, authStatus, needsAuthMap) =>')
  const end = src.indexOf('function McpTab', start)
  return start >= 0 && end > start ? src.slice(start, end) : ''
})()

test('源码: needsAuth 判定函数存在', () => {
  assert.ok(NEEDS_AUTH_SRC.length > 0, '应能抽出 needsAuth 函数源码')
})

test('needsAuth: 只有明确 needs_auth 语义的状态才显示授权入口', () => {
  assert.ok(NEEDS_AUTH_SRC, '前置: needsAuth 源码可抽取')
  const factory = new Function('row', 'authStatus', 'needsAuthMap', `${NEEDS_AUTH_SRC}\nreturn needsAuth(row, authStatus, needsAuthMap)`)
  const httpRow = { id: 'r1', editable: true, config: { transport: 'streamable-http', url: 'https://x/mcp' } }
  const stdioRow = { id: 'r2', editable: true, config: { transport: 'stdio', command: 'node' } }
  const readOnly = { id: 'r3', editable: false, config: { transport: 'streamable-http', url: 'https://x/mcp' } }

  // 授权流程已在走/失败/超时 → 保留入口(让用户继续或重试)
  for (const s of ['expired', 'failed', 'pending']) {
    assert.equal(factory(httpRow, { r1: s }, {}), true, `${s} 应显示授权入口`)
  }
  // needsAuth 字段为第一依据(服务端真实探测结论)
  assert.equal(factory(httpRow, { r1: 'not_authenticated' }, { r1: true }), true, '探测 401 → 应显示授权入口')
  assert.equal(factory(httpRow, { r1: 'not_authenticated' }, { r1: 'unknown' }), true, "探测不可达(unknown) → 应显示授权入口(不猜但不隐藏)")
  assert.equal(factory(httpRow, { r1: 'not_authenticated' }, { r1: false }), false, 'needsAuth=false → 不得显示授权入口')
  assert.equal(factory(httpRow, { r1: 'not_authenticated' }, {}), false, 'needsAuth 尚未探测到(轮询未回) → 不显示')
  // ⚠️ 不用 not_authenticated 判 needs_auth: 它只表示「没有 token」。
  // 公开服务(context7/exa/parallel)也是 not_authenticated 但不需要授权 ——
  // 这正是 2026-10-22 修掉的过度渲染 bug(6 行全挂授权按钮)。
  assert.equal(factory(httpRow, { r1: 'not_authenticated' }, { r1: false }), false, 'not_authenticated 不得单独作为授权依据')
  // 明确不计入: 已授权 / 静态 Token 已够用 / 未探测
  assert.equal(factory(httpRow, { r1: 'authenticated' }, {}), false, '已授权不得显示授权入口')
  assert.equal(factory(httpRow, { r1: 'already-works' }, { r1: false }), false, 'already-works 不得显示授权入口')
  assert.equal(factory(httpRow, {}, {}), false, '未探测(undefined)不得显示授权入口')
  // 非 http / 只读行永不显示
  assert.equal(factory(stdioRow, { r2: 'not_authenticated' }, { r2: 'unknown' }), false, 'stdio 行永不显示授权入口')
  assert.equal(factory(readOnly, { r3: 'not_authenticated' }, { r3: true }), false, '只读行永不显示授权入口')
})

test('源码: 主行只剩 删除 + 开关（授权按钮移出主行）', () => {
  // 主行渲染段（rows.map 内, auth-row 之前）不得含 startAuth
  const mapStart = src.indexOf('rows.map((row) =>')
  const authRowStart = src.indexOf('dsh-hub-auth-row', mapStart)
  assert.ok(mapStart > 0 && authRowStart > mapStart, '应能定位主行与 auth-row')
  const mainRowSeg = src.slice(mapStart, authRowStart)
  assert.ok(!/startAuth/.test(mainRowSeg), '主行不得含授权按钮(已移至 auth-row)')
  assert.ok(!/t\("edit"\)/.test(mainRowSeg), '主行不得含编辑按钮')
  // auth-row 段必须含 startAuth
  const authRowSeg = src.slice(authRowStart, authRowStart + 700)
  assert.ok(/startAuth/.test(authRowSeg), 'auth-row 必须含授权按钮')
})

test('源码: auth-row 有黄字样式 + 缩进', () => {
  assert.ok(/\.dsh-hub-auth-row\{/.test(src), '应有 auth-row 样式')
  assert.ok(/\.dsh-hub-auth-warn\{[^}]*#eab308/.test(src), 'auth-row 提示应为黄色 #eab308')
  assert.ok(/margin-left:16px/.test(src), 'auth-row 应缩进对齐主行')
})

// ── 渲染级回归: 真实 react 渲染整个 McpTab ──
// 抓到一个真 bug: auth-row 曾被写在 rows.map 回调外, row 不在作用域 →
// 整个面板渲染抛 "row is not defined" → Hub UI 全白。
// 既有测试只 grep 源码 + 单独执行 needsAuth, 抓不到作用域错误。
const FE_NM = '/data/data/com.termux/files/home/smartlearn-ai/frontend/node_modules'
let renderMcpTab = null
let needsAuthOf = null
try {
  const req = createRequire(join(FE_NM, 'index.js'))
  const React = req('react')
  const jsx = req('react/jsx-runtime')
  const rds = req('react-dom/server')
  const start = src.indexOf('//#region 通用控件')
  const end = src.indexOf('\t\tfunction SkillsTab(')
  assert.ok(start > 0 && end > start, '应能抽出通用控件 region')
  const factory = new Function('react', 'react_jsx_runtime',
    src.slice(start, end) + '\nreturn { McpTab, needsAuth }')
  const mod = factory(React, jsx)
  renderMcpTab = (state, t, actions) => rds.renderToStaticMarkup(
    React.createElement(mod.McpTab, { state, t, actions }))
  needsAuthOf = mod.needsAuth
} catch (error) {
  renderMcpTab = null
}

const ROWS = [
  { id: 'mcp-cf-docs', enabled: true, editable: true, live: true, config: { transport: 'streamable-http', serverName: 'cf-docs', url: 'https://docs.mcp.cloudflare.com/mcp', headers: {} } },
  { id: 'mcp-cloudflare', enabled: true, editable: true, live: true, config: { transport: 'streamable-http', serverName: 'cloudflare', url: 'https://mcp.cloudflare.com/mcp', headers: {} } },
  { id: 'mcp-context7', enabled: true, editable: true, live: true, config: { transport: 'streamable-http', serverName: 'context7', url: 'https://mcp.context7.com/mcp', headers: {} } },
  { id: 'mcp-ruflo', enabled: true, editable: true, live: true, config: { transport: 'stdio', serverName: 'ruflo', command: 'node', args: [] } },
]
const mkState = (authStatus = {}) => ({
  mcp: ROWS, skills: [], busy: false, mcpAvailable: true, ready: true, tab: 'mcp',
})
const ACTIONS = { reload() {}, setTab() {}, toggleMcp() {}, deleteMcp() {}, saveMcp() {}, toggleSkill() {}, deleteSkill() {} }

test('渲染: 整个 McpTab 可渲染(auth-row 在 rows.map 作用域内)', { skip: renderMcpTab === null && 'react 18 成套不可用' }, () => {
  // 旧 bug: auth-row 写在 map 外 → row 未定义 → 渲染抛错 → Hub UI 全白
  const html = renderMcpTab(mkState(), (k) => k, ACTIONS)
  assert.ok(html.length > 0, '应渲染出内容')
  assert.ok(html.includes('mcp-cf-docs'), '应含行 id')
  assert.ok(html.includes('mcp-ruflo'), '应含 stdio 行')
})

test('渲染: needsAuth 全 false 时无授权按钮/无未授权行(用户诉求)', { skip: renderMcpTab === null && 'react 18 成套不可用' }, () => {
  const authStatus = {}
  for (const r of ROWS) authStatus[r.id] = 'not_authenticated'
  const html = renderMcpTab(mkState(authStatus), (k) => k, ACTIONS)
  assert.ok(!html.includes('dsh-hub-auth-row'), '不得有未授权行(needsAuth 全 false)')
  assert.ok(!/>authorize</.test(html), '不得有授权按钮')
  assert.ok(!/>edit</.test(html), '不得有编辑按钮')
  // 主行只剩 删除 + 开关
  const rows = (html.match(/class="dsh-hub-row"/g) || []).length
  assert.equal(rows, ROWS.length, `应有 ${ROWS.length} 个主行`)
  assert.equal((html.match(/dsh-hub-switch/g) || []).length, ROWS.length, '每行一个开关')
  assert.equal((html.match(/>del</g) || []).length, ROWS.length, '每行一个删除')
})

test('渲染: stdio 行永不出现授权入口(离屏渲染 + needsAuth 双重验证)', { skip: renderMcpTab === null && 'react 18 成套不可用' }, () => {
  // 离屏渲染不跑 useEffect, authStatus 恒为初始 {}, 故 auth-row 不出现;
  // 这里验证的是「渲染不崩 + stdio 行结构正确 + 无授权痕迹」。
  const html = renderMcpTab(mkState(), (k) => k, ACTIONS)
  assert.ok(html.includes('mcp-ruflo'), 'stdio 行应渲染')
  assert.ok(!html.includes('mcp-ruflo:auth'), 'stdio 行不得有 auth-row key')
  assert.ok(!/authorize/.test(html), 'authStatus 空时不得有任何授权按钮')
  // stdio 行不得有 AuthBadge(非 http)
  const rufloSeg = html.slice(html.indexOf('mcp-ruflo'))
  assert.ok(!/authNotAuth|authOk|authPending|authExpired/.test(rufloSeg.slice(0, 400)),
    'stdio 行不得渲染授权徽章')
})

test('渲染: needsAuth 判定链路(单元级, 不依赖 effect)', () => {
  // auth-row 的存在性由 needsAuth 判定决定; 这里验证判定对每类行正确,
  // 覆盖「离屏渲染拿不到 authStatus/needsAuthMap」的盲区。
  const httpRow = ROWS[1]  // mcp-cloudflare
  const stdioRow = ROWS[3] // mcp-ruflo
  // 授权流程中/失败/超时 → 保留入口
  for (const s of ['expired', 'failed', 'pending']) {
    assert.equal(needsAuthOf(httpRow, { 'mcp-cloudflare': s }, {}), true, `http 行 ${s} → 需授权`)
  }
  // needsAuth 字段为第一依据(服务端探测结论)
  assert.equal(needsAuthOf(httpRow, { 'mcp-cloudflare': 'not_authenticated' }, { 'mcp-cloudflare': true }), true, '探测 401 → 需授权')
  assert.equal(needsAuthOf(httpRow, { 'mcp-cloudflare': 'not_authenticated' }, { 'mcp-cloudflare': 'unknown' }), true, '探测不可达 → 显示入口(不猜不隐藏)')
  assert.equal(needsAuthOf(httpRow, { 'mcp-cloudflare': 'not_authenticated' }, { 'mcp-cloudflare': false }), false, 'needsAuth=false → 不需授权')
  assert.equal(needsAuthOf(httpRow, { 'mcp-cloudflare': 'not_authenticated' }, {}), false, 'needsAuth 未探测到 → 不显示')
  // 已授权/静态 Token 够用 → 不显示
  for (const s of ['authenticated', 'already-works']) {
    assert.equal(needsAuthOf(httpRow, { 'mcp-cloudflare': s }, { 'mcp-cloudflare': false }), false, `http 行 ${s} → 不需授权`)
  }
  assert.equal(needsAuthOf(stdioRow, { 'mcp-ruflo': 'not_authenticated' }, { 'mcp-ruflo': 'unknown' }), false, 'stdio 行永不需授权')
})

// ── 回归: controller 的 toast 必须跟随 locale(不得硬编码 zh) ──
// 2026-10-22 发现: HubController.post() 用 tFallback(恒返 zh), 而 React 组件用
// props.t(跟随 ctx.locale)。→ 英文用户看到英文 UI + 中文 toast, 语言不一致。
test('源码: controller 不得直接用 tFallback(须经 locale 感知的 t)', () => {
  // controller 内部(非 React 组件内)不应出现裸 tFallback 调用
  const m = src.match(/class HubController \{/)
  assert.ok(m, '应能定位 class HubController')
  const ctrlEnd = src.indexOf('\n\t\tfunction tFallback')
  assert.ok(ctrlEnd > m.index, '应能定位 class 结束')
  const ctrl = src.slice(m.index, ctrlEnd)
  // 去掉注释再匹配: 注释里提到 tFallback 不算调用
  const code = ctrl.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  const bareFallback = [...code.matchAll(/tFallback\(/g)]
  assert.equal(bareFallback.length, 0,
    `HubController 内发现 ${bareFallback.length} 处裸 tFallback(恒 zh) —— 英文用户会看到中文 toast。` +
    '应改用注入的 locale 感知 t(如 this.t)')
})

test('源码: controller 应有 locale 感知的翻译入口', () => {
  // 修复形态: controller 持有 t 注入点, apply 时用 ctx.locale.bind 注入
  assert.ok(/this\.t\b|setT\(/.test(src),
    'controller 应有 locale 注入能力(如 this.t / setT 方法)')
})

// ── 可访问性回归(2026-10-22 打磨) ──
test('源码: tab 有 role=tab + aria-selected(键盘/读屏可用)', () => {
  assert.ok(/role: "tab"/.test(src), 'tab 按钮应有 role="tab"')
  assert.ok(/"aria-selected":/.test(src), 'tab 应有 aria-selected')
  assert.ok(/role: "tablist"/.test(src), 'tab 容器应有 role="tablist"')
})

test('源码: CSS 有 focus-visible 样式(键盘焦点可见)', () => {
  const cssStart = src.indexOf('const CSS = `')
  assert.ok(cssStart > 0, '应能定位 CSS 块')
  const cssRaw = src.slice(cssStart, cssStart + 6000)
  // 去掉 CSS 注释再断言(注释里提到 outline:none 不算禁用)
  const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '')
  assert.ok(/focus-visible/.test(css), 'CSS 应含 :focus-visible 焦点环')
  assert.ok(/outline:/.test(css), 'focus-visible 应有 outline')
  // 不得禁用焦点
  assert.ok(!/outline:\s*none/.test(css), '不得用 outline:none 禁用焦点')
})

test('源码: controller.post 用计数器管理 busy(防并发覆盖)', () => {
  const m = src.match(/async post\(path, body\) \{([\s\S]*?)\n\t\t\t\}/)
  assert.ok(m, '应能定位 post()')
  const body = m[1]
  assert.ok(/_inflight/.test(body), 'post() 应用 _inflight 计数器管理 busy')
  assert.ok(!/this\.set\(\{ busy: true \}\)/.test(body), '不得用裸布尔 busy: true(并发会互相覆盖)')
  assert.ok(!/this\.set\(\{ busy: false \}\)/.test(body), '不得用裸布尔 busy: false')
})

// ── 视觉规格回归(2026-10-22 打磨, 依据 CDP 实测) ──
const cssBlock = () => {
  const i = src.indexOf('const CSS = `')
  return src.slice(i, src.indexOf('`', i + 14))
}

test('视觉: 开关触达区 ≥24x24(WCAG 2.2 / 实测曾 34x19)', () => {
  const css = cssBlock()
  const m = css.match(/\.dsh-hub-switch\{width:(\d+)px;height:(\d+)px/)
  assert.ok(m, '应能解析 .dsh-hub-switch 尺寸')
  const [, w, h] = m.map(Number)
  assert.ok(w >= 24 && h >= 24, `开关 ${w}x${h} 小于 24x24 触达区下限`)
})

test('视觉: 无 11px 以下字号(实测曾 3 处 11px)', () => {
  const css = cssBlock()
  const sizes = [...css.matchAll(/font-size:(\d+)px/g)].map((m) => Number(m[1]))
  assert.ok(sizes.length > 0, '应有 font-size 声明')
  const tooSmall = sizes.filter((s) => s < 12)
  assert.deepEqual(tooSmall, [], `发现 ${tooSmall.length} 处 <12px 字号`)
})

test('视觉: 重要提示(auth-warn)字号 ≥13px(与正文同级)', () => {
  const css = cssBlock()
  const m = css.match(/\.dsh-hub-auth-warn\{[^}]*font-size:(\d+)px/)
  assert.ok(m, '应能解析 auth-warn 字号')
  assert.ok(Number(m[1]) >= 13, `auth-warn ${m[1]}px 应 ≥13px`)
})

test('视觉: 按钮有足够内边距(触达高度)', () => {
  const css = cssBlock()
  const m = css.match(/\.dsh-hub-btn\{padding:(\d+)px/)
  assert.ok(m, '应能解析 btn padding')
  assert.ok(Number(m[1]) >= 4, `btn padding-top ${m[1]}px 过小`)
})

// ─────────────────────────────────────────────────────────────
// P1-8: seam 补丁健康横幅(0.3.0 新增)
// ─────────────────────────────────────────────────────────────

test('seam: i18n 键中英齐全(8 个 seam* 键)', () => {
  const src = readFileSync(CLIENT, 'utf8')
  const keys = ['seamAnchorMissing', 'seamNotApplicable', 'seamCorrupt',
    'seamVerifyFailed', 'seamNeedsPatch', 'seamReadFailed', 'seamError']
  for (const k of keys) {
    // 每个键必须出现 2 次(zh + en)
    const n = src.split(k + ':').length - 1
    assert.equal(n, 2, `${k} 应出现 2 次(中/英), 实际 ${n}`)
  }
})

test('seam: SeamBanner 对静默状态返回 null', () => {
  const src = readFileSync(CLIENT, 'utf8')
  assert.match(src, /const SeamBanner = /, '应有 SeamBanner 组件')
  // 静默清单必须含这 5 个(正常或无需用户动作的状态)。
  // 刻意**不含** locked: self-heal 把「另一进程正在 patch」上报为 already,
  // locked 是死枚举值(0.3.4 修正)。
  const m = src.match(/const silent = \[([^\]]+)\]/)
  assert.ok(m, '应定义静默状态清单')
  for (const s of ['not-checked', 'disabled', 'bundle-not-found', 'already', 'patched']) {
    assert.ok(m[1].includes(`"${s}"`), `静默清单应含 ${s}`)
  }
  assert.ok(!m[1].includes('"locked"'), '静默清单不应含死枚举 locked')
})

test('seam: 危险横幅用 danger 样式且有对应 CSS', () => {
  const src = readFileSync(CLIENT, 'utf8')
  assert.match(src, /dsh-hub-banner danger/, 'SeamBanner 应渲染 danger 横幅')
  assert.match(src, /\.dsh-hub-banner\.danger\{/, '应有 .danger 的 CSS 定义')
})

test('seam: /oauth/status 轮询处消费 seam 字段', () => {
  const src = readFileSync(CLIENT, 'utf8')
  assert.match(src, /setSeamState/, '应把 seam 存进 state')
  assert.match(src, /res\.seam && res\.seam\.status/, '应校验 seam.status 存在')
})

test('seam: 服务端 /oauth/status 响应含 seam 字段', () => {
  const src = readFileSync(join(HUB, 'lib', 'oauth-server.js'), 'utf8')
  assert.match(src, /seamState/, 'registerOAuthRoutes 应接受 seamState 依赖')
  assert.match(src, /seam: seamState\(\)/, 'status 响应应带出 seam 状态')
})

// ─────────────────────────────────────────────────────────────
// 0.3.2 前端打磨: token 化 + 去 emoji(design-doctrine 门镜)
// ─────────────────────────────────────────────────────────────

const KIT = '/data/data/com.termux/files/home/.config/opencode/skills/.uxui-kit'

test('taste: 无 emoji/pictograph(含 UI 文案与注释)', async () => {
  const { execFileSync } = await import('node:child_process')
  let out = ''
  try {
    out = execFileSync('python3', [join(KIT, 'scripts', 'check_no_emoji.py'), CLIENT], { encoding: 'utf8' })
  } catch (e) { out = String(e.stdout || '') }
  assert.ok(!out.includes('FAIL'), `check_no_emoji 报错:\n${out}`)
})

test('taste: CSS 无裸 hex 颜色(一律走 dsw token, 兜底值只允许在 var() 内)', () => {
  const css = cssBlock()
  // 兜底形如 var(--dsw-alias-x,#22c55e) 是允许的(token 缺失时降级);
  // 裸 hex(不在任何 var() 括号内)才是缺陷。
  const stripped = css.replace(/var\([^()]*\)/g, 'VAR')
  const bare = [...stripped.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0])
  assert.deepEqual([...new Set(bare)], [], `发现裸 hex(未走 token): ${[...new Set(bare)].join(', ')}`)
})

test('taste: 焦点环走 dsh token(主值不是裸 hex)', () => {
  const css = cssBlock()
  const focus = css.match(/focus-visible\{[^}]*outline:([^;}]+)/)
  assert.ok(focus, '应有 focus-visible 规则')
  // 主值必须是 dsh token; var() 内的兜底 hex 允许
  assert.match(focus[1], /^2px solid var\(--dsw-alias-brand-primary/,
    `焦点环主值应走 --dsw-alias-brand-primary, 实际: ${focus[1]}`)
})

test('taste: 状态色走 dsh 语义 token(裸 hex 不允许, var() 兜底允许)', () => {
  const css = cssBlock()
  // 裸 hex(不在 var() 内)= 缺陷; var(--dsw-x,#22c55e) 形式的兜底是允许的
  const stripped = css.replace(/var\([^()]*\)/g, 'VAR')
  for (const [name, hex] of [['success', '#22c55e'], ['warn', '#eab308'], ['error', '#ef4444']]) {
    assert.ok(!stripped.includes(hex), `${name} 色仍有裸 hex ${hex}(未走 token)`)
  }
  // 三组都必须实际引用 dsh 语义 token
  assert.ok(css.includes('var(--dsw-alias-state-success-primary'), '应引用 dsh success token')
  assert.ok(css.includes('var(--dsw-alias-state-warn-label'), '应引用 dsh warn token')
  assert.ok(/var\(--dsw-alias-(label-error|state-error-primary)/.test(css), '应引用 dsh error token')
})

test('taste: 不用原生 <select>(教义铁律)', () => {
  const src = readFileSync(CLIENT, 'utf8')
  assert.ok(!/<select/.test(src), '不应出现原生 <select>')
})

test('taste: Icon 组件在 SSR 下产出 <path>(不是空 svg)', async () => {
  const { createRequire } = await import('node:module')
  const FE_NM = '/data/data/com.termux/files/home/smartlearn-ai/frontend/node_modules'
  let renderIcon = null
  try {
    const req = createRequire(join(FE_NM, 'index.js'))
    const React = req('react')
    const jsx = req('react/jsx-runtime')
    const rds = req('react-dom/server')
    const start = src.indexOf('const Icon = ')
    const end = src.indexOf('const Badge = ')
    if (start > 0 && end > start) {
      const factory = new Function('react', 'react_jsx_runtime', src.slice(start, end) + '\nreturn { Icon }')
      const { Icon } = factory(React, jsx)
      renderIcon = (name) => rds.renderToStaticMarkup(React.createElement(Icon, { name, size: 14 }))
    }
  } catch { renderIcon = null }
  if (!renderIcon) return   // 无前端依赖环境时跳过
  for (const name of ['zap', 'warn', 'x']) {
    const html = renderIcon(name)
    assert.ok((html.match(/<path/g) || []).length >= 1, `${name} 图标应含至少一个 <path>`)
    assert.ok(html.includes('aria-hidden="true"'), '图标应 aria-hidden(装饰性)')
    assert.ok(html.includes('stroke="currentColor"'), '图标应跟随文字色')
  }
})

test('taste: Icon 有常驻渲染落点(hmr 徽章), 不会永远不出现', () => {
  assert.match(src, /state\.hmr\s*\n?\s*\?\s*react_jsx_runtime\.jsxs\("span", \{ className: "dsh-hub-badge ok"/,
    'hmr 徽章应是 Icon 的常驻落点')
  assert.match(src, /Icon, \{ name: "zap"/, '应使用 zap 图标')
})

test('授权行: expired 时黄字与授权按钮同行(渲染级验证)', async () => {
  // 渲染级: 注入 authStatus={mcp-cloudflare:'expired'} 后,
  // auth-warn 的文本必须是 authExpired, 且与授权按钮在同一个 .dsh-hub-auth-row 内。
  const { createRequire } = await import('node:module')
  const FE_NM = '/data/data/com.termux/files/home/smartlearn-ai/frontend/node_modules'
  let html = null
  try {
    const req = createRequire(join(FE_NM, 'index.js'))
    const React = req('react')
    const jsx = req('react/jsx-runtime')
    const rds = req('react-dom/server')
    // useState 按调用顺序注入: editing / confirmRow / authStatus / needsAuthMap / seamState / authBusy
    const injected = [null, null, { 'mcp-cloudflare': 'expired' }, {}, null, null]
    let n = 0
    const patched = Object.assign({}, React, {
      useState: (init) => { const v = injected[n] !== undefined ? injected[n] : (typeof init === 'function' ? init() : init); n++; return [v, () => {}] },
    })
    const start = src.indexOf('//#region 通用控件')
    const end = src.indexOf('\t\tfunction SkillsTab(')
    const factory = new Function('react', 'react_jsx_runtime', src.slice(start, end) + '\nreturn { McpTab }')
    const { McpTab } = factory(patched, jsx)
    const t = (k) => k
    const state = {
      mcp: [{ id: 'mcp-cloudflare', editable: true, live: true, enabled: true, config: { transport: 'streamable-http', url: 'https://x/mcp' } }],
      mcpAvailable: true, mcpError: '', busy: false, hmr: true, tab: 'mcp',
      skills: [], skillsAvailable: true, skillsError: '',
    }
    const actions = { reload(){}, toggleMcp(){}, upsertMcp(){}, deleteMcp(){}, setTab(){}, createSkill(){}, updateSkill(){}, toggleSkill(){}, deleteSkill(){} }
    html = rds.renderToStaticMarkup(React.createElement(McpTab, { state, t, actions }))
  } catch (e) { html = null }
  if (!html) return   // 无前端依赖环境时跳过
  // 授权行存在, 且黄字是 authExpired
  assert.match(html, /dsh-hub-auth-row/, '应有授权行')
  const rowStart = html.indexOf('dsh-hub-auth-row')
  const rowEnd = html.indexOf('</div>', rowStart)
  const row = html.slice(rowStart, rowEnd)
  assert.match(row, /dsh-hub-auth-warn[^>]*>authExpired</,
    '授权行黄字应为 authExpired')
  assert.match(row, /<button[^>]*>authorize</, '授权按钮应在同一行内')
  // 主行不得再出现 authExpired 徽章
  const mainRow = html.slice(0, rowStart)
  assert.ok(!/dsh-hub-badge[^>]*>authExpired</.test(mainRow),
    '主行徽章不应显示 authExpired(已移到授权行)')
})


test('授权行: authRowHint 是显式传参的纯函数(不读 McpTab 闭包 state)', () => {
  // 2026-10-24 踩坑: authRowHint 曾定义在 McpTab 外却引用其内部 authStatus /
  // needsAuthMap, 渲染时直接 ReferenceError。用「签名含 4 个参数」锁定形态。
  const m = src.match(/const authRowHint = \(([^)]*)\)/)
  assert.ok(m, '应有 authRowHint 定义')
  const params = m[1].split(',').map((s) => s.trim()).filter(Boolean)
  assert.deepEqual(params, ['row', 't', 'authStatus', 'needsAuthMap'],
    `authRowHint 应显式接收 authStatus/needsAuthMap, 实际参数: ${params.join(', ')}`)
  // 调用点必须把两个 map 传进去
  assert.match(src, /authRowHint\(row, t, authStatus, needsAuthMap\)/,
    '调用点应传入 authStatus 与 needsAuthMap')
})
