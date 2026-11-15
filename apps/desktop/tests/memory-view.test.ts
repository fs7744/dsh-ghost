/** 记忆界面纯逻辑单测（C10-03）。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bucketOf, groupEntries, memorySummary, validEntryName, type MemoryEntry } from '../src/memory-view.ts'

const NOW = new Date('2026-11-15T12:00:00.000Z')
const at = (days: number): string => new Date(NOW.getTime() - days * 86_400_000).toISOString()
const entry = (name: string, updated: string): MemoryEntry => ({ name, title: name, updated })

test('名称必须是 kebab-case，与后端 gate 一致', () => {
  assert.equal(validEntryName('build-command'), true)
  assert.equal(validEntryName('a'), true)
  assert.equal(validEntryName('Build-Command'), false)
  assert.equal(validEntryName('-lead'), false)
  assert.equal(validEntryName('有中文'), false)
  assert.equal(validEntryName(''), false)
})

test('按更新时间分桶', () => {
  assert.equal(bucketOf(at(0.2), NOW), 'today')
  assert.equal(bucketOf(at(3), NOW), 'week')
  assert.equal(bucketOf(at(30), NOW), 'older')
  assert.equal(bucketOf('', NOW), 'unknown')
  assert.equal(bucketOf('不是日期', NOW), 'unknown')
  assert.equal(bucketOf(at(-1), NOW), 'unknown', '未来时间归到未标注，不假装是今天')
})

test('分组只返回非空组，顺序固定，组内按名称排序', () => {
  const groups = groupEntries([
    entry('zeta', at(30)),
    entry('beta', at(0.1)),
    entry('alpha', at(0.1)),
    entry('no-time', ''),
  ], NOW)
  assert.deepEqual(groups.map(group => group.key), ['today', 'older', 'unknown'])
  assert.deepEqual(groups[0]?.items.map(item => item.name), ['alpha', 'beta'])
  assert.equal(groups[0]?.label, '今天')
})

test('空列表没有分组', () => {
  assert.deepEqual(groupEntries([], NOW), [])
})

test('状态摘要反映条数与开关', () => {
  assert.equal(memorySummary([entry('a', at(0))], true), '1 条记忆 · 写入已开启')
  assert.equal(memorySummary([], false), '0 条记忆 · 写入已关闭')
})
