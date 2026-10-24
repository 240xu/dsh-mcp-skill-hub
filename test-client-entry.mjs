/**
 * 客户端入口契约回归。
 *
 * 踩过的坑：package.json 是 "type":"module"，但 lib/client.js 里写
 * `exports.apply = apply` —— ESM 作用域没有 `exports`，直接
 * `ReferenceError: exports is not defined`，表现为
 *   web boot: 1 entry did not activate
 *   dsh-mcp-skill-hub: import failed: exports is not defined
 *
 * 根因是 CJS→ESM 打包时丢了前言。对照 @240xu/dsh-websearch/lib/client.js：
 * 每个正常加载的客户端插件都在 factory 首部声明 module/exports。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

test('client.js 引用 exports 时必须有本地 module/exports 声明', () => {
  const src = readFileSync(join(here, 'lib', 'client.js'), 'utf8')
  const usesExports = /\bexports\s*\./.test(src)
  const declaresLocal = /var\s+module\s*=\s*\{\s*exports\s*:\s*\{\s*\}\s*\}/.test(src)
    && /var\s+exports\s*=\s*module\.exports/.test(src)
  if (usesExports) {
    assert.ok(declaresLocal,
      'lib/client.js 里引用了 `exports` 但没有 `var module = {exports:{}}; var exports = module.exports;` 前言 —— ESM 下会抛 "exports is not defined"')
  }
})

test('写了 exports 就必须 return module.exports（否则 loader 收到 undefined）', () => {
  const src = readFileSync(join(here, 'lib', 'client.js'), 'utf8')
  if (/\bexports\s*\./.test(src)) {
    assert.ok(/return\s+module\.exports/.test(src),
      'factory 里给 exports 赋值却不 `return module.exports`，loader 会拿到 undefined 并报 '
      + '"invalid plugin, expect function or object with an \"apply\" method, received undefined"')
  }
})

test('package.json 是 ESM 而 client 入口不能混用 CJS 的 module/exports 之外的语法', () => {
  const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'))
  assert.equal(pkg.type, 'module')
  const src = readFileSync(join(here, 'lib', 'client.js'), 'utf8')
  assert.ok(!/\brequire\s*\(\s*["']/.test(src) || /factory:\s*\(require\)/.test(src),
    'client 入口必须用 ModuleLoader 的 factory(require) 注入式依赖')
})

test('host 入口 index.js 使用 ESM 导出', () => {
  const src = readFileSync(join(here, 'lib', 'index.js'), 'utf8')
  assert.ok(/export\s*\{/.test(src), 'host 半边应是 ESM export')
  assert.ok(!/\bexports\s*\./.test(src), 'host 半边不应使用 CJS exports')
})
