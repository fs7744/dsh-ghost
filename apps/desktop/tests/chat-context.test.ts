/** 聊天上下文：记忆前置 + 上下文超预算自动就地压缩。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { RemoteTransport } from '@dsh-ghost/harness-port'
import {
  composeChatMessage, contextTokens, planCompaction, recordsToMessages,
} from '../src/chat-context.ts'

/** 造一个只会回固定答案的假传输。 */
function fakeTransport(handlers: Record<string, (args: unknown) => unknown>): { transport: RemoteTransport; calls: string[] } {
  const calls: string[] = []
  const transport = {
    async call(endpoint: string, args: unknown) {
      calls.push(endpoint)
      const handler = handlers[endpoint]
      if (handler === undefined) throw new Error(`no handler for ${endpoint}`)
      return handler(args)
    },
    async events() { /* 不需要 */ },
  } as unknown as RemoteTransport
  return { transport, calls }
}

const RECORDS = [
  { type: 'event', event: { type: 'user/message', seq: 1, data: { content: [{ type: 'text', text: '你好' }] } } },
  { type: 'event', event: { type: 'assistant/message', seq: 2, data: { message: { content: [{ type: 'text', text: '在的' }] } } } },
]

test('记忆块拼在用户原话后面', () => {
  assert.equal(composeChatMessage('做这件事', ''), '做这件事')
  assert.equal(composeChatMessage('做这件事', '<project-memory>…</project-memory>'), '做这件事\n\n<project-memory>…</project-memory>')
})

test('会话记录能转成可估算的消息', () => {
  const messages = recordsToMessages(RECORDS)
  assert.equal(messages.length, 2)
  assert.equal(messages[0].role, 'user')
  assert.equal(messages[1].role, 'assistant')
  assert.ok(contextTokens(RECORDS) > 0)
})

test('上下文没超预算就不压缩', async () => {
  const { transport, calls } = fakeTransport({ 'session/page': () => ({ records: RECORDS }) })
  const decision = await planCompaction({ transport, sessionId: 's1', maxTokens: 100_000 })
  assert.equal(decision.action, 'none')
  assert.deepEqual(calls, ['session/page'])
})

test('超预算时调宿主 /compact 就地压缩', async () => {
  const heavy = Array.from({ length: 20 }, (_, index) => ({
    type: 'event',
    event: { type: 'user/message', seq: index, data: { content: [{ type: 'text', text: 'x'.repeat(2000) }] } },
  }))
  const { transport, calls } = fakeTransport({
    'session/page': () => ({ records: heavy }),
    'commands/execute': () => ({ ok: true }),
  })
  const decision = await planCompaction({ transport, sessionId: 's1', maxTokens: 1000, mode: 'host' })
  assert.equal(decision.action, 'host')
  assert.ok(calls.includes('commands/execute'))
  assert.equal(calls.includes('session/create'), false, '就地压缩不该新开会话')
})

test('off 模式完全不触发', async () => {
  const { transport, calls } = fakeTransport({ 'session/page': () => ({ records: RECORDS }) })
  const decision = await planCompaction({ transport, sessionId: 's1', maxTokens: 1, mode: 'off' })
  assert.equal(decision.action, 'none')
  assert.deepEqual(calls, [])
})
