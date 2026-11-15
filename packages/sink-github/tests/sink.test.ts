import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGithubSink } from '../src/index.ts'
import type { OutboundMessage } from '@dsh-ghost/superagent'

const message = (over: Partial<OutboundMessage> = {}): OutboundMessage => ({
  id: 'm1',
  channel: { source: 'github', thread: 'fs7744/dsh-ghost#42', address: { repo: 'fs7744/dsh-ghost', number: '42' } } as never,
  text: '收到，开始看',
  kind: 'acknowledgement',
  ...over,
})

/** 记录调用的假 post。 */
function fakePost(fail = false) {
  const calls = []
  return {
    calls,
    post: async (url: string, body: unknown, headers: Record<string, string>) => {
      calls.push({ url, body, headers })
      return fail ? { ok: false as const, error: 'HTTP 500' } : { ok: true as const, commentId: 'c-1' }
    },
  }
}

test('send 只是排队，flush 才真的发出去', async () => {
  const { calls, post } = fakePost()
  const sink = createGithubSink({ token: 't', repo: 'fs7744/dsh-ghost', post })
  sink.send(message())
  assert.equal(calls.length, 0)
  assert.equal(sink.status('m1'), 'pending')
  const result = await sink.flush()
  assert.deepEqual(result, { sent: 1, failed: 0 })
  assert.equal(sink.status('m1'), 'sent')
  assert.equal(calls.length, 1)
  assert.match(calls[0].url, /\/repos\/fs7744\/dsh-ghost\/issues\/42\/comments$/)
  assert.deepEqual(calls[0].body, { body: '收到，开始看' })
  assert.match(calls[0].headers.authorization, /^Bearer /)
})

test('幂等：同一个 id 排两次只发一次，且保留第一条内容', async () => {
  const { calls, post } = fakePost()
  const sink = createGithubSink({ token: 't', repo: 'r', post })
  sink.send(message())
  sink.send(message({ text: '被覆盖?' }))
  await sink.flush()
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].body, { body: '收到，开始看' })
})

test('已发送的不会被再次 flush', async () => {
  const { calls, post } = fakePost()
  const sink = createGithubSink({ token: 't', repo: 'r', post })
  sink.send(message())
  await sink.flush()
  await sink.flush()
  assert.equal(calls.length, 1)
})

test('失败保持 pending 并记原因，下次 flush 会重试', async () => {
  const { post } = fakePost(true)
  const sink = createGithubSink({ token: 't', repo: 'r', post })
  sink.send(message())
  const first = await sink.flush()
  assert.deepEqual(first, { sent: 0, failed: 1 })
  assert.equal(sink.status('m1'), 'pending')
  assert.equal(sink.entries()[0]?.error, 'HTTP 500')
  assert.equal(sink.entries()[0]?.attempts, 1)
})

test('永久失败（4xx）立即丢弃，不再无限重试', async () => {
  let calls = 0
  const sink = createGithubSink({
    token: 't', repo: 'r',
    post: async () => { calls += 1; return { ok: false, error: 'HTTP 404' } },
  })
  sink.send(message())
  await sink.flush()
  assert.equal(sink.status('m1'), 'dropped')
  await sink.flush()
  assert.equal(calls, 1, '4xx 不应再重试')
})

test('服务端失败（5xx）重试到上限后丢弃', async () => {
  let calls = 0
  const sink = createGithubSink({
    token: 't', repo: 'r', maxAttempts: 3,
    post: async () => { calls += 1; return { ok: false, error: 'HTTP 500' } },
  })
  sink.send(message())
  for (let index = 0; index < 5; index += 1) await sink.flush()
  assert.equal(calls, 3)
  assert.equal(sink.status('m1'), 'dropped')
  assert.match(sink.entries()[0]?.error ?? '', /max-attempts/)
})

test('找不到目标编号时丢弃，不发也不重试', async () => {
  const { calls, post } = fakePost()
  const sink = createGithubSink({ token: 't', repo: 'r', post })
  sink.send(message({ channel: { source: 'github', thread: 'no-number', address: {} } as never }))
  const result = await sink.flush()
  assert.deepEqual(result, { sent: 0, failed: 0 })
  assert.equal(sink.status('m1'), 'dropped')
  assert.equal(calls.length, 0)
})

test('withdraw 只对未发出的生效', async () => {
  const { post } = fakePost()
  const sink = createGithubSink({ token: 't', repo: 'r', post })
  sink.send(message({ id: 'a' }))
  sink.withdraw('a')
  assert.equal(sink.status('a'), 'dropped')
  await sink.flush()
  assert.equal(sink.status('a'), 'dropped')
})

test('超长正文先截断再发，避免 422 永久失败', async () => {
  const { calls, post } = fakePost()
  const sink = createGithubSink({ token: 't', repo: 'r', post, maxBodyChars: 100 })
  sink.send(message({ text: 'x'.repeat(500) }))
  const result = await sink.flush()
  assert.deepEqual(result, { sent: 1, failed: 0 })
  const body = (calls[0]?.body as { body: string }).body
  assert.ok(body.length < 200)
  assert.match(body, /已截断，原文 500 字/)
})
