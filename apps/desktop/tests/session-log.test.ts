/** 会话日志解析单测：UI 与导出共用这份视图模型。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseMaybe, summarize, toBubbles, type LogRecord } from '../src/session-log.ts'

const ev = (type: string, data: Record<string, unknown>, seq = 1): LogRecord => ({ type: 'event', event: { type, seq, data } })

test('user / assistant 消息抽成气泡', () => {
  const bubbles = toBubbles([
    ev('user/message', { content: [{ type: 'text', text: '第一行' }, { type: 'text', text: '第二行' }] }),
    ev('assistant/message', { message: { content: [{ type: 'text', text: '好的' }] } }),
  ])
  assert.deepEqual(bubbles, [
    { kind: 'user', text: '第一行\n第二行' },
    { kind: 'assistant', text: '好的' },
  ])
})

test('assistant 带工具调用时记录工具名', () => {
  const bubbles = toBubbles([
    ev('assistant/message', { message: { content: [{ type: 'tool-call', name: 'memory_write' }] } }),
  ])
  assert.deepEqual(bubbles, [{ kind: 'assistant', text: '', tool: 'memory_write' }])
})

test('tool/call 与 tool/result 按 callId 配对，结果取 message.content', () => {
  const bubbles = toBubbles([
    ev('tool/call', { callId: 'c1', name: 'read', arguments: '{"path":"a.ts"}' }),
    ev('tool/result', { callId: 'c1', message: { content: [{ type: 'text', text: '文件内容' }] } }),
  ])
  assert.equal(bubbles[0]?.kind, 'toolcall')
  assert.equal((bubbles[0] as { name: string }).name, 'read')
  assert.match((bubbles[0] as { text: string }).text, /a\.ts/)
  assert.deepEqual(bubbles[1], { kind: 'tool', name: 'read', text: '文件内容' })
})

test('工具结果没有 content 时退回原始 JSON', () => {
  const bubbles = toBubbles([ev('tool/result', { callId: 'c9', name: 'glob', result: 'ok' })])
  assert.equal(bubbles[0]?.kind, 'tool')
  assert.match((bubbles[0] as { text: string }).text, /glob/)
})

test('turn/end 变成注释，非 event 记录被忽略', () => {
  const bubbles = toBubbles([
    { type: 'marker' },
    ev('turn/end', { reason: { kind: 'end' } }),
  ] as LogRecord[])
  assert.deepEqual(bubbles, [{ kind: 'note', text: '回合结束（end）' }])
})

test('斜杠命令执行也进视图模型（不进模型消息但导出可见）', () => {
  const bubbles = toBubbles([
    ev('command/run', { commandId: 'cmd-1', name: 'compact', args: '保留测试' }),
  ])
  assert.deepEqual(bubbles, [{ kind: 'note', text: '命令 /compact 保留测试' }])
})

test('parseMaybe 解析 JSON 字符串，失败原样返回', () => {
  assert.deepEqual(parseMaybe('{"a":1}'), { a: 1 })
  assert.equal(parseMaybe('纯文本'), '纯文本')
  assert.equal(parseMaybe(7), 7)
})

test('summarize 截断长文本且容忍循环引用', () => {
  assert.equal(summarize('abcdef', 3), 'abc')
  assert.equal(summarize(undefined), '')
  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic
  assert.equal(typeof summarize(cyclic), 'string')
})
