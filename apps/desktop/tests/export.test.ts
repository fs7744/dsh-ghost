/** 会话导出单测（C11-06）：Markdown 给人，JSONL 给机器。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { exportFilename, exportJsonl, exportMarkdown, type ExportMeta } from '../src/export.ts'
import type { Bubble } from '../src/session-log.ts'

const bubbles: Bubble[] = [
  { kind: 'user', text: '帮我看下这个仓库' },
  { kind: 'assistant', text: '用的是 npm', tool: 'glob' },
  { kind: 'toolcall', name: 'glob', text: '{"pattern":"package*.json"}' },
  { kind: 'tool', name: 'glob', text: 'package-lock.json' },
  { kind: 'note', text: '回合结束（end）' },
]
const meta: ExportMeta = { sessionId: 'session-abc', title: '包管理器确认', exportedAt: '2026-11-15T10:00:00.000Z' }

test('Markdown 头部带会话 id / 时间 / 消息数', () => {
  const md = exportMarkdown(bubbles, meta)
  assert.match(md, /^# 包管理器确认/)
  assert.match(md, /会话：`session-abc`/)
  assert.match(md, /导出时间：2026-11-15T10:00:00\.000Z/)
  assert.match(md, /消息数：5/)
})

test('Markdown 每种气泡都有对应段落', () => {
  const md = exportMarkdown(bubbles, meta)
  assert.match(md, /## 你\n\n帮我看下这个仓库/)
  assert.match(md, /## Ghost（调用 glob）\n\n用的是 npm/)
  assert.match(md, /> 工具调用 `glob`/)
  assert.match(md, /> 工具结果 `glob`/)
  assert.match(md, /_回合结束（end）_/)
  assert.match(md, /package-lock\.json/)
})

test('代码围栏自适应：正文含反引号也不会撑破 Markdown', () => {
  const md = exportMarkdown([{ kind: 'tool', name: 'read', text: '```js\ncode\n```' }], meta)
  assert.match(md, /````text\n```js\ncode\n```\n````/)
})

test('标题可省略，空消息只有头部', () => {
  const md = exportMarkdown([], { sessionId: 's1', exportedAt: '2026-01-01T00:00:00.000Z' })
  assert.match(md, /^# 会话记录/)
  assert.match(md, /消息数：0/)
  assert.ok(!md.includes('## '))
})

test('JSONL 一行一条原始记录且每行可解析', () => {
  const records = [
    { type: 'event', event: { type: 'user/message', seq: 1, data: { content: [{ type: 'text', text: '你好' }] } } },
    { type: 'event', event: { type: 'turn/end', seq: 2, data: { reason: { kind: 'end' } } } },
  ]
  const jsonl = exportJsonl(records)
  const lines = jsonl.trimEnd().split('\n')
  assert.equal(lines.length, 2)
  assert.deepEqual(JSON.parse(lines[0] ?? ''), records[0])
  assert.deepEqual(JSON.parse(lines[1] ?? ''), records[1])
  assert.match(jsonl, /"text":"你好"/)
})

test('JSONL 空列表返回空串，不可序列化值单独兜底', () => {
  assert.equal(exportJsonl([]), '')
  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic
  const jsonl = exportJsonl([{ ok: 1 }, cyclic])
  const lines = jsonl.trimEnd().split('\n')
  assert.equal(lines.length, 2)
  assert.deepEqual(JSON.parse(lines[1] ?? ''), { error: 'unserializable', type: 'object' })
})

test('文件名清洗特殊字符并带正确扩展名', () => {
  assert.equal(exportFilename('session-abc', 'md'), 'dsh-ghost-session-abc.md')
  assert.equal(exportFilename('D:\\tmp/a:b?c', 'jsonl'), 'dsh-ghost-D--tmp-a-b-c.jsonl')
  assert.equal(exportFilename('', 'md'), 'dsh-ghost-session.md')
})
