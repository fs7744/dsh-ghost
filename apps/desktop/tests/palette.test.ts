/** 命令面板纯逻辑单测（C11-01）：不依赖 DOM / 网络。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  commandLine, filterCommands, hasFileReference, isCommandLine, isShellDirect,
  moveSelection, parseSlash, toCommandItems, type CommandItem,
} from '../src/palette.ts'

const items: CommandItem[] = [
  { name: 'compact', description: '压缩上下文', hint: '焦点（可选）' },
  { name: 'export', description: '导出会话' },
  { name: 'feedback', description: '发送反馈' },
  { name: 'goal', description: '设定目标' },
  { name: 'permission', description: '权限模式', acceptsAttachments: true },
  { name: 'plan', description: '计划模式' },
]

test('toCommandItems 归一化外部描述符并丢掉非法项', () => {
  const raw = [
    { name: 'compact', description: '压缩', input: { hint: '焦点', attachments: true } },
    { name: 'export', description: '导出' },
    { name: '', description: '没名字' },
    null,
    'garbage',
    { name: 'x' },
  ]
  const normalized = toCommandItems(raw)
  assert.equal(normalized.length, 3)
  assert.deepEqual(normalized[0], { name: 'compact', description: '压缩', hint: '焦点', acceptsAttachments: true })
  assert.deepEqual(normalized[2], { name: 'x', description: '' })
})

test('parseSlash：只敲出斜杠时打开面板', () => {
  assert.deepEqual(parseSlash('/'), { active: true, name: '', query: '', args: '', line: '/' })
})

test('parseSlash：敲命令名时给出查询', () => {
  const parsed = parseSlash('/comp')
  assert.equal(parsed.active, true)
  assert.equal(parsed.name, 'comp')
  assert.equal(parsed.query, 'comp')
  assert.equal(parsed.args, '')
})

test('parseSlash：输入空格后进入参数阶段，面板关闭', () => {
  const parsed = parseSlash('/compact 保留测试结果')
  assert.equal(parsed.active, false)
  assert.equal(parsed.name, 'compact')
  assert.equal(parsed.query, '')
  assert.equal(parsed.args, '保留测试结果')
})

test('parseSlash：普通文本不激活面板', () => {
  assert.equal(parseSlash('帮我看下这个').active, false)
  assert.equal(parseSlash('').active, false)
})

test('isCommandLine 只认以斜杠开头的输入', () => {
  assert.equal(isCommandLine('/compact'), true)
  assert.equal(isCommandLine('  /compact'), true)
  assert.equal(isCommandLine('普通消息 /compact'), false)
  assert.equal(isCommandLine('!ls'), false)
})

test('filterCommands：空查询返回全部且保持原顺序', () => {
  assert.deepEqual(filterCommands(items, ''), items)
  assert.deepEqual(filterCommands(items, '  '), items)
})

test('filterCommands：精确 > 前缀 > 子序列 > 描述命中', () => {
  const extra: CommandItem[] = [
    ...items,
    { name: 'compact-all', description: '全部压缩' },
    { name: 'dispatch', description: '分发 compact 任务' },
  ]
  assert.equal(filterCommands(extra, 'compact')[0]?.name, 'compact')
  assert.equal(filterCommands(extra, 'comp')[0]?.name, 'compact')
  assert.ok(filterCommands(extra, 'cmp').some(item => item.name === 'compact'), '子序列 cmp 应命中 compact')
  assert.ok(filterCommands(extra, '分发').some(item => item.name === 'dispatch'), '描述命中')
})

test('filterCommands：无匹配返回空', () => {
  assert.deepEqual(filterCommands(items, 'zzzzz'), [])
})

test('moveSelection 循环且空列表安全', () => {
  assert.equal(moveSelection(6, 0, -1), 5)
  assert.equal(moveSelection(6, 5, 1), 0)
  assert.equal(moveSelection(6, 2, 1), 3)
  assert.equal(moveSelection(0, 3, 1), 0)
})

test('commandLine 拼出交给 commands/execute 的一行', () => {
  assert.equal(commandLine('compact'), '/compact')
  assert.equal(commandLine('compact', '  保留测试  '), '/compact 保留测试')
  assert.equal(commandLine('compact', '   '), '/compact')
})

test('! 与 @ 只识别意图，不改变输入', () => {
  assert.equal(isShellDirect('! npm test'), true)
  assert.equal(isShellDirect('npm test'), false)
  assert.equal(hasFileReference('看下 @src/main.ts 这里'), true)
  assert.equal(hasFileReference('发邮件给 a@b.com'), false)
})
