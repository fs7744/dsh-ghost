/** Checkpoint / rewind 纯逻辑单测（C11-05）。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findRewindPoints, forkRequest, rewindLabel } from '../src/rewind.ts'
import type { LogRecord } from '../src/session-log.ts'

const ev = (type: string, seq: number, data: Record<string, unknown> = {}): LogRecord =>
  ({ type: 'event', event: { type, seq, data } })
const user = (seq: number, text: string): LogRecord =>
  ev('user/message', seq, { content: [{ type: 'text', text }] })

test('只把有正文的 user/message 变成回退点，按 seq 升序', () => {
  const records = [
    ev('header', 0),
    user(7, '第二条'),
    ev('tool/call', 3),
    user(2, '第一条'),
    ev('assistant/message', 4, { message: { content: [{ type: 'text', text: '好的' }] } }),
  ]
  const points = findRewindPoints(records)
  assert.deepEqual(points.map(point => [point.seq, point.label, point.index]), [
    [2, '第一条', 1],
    [7, '第二条', 2],
  ])
})

test('空消息、无 seq、非 event 记录都被跳过', () => {
  const records: LogRecord[] = [
    user(1, '   '),
    { type: 'marker' },
    ev('user/message', Number.NaN, { content: [{ type: 'text', text: '无效' }] }),
    ev('user/message', 5, { content: [{ type: 'image', text: '不算' }] }),
    user(6, '有效'),
  ]
  assert.deepEqual(findRewindPoints(records).map(point => point.seq), [6])
})

test('多行正文拼成预览，过长会截断', () => {
  const long = '甲'.repeat(60)
  const [point] = findRewindPoints([user(1, `第一行\n第二行`), user(2, long)])
  assert.equal(point?.label, '第一行\n第二行')
  assert.equal(findRewindPoints([user(2, long)])[0]?.label.length, 49)
  assert.ok(findRewindPoints([user(2, long)])[0]?.label.endsWith('…'))
})

test('forkRequest 带 checkpoint 时给出 atSeq，不带时省略', () => {
  const [point] = findRewindPoints([user(9, '回退点')])
  assert.deepEqual(forkRequest('session-a', point), { request: { sessionId: 'session-a', atSeq: 9 } })
  assert.deepEqual(forkRequest('session-a'), { request: { sessionId: 'session-a' } })
})

test('确认文案说明序号、预览与原会话不变', () => {
  const [point] = findRewindPoints([user(3, '帮我改一下')])
  const label = rewindLabel(point!)
  assert.match(label, /第 1 条消息/)
  assert.match(label, /帮我改一下/)
  assert.match(label, /当前会话不变/)
})

test('空日志没有回退点', () => {
  assert.deepEqual(findRewindPoints([]), [])
})
