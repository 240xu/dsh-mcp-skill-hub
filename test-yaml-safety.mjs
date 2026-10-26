// P0 回归测试: Hub 写出的 YAML 必须能被 dsh 的真实 YAML 解析器(yaml@2.x,即
// skill-filesystem / app-boot 用的同一个包)解析。
// 背景: yamlScalar 的裸标量分支把含 ": " 的值不加引号写出,导致
//   1) MCP patch 块解析失败 → dsh boot fail
//   2) 技能 frontmatter 解析失败 → provider 忽略 → 技能静默消失
// 测试用 yaml@2.9.0(dsh lock 锁定版本)作为 oracle,不自制解析器。
import { parse as parseYaml } from '/data/data/com.termux/files/home/.config/opencode/node_modules/yaml/dist/index.js'
import { __internals as X } from './lib/index.js'

let failures = 0
const check = (name, fn) => {
  try {
    fn()
    console.log(`  ✓ ${name}`)
  } catch (error) {
    failures += 1
    console.log(`  ✗ ${name}: ${error.message}`)
  }
}

const assert = (cond, message) => { if (!cond) throw new Error(message) }

console.log('yamlScalar / buildRowLines / buildSkillFile 产出必须是合法 YAML:')

const { yamlScalar, buildRowLines, buildSkillFile } = X

// 把 Hub 产出包成一个最小 patch 文档并交给真实 YAML 解析器。
// dsh boot 走 yaml.load(content, { schema: userPatchesSchema }) —— 非默认 schema,
// 但标量规则与默认 schema 一致(只额外允许 !!js 标签),所以默认 parse 可作为 oracle。
const parsePatch = (blockLines) => {
  const doc = ['- insert:', ...blockLines.map((l) => (l.startsWith('    ') ? l : `    ${l}`)), ''].join('\n')
  return parseYaml(doc)
}

const httpBlock = (headers) => [
  "    - id: mcp-t",
  "      name: '@deepseek-ai/dsh-mcp-client'",
  '      config:',
  '        serverName: t',
  '        transport: streamable-http',
  '        url: https://example.com/mcp',
  '        headers:',
  ...Object.entries(headers).map(([k, v]) => `          ${k}: ${yamlScalar(v)}`),
]

check('含 ": " 的 header 值必须加引号(Bearer abc: def)', () => {
  const doc = parsePatch(httpBlock({ Authorization: 'Bearer abc: def' }))
  assert(
    doc[0].insert[0].config.headers.Authorization === 'Bearer abc: def',
    `解析结果错误: ${JSON.stringify(doc[0].insert[0].config.headers)}`,
  )
})

check('含 ": " 的 header 值: charset: utf-8', () => {
  const doc = parsePatch(httpBlock({ 'Content-Type': 'text/html; charset: utf-8' }))
  assert(doc[0].insert[0].config.headers['Content-Type'] === 'text/html; charset: utf-8', '值被破坏')
})

check('含 ": " 的 header 值: 12: 30', () => {
  const doc = parsePatch(httpBlock({ 'X-Time': '12: 30' }))
  assert(doc[0].insert[0].config.headers['X-Time'] === '12: 30', '值被破坏')
})

check('buildRowLines 整块(header 值含 ": ")必须是合法 YAML', () => {
  const lines = buildRowLines('mcp-t', {
    serverName: 't', transport: 'streamable-http', url: 'https://example.com/mcp',
    headers: { Authorization: 'Bearer abc: def' }, args: [], env: {}, command: '', cwd: '',
  }, true, 4)
  const doc = parsePatch(lines)
  assert(doc[0].insert[0].config.headers.Authorization === 'Bearer abc: def', 'header 值被破坏')
})

check('buildRowLines 整块(env 值含 ": ")必须是合法 YAML', () => {
  const lines = buildRowLines('mcp-t', {
    serverName: 't', transport: 'stdio', command: '/bin/x',
    env: { ALG: 'HS256', TZ: '12: 30' }, args: [], headers: {}, cwd: '',
  }, true, 4)
  const doc = parsePatch(lines)
  assert(doc[0].insert[0].config.env.ALG === 'HS256', 'ALG 丢失')
  assert(doc[0].insert[0].config.env.TZ === '12: 30', 'TZ 被破坏')
})

check('buildRowLines 整块(url 含 ": ")必须是合法 YAML', () => {
  const lines = buildRowLines('mcp-t', {
    serverName: 't', transport: 'streamable-http', url: 'https://example.com/mcp?x=a: b',
    headers: {}, args: [], env: {}, command: '', cwd: '',
  }, true, 4)
  const doc = parsePatch(lines)
  assert(doc[0].insert[0].config.url === 'https://example.com/mcp?x=a: b', 'url 被破坏')
})

// 技能 frontmatter 由 provider 的 parseFrontmatter 切段后交给真 YAML 解析,
// 所以测试也只解析 frontmatter 段(与 provider 行为对齐)。
const parseFrontmatterDoc = (skillFile) => {
  const m = skillFile.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/)
  assert(m !== null, 'buildSkillFile 产出的 frontmatter 边界缺失')
  return parseYaml(m[1])
}

check('技能 frontmatter: description 含 ": " 必须能被 provider 解析', () => {
  const doc = parseFrontmatterDoc(buildSkillFile({
    name: 'my-skill', description: 'Use for X: Y and Z', whenToUse: '',
    content: 'body', modelInvocable: true, userInvocable: true,
  }))
  assert(doc.description === 'Use for X: Y and Z', `description 被破坏: ${JSON.stringify(doc.description)}`)
  assert(doc.name === 'my-skill', 'name 丢失')
})

check('技能 frontmatter: 中文含 ": " 的 description(既有测试用例)', () => {
  const doc = parseFrontmatterDoc(buildSkillFile({
    name: 'my-skill', description: '描述: 带冒号', whenToUse: '',
    content: 'body', modelInvocable: true, userInvocable: true,
  }))
  assert(doc.description === '描述: 带冒号', 'description 被破坏')
})

check('含真实换行的值必须写出可解析的 YAML(双引号转义)', () => {
  const out = yamlScalar('a\nb')
  const doc = parseYaml(`k: ${out}\n`)
  assert(doc.k === 'a\nb', `换行值被破坏: ${JSON.stringify(doc.k)}`)
})

check('buildRowLines: command 含换行必须是合法 YAML', () => {
  const lines = buildRowLines('mcp-t', {
    serverName: 't', transport: 'stdio', command: 'a\nb',
    env: {}, args: [], headers: {}, cwd: '',
  }, true, 4)
  const doc = parsePatch(lines)
  assert(doc[0].insert[0].config.command === 'a\nb', 'command 被破坏')
})

check('buildSkillFile: content 含换行/冒号组合仍是合法 frontmatter', () => {
  const doc = parseFrontmatterDoc(buildSkillFile({
    name: 's', description: 'd', whenToUse: 'w: x',
    content: 'line1\nline2', modelInvocable: false, userInvocable: false,
  }))
  assert(doc.description === 'd', 'description 丢失')
  assert(doc.whenToUse === 'w: x', `whenToUse 被破坏: ${JSON.stringify(doc.whenToUse)}`)
})

// roundtrip: Hub 读回自己写出的值必须无损(Hub 用自制 parseFrontmatter/parseBlockFields)
check('roundtrip: 含 ": " 的值经 yamlScalar → unquote → stripComment 无损', () => {
  const { unquote, stripComment } = X
  for (const v of ['Bearer abc: def', '12: 30', 'a#b', "it's", 'plain']) {
    const back = unquote(stripComment(yamlScalar(v)))
    assert(back === v, `roundtrip 丢失: ${JSON.stringify(v)} -> ${JSON.stringify(back)}`)
  }
})

console.log(failures ? `\n${failures} 项失败 ❌` : '\n全部通过 ✅')
process.exit(failures ? 1 : 0)
