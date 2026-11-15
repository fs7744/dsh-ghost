/**
 * 面板通用逻辑 + 工作区 / 附件纯函数单测（test:panels 的一部分）。
 * 覆盖：归一化空/畸形响应、目录树构建、排序、权限开关、上传请求构造。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  asList, bool, describeError, num, record, sortPanelDefs, str, unavailableHtml,
} from '../src/panels.ts'
import {
  buildFileTree, buildMenuItems, classifyFile, flattenTree, isPreviewable,
  normalizeFileContent, normalizeFileEntries, sortTree,
} from '../src/workspace.ts'
import {
  buildUploadRequest, normalizeDirectoryList, normalizeDroppedFiles, pickedPath, sortDirectoryList,
} from '../src/attachments.ts'

test('asList 从裸数组与常见容器字段挖数组，畸形返回空', () => {
  assert.deepEqual(asList([1, 2]), [1, 2])
  assert.deepEqual(asList({ items: ['a'] }), ['a'])
  assert.deepEqual(asList({ entries: [{ id: 1 }] }), [{ id: 1 }])
  assert.deepEqual(asList({ list: [3] }), [3])
  assert.deepEqual(asList(null), [])
  assert.deepEqual(asList(42), [])
  assert.deepEqual(asList({ unknown: [9] }), [])
})

test('str / num / bool / record 对缺失与畸形值一律安全', () => {
  assert.equal(str('x'), 'x')
  assert.equal(str(undefined), '')
  assert.equal(str(3), '')
  assert.equal(num(12.5), 12.5)
  assert.equal(num('7'), 0)
  assert.equal(num(Number.NaN), 0)
  assert.equal(bool(true), true)
  assert.equal(bool(1), false)
  assert.deepEqual(record(null), {})
  assert.deepEqual(record([1]), {})
  assert.deepEqual(record({ a: 1 }), { a: 1 })
})

test('sortPanelDefs 先按 order，再按 id 稳定排序', () => {
  const defs = [
    { id: 'b', order: 2 },
    { id: 'a', order: 2 },
    { id: 'c', order: 1 },
  ]
  assert.deepEqual(sortPanelDefs(defs).map(item => item.id), ['c', 'a', 'b'])
  assert.deepEqual(defs.map(item => item.id), ['b', 'a', 'c'], '不改动入参')
})

test('describeError 与 unavailableHtml 把异常和文案安全转义', () => {
  assert.equal(describeError(new Error('boom')), 'boom')
  assert.match(describeError({}), /\[object/)
  const html = unavailableHtml('该能力未启用', '<b>detail</b>')
  assert.match(html, /该能力未启用/)
  assert.match(html, /&lt;b&gt;detail&lt;\/b&gt;/)
  assert.doesNotMatch(html, /<b>/)
})

test('normalizeFileEntries 丢掉无路径项、清洗反斜杠并推断目录', () => {
  const entries = normalizeFileEntries([
    { path: 'src\\main.ts', name: 'main.ts' },
    { path: 'docs/', type: 'dir' },
    { path: 'raw.bin', size: 128 },
    { title: '没有路径', size: 1 },
    null,
    'garbage',
  ])
  assert.equal(entries.length, 3)
  assert.equal(entries[0]?.path, 'src/main.ts')
  assert.equal(entries[1]?.isDir, true)
  assert.equal(entries[2]?.size, 128)
  assert.deepEqual(normalizeFileEntries(undefined), [])
  assert.deepEqual(normalizeFileEntries({ nope: 1 }), [])
})

test('buildFileTree 补齐隐式目录、目录优先且层级正确', () => {
  const tree = buildFileTree(normalizeFileEntries([
    { path: 'src/main.ts' },
    { path: 'README.md' },
    { path: 'src/util/x.ts' },
    { path: 'docs', isDir: true },
  ]))
  assert.deepEqual(tree.map(node => node.name), ['docs', 'src', 'README.md'])
  assert.equal(tree[0]?.isDir, true, '目录排在文件前')
  const flat = flattenTree(tree)
  assert.ok(flat.some(node => node.name === 'util' && node.depth === 1), '隐式目录 util 在 depth 1')
  assert.ok(flat.some(node => node.name === 'x.ts' && node.depth === 2), '深层文件在 depth 2')
  assert.ok(flat.some(node => node.name === 'main.ts' && node.depth === 1))
  assert.deepEqual(buildFileTree([]), [])
})

test('classifyFile / isPreviewable 按扩展名分类，大小写无关', () => {
  assert.equal(classifyFile('a.md'), 'document')
  assert.equal(classifyFile('a.PNG'), 'image')
  assert.equal(classifyFile('a.xlsx'), 'deliverable')
  assert.equal(classifyFile('a.ts'), 'code')
  assert.equal(classifyFile('a.bin'), 'other')
  assert.equal(classifyFile('noext'), 'other')
  assert.equal(isPreviewable('image'), false)
  assert.equal(isPreviewable('document'), true)
})

test('normalizeFileContent 兼容字符串与多种容器字段', () => {
  assert.equal(normalizeFileContent('raw text'), 'raw text')
  assert.equal(normalizeFileContent({ content: 'hello' }), 'hello')
  assert.equal(normalizeFileContent({ text: 'world' }), 'world')
  assert.equal(normalizeFileContent({ rendered: '<p>x</p>' }), '<p>x</p>')
  assert.equal(normalizeFileContent(null), '')
  assert.equal(normalizeFileContent({ nope: 1 }), '')
})

test('buildMenuItems 的预览项随文件类型开关', () => {
  assert.equal(buildMenuItems('document').find(item => item.id === 'preview')?.enabled, true)
  assert.equal(buildMenuItems('image').find(item => item.id === 'preview')?.enabled, false)
  assert.equal(buildMenuItems('other').find(item => item.id === 'preview')?.enabled, false)
  assert.equal(buildMenuItems('code').find(item => item.id === 'refresh')?.enabled, true)
})

test('normalizeDirectoryList / sortDirectoryList 目录优先、丢弃畸形', () => {
  const rows = normalizeDirectoryList({ entries: [
    { path: '/z.txt', name: 'z.txt' },
    { path: '/a', name: 'a', isDir: true },
    { path: '/b', name: 'b', isDir: true },
    { path: '' },
  ] })
  assert.deepEqual(rows.map(row => row.name), ['a', 'b', 'z.txt'])
  assert.deepEqual(normalizeDirectoryList(null), [])
  const unsorted = [
    { name: 'm', path: 'm', isDir: false },
    { name: 'a', path: 'a', isDir: true },
  ]
  assert.deepEqual(sortDirectoryList(unsorted).map(row => row.name), ['a', 'm'])
  assert.deepEqual(normalizeDirectoryList({ list: [{ path: '/q', name: 'q' }] }).map(row => row.name), ['q'])
})

test('sortTree 返回新树且不改动入参', () => {
  const nodes = [
    { name: 'z.ts', path: 'z.ts', isDir: false, children: [], entry: undefined },
    { name: 'a', path: 'a', isDir: true, children: [], entry: undefined },
  ]
  assert.deepEqual(sortTree(nodes).map(node => node.name), ['a', 'z.ts'])
  assert.deepEqual(nodes.map(node => node.name), ['z.ts', 'a'], '入参顺序不变')
})

test('normalizeDroppedFiles 丢弃无名称项，buildUploadRequest 构造 wire 形状', () => {
  const items = normalizeDroppedFiles([
    { name: 'a.txt', size: 10, type: 'text/plain' },
    { name: '', size: 5 },
    { size: 3 },
  ])
  assert.equal(items.length, 1)
  assert.deepEqual(items[0], { name: 'a.txt', size: 10, type: 'text/plain' })
  assert.deepEqual(normalizeDroppedFiles([{ name: 'b.md' }]), [{ name: 'b.md', size: 0, type: '' }])
  assert.deepEqual(buildUploadRequest('sess-1', items), {
    request: { files: [{ name: 'a.txt', size: 10, type: 'text/plain' }] },
  })
})

test('pickedPath 兼容字符串、直接对象与 result 嵌套', () => {
  assert.equal(pickedPath('/a/b'), '/a/b')
  assert.equal(pickedPath({ path: '/c' }), '/c')
  assert.equal(pickedPath({ directory: '/d' }), '/d')
  assert.equal(pickedPath({ result: { path: '/e' } }), '/e')
  assert.equal(pickedPath(null), '')
  assert.equal(pickedPath({}), '')
})
