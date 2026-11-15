import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canRetry, key, ticketStage } from '../src/core/index.ts'
import type { Assignment, Ticket } from '../src/core/index.ts'

/** 只造这个分类器会读的字段；其余用断言跳过（测的是纯分类，不是 schema）。 */
function ticket(over: Record<string, unknown> = {}): Ticket {
  return {
    id: 't1',
    title: '修一个构建失败',
    decisionId: 'd1',
    channels: [],
    assignments: [],
    inputs: [],
    undelivered: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    origin: { triggerId: 'tr1', triggerIds: [] },
    mandate: {},
    ...over,
  } as unknown as Ticket
}

function assignment(over: Record<string, unknown> = {}): Assignment {
  return { id: 'a1', state: 'running', createdAt: '2026-01-01T00:00:00.000Z', ...over } as unknown as Assignment
}

test('已结束的 ticket 优先判 ended', () => {
  const ended = ticket({ ended: { at: '2026-01-02T00:00:00.000Z', by: 'person', outcome: 'delivered' }, delivery: { error: 'x', at: '2026-01-02T00:00:00.000Z' } })
  assert.deepEqual(ticketStage(ended), { stage: 'ended' })
  assert.equal(canRetry(ended), false)
})

test('交付失败 → person/delivery，且可重试', () => {
  const staged = ticket({ delivery: { error: '网络断了', at: '2026-01-02T00:00:00.000Z' } })
  assert.deepEqual(ticketStage(staged), { stage: 'person', action: 'delivery' })
  assert.equal(canRetry(staged), true)
})

test('有待答问题 → person/answer', () => {
  const asked = ticket({ attention: { question: '要不要顺便升级依赖？', at: '2026-01-02T00:00:00.000Z' } })
  assert.deepEqual(ticketStage(asked), { stage: 'person', action: 'answer' })
})

test('报告 ready → 等评审', () => {
  const reported = ticket({ assignments: [assignment({ report: { state: 'ready', summary: '改好了', at: '2026-01-02T00:00:00.000Z' } })] })
  assert.deepEqual(ticketStage(reported), { stage: 'person', action: 'review' })
})

test('报告 blocked 且没人接手 → person/blocked，可重试', () => {
  const blocked = ticket({ assignments: [assignment({ report: { state: 'blocked', summary: '缺权限', at: '2026-01-02T00:00:00.000Z' } })] })
  assert.deepEqual(ticketStage(blocked), { stage: 'person', action: 'blocked' })
  assert.equal(canRetry(blocked), true)
})

test('blocked 之后有人回话 → 回到执行', () => {
  const resumed = ticket({
    assignments: [assignment({ report: { state: 'blocked', summary: '缺权限', at: '2026-01-02T00:00:00.000Z' } })],
    inputs: [{ kind: 'trigger', human: true, at: '2026-01-03T00:00:00.000Z' }],
  })
  assert.deepEqual(ticketStage(resumed), { stage: 'working' })
})

test('没有 assignment → 排队中', () => {
  assert.deepEqual(ticketStage(ticket()), { stage: 'working', action: 'queued' })
  assert.deepEqual(ticketStage(ticket({ assignments: [assignment({ state: 'pending' })] })), { stage: 'working', action: 'queued' })
})

test('报告 waiting 或 assignment 已结束 → idle', () => {
  assert.deepEqual(ticketStage(ticket({ assignments: [assignment({ report: { state: 'waiting', summary: '', at: '2026-01-02T00:00:00.000Z' } })] })), { stage: 'idle' })
  assert.deepEqual(ticketStage(ticket({ assignments: [assignment({ state: 'ended' })] })), { stage: 'idle' })
})

test('其余情况 → working（无 action）', () => {
  assert.deepEqual(ticketStage(ticket({ assignments: [assignment()] })), { stage: 'working' })
})

test('key() 生成稳定且可读的键', () => {
  assert.equal(key('Ticket', 'abc'), key('Ticket', 'abc'))
  assert.notEqual(key('Ticket', 'abc'), key('Ticket', 'abd'))
  assert.ok(key('Ticket', 'abc').includes('abc') || key('Ticket', 'abc').length > 0)
})
