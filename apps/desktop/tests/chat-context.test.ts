/** 聊天上下文：记忆前置 + 上下文超预算自动就地压缩。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { RemoteTransport } from '@dsh-ghost/harness-port'
import {
  composeChatMessage, contextTokens, evaluateContext, recordsToMessages,
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

test('上下文用量读宿主的真实投影，不自己瞎估', async () => {
  const projections = {
    values: {
      tokenUsage: { uncachedInputTokens: 1200, cacheReadTokens: 8000, cacheWriteTokens: 300, outputTokens: 500 },
      contextPressure: { projectedTokens: 95000, contextWindow: 100000 },
      contextBreakdown: { systemTokens: 4000, toolsTokens: 2000, messageTokens: 89000 },
    },
  }
  const { transport, calls } = fakeTransport({ 'session/projections': () => projections })
  const evaluation = await evaluateContext(transport, 's1')
  assert.equal(evaluation.usage.uncachedInputTokens, 1200)
  assert.equal(evaluation.usage.cacheReadTokens, 8000)
  assert.equal(evaluation.usage.totalInputTokens, 9200)
  assert.equal(evaluation.usage.messageTokens, 89000)
  assert.equal(evaluation.usage.ratio, 0.95)
  assert.equal(evaluation.suggest, true, '95% 压力应提醒')
  assert.deepEqual(calls, ['session/projections'])
})

test('宿主已自动压缩过的压力不重复提醒', async () => {
  const projections = {
    values: {
      tokenUsage: {},
      contextPressure: { projectedTokens: 50000, contextWindow: 100000 },
    },
  }
  const { transport } = fakeTransport({ 'session/projections': () => projections })
  const evaluation = await evaluateContext(transport, 's1')
  assert.equal(evaluation.suggest, false)
})

test('拿不到投影就不提醒，也不猜', async () => {
  const { transport } = fakeTransport({})
  const evaluation = await evaluateContext(transport, 's1')
  assert.equal(evaluation.suggest, false)
  assert.equal(evaluation.usage.projectedTokens, 0)
})
