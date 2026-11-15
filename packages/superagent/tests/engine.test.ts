import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Engine, MemoryRepositories } from '../src/core/index.ts'
import type { EngineOptions, Policy, Trigger } from '../src/core/index.ts'

/** 建一份全内存的引擎：端口用假的，断言靠 spy 数组。 */
function build(over: Partial<Record<string, unknown>> = {}) {
  const events = []
  const assessed = []
  const executorCalls = []
  const sent = []
  const policy: Policy = {
    version: 'v1',
    paused: false,
    gate: () => ({ admissible: true, strength: 'strong', basis: 'mandate' }),
    revalidate: () => true,
    admitsInferred: () => true,
    evalTimeoutMs: 1_000,
  }
  const base = {
    repo: new MemoryRepositories(),
    policy: () => policy,
    scope: { scope: () => ({ listened: true, observed: false }) },
    assessor: { request: candidate => assessed.push(candidate) },
    executor: { start: (...args) => executorCalls.push(['start', ...args]), deliver: (...args) => executorCalls.push(['deliver', ...args]), end: () => {} },
    outbox: { send: message => sent.push(message), status: () => undefined, withdraw: () => {} },
    now: () => '2026-02-01T00:00:00.000Z',
    emit: event => events.push(event),
    ...over,
  }
  const engine = new Engine(base as unknown as EngineOptions)
  return { engine, repo: base.repo as MemoryRepositories, events, assessed, executorCalls, sent }
}

/** 一个最小可用的 Trigger。 */
function trigger(over: Record<string, unknown> = {}): Trigger {
  return {
    id: 'tr1',
    source: 'github',
    threads: [{ source: 'github', id: 'issue-1' }],
    actor: { id: 'u1', name: 'alice' },
    human: true,
    at: '2026-02-01T00:00:00.000Z',
    text: '这个构建挂了，修一下',
    meta: {},
    ...over,
  } as unknown as Trigger
}

test('没有 thread 的 trigger 直接拒绝', () => {
  const { engine } = build()
  assert.throws(() => engine.receive(trigger({ threads: [] })), /at least one thread/)
})

test('同一 trigger 第二次是 duplicate', () => {
  const { engine } = build()
  assert.equal(engine.receive(trigger()), 'stored')
  assert.equal(engine.receive(trigger()), 'duplicate')
})

test('scope 不听 → filtered，并记下原因', () => {
  const { engine, repo } = build({ scope: { scope: () => ({ listened: false, reason: 'not-in-watched-repo' }) } })
  assert.equal(engine.receive(trigger()), 'filtered')
  assert.equal(repo.triggers.disposition('tr1')?.filtered?.code, 'not-in-watched-repo')
})

test('通过 scope → stored，且发出 trigger.received 事件', () => {
  const { engine, events, repo } = build()
  assert.equal(engine.receive(trigger()), 'stored')
  assert.deepEqual(events.map(event => event.type), ['trigger.received'])
  const disposition = repo.triggers.disposition('tr1')
  assert.deepEqual(disposition?.fanout, [])
  assert.equal(disposition?.filtered, undefined)
})

test('时间戳被规范化成 ISO', () => {
  const { engine, repo } = build()
  engine.receive(trigger({ at: '2026-02-01T00:00:00Z' }))
  assert.equal(repo.triggers.get('tr1')?.at, '2026-02-01T00:00:00.000Z')
})

test('重复投递不会覆盖已有记录', () => {
  const { engine, repo } = build()
  engine.receive(trigger({ text: '第一版' }))
  engine.receive(trigger({ text: '第二版' }))
  assert.equal(repo.triggers.get('tr1')?.text, '第一版')
})

test('evaluateDue 把待评估的 trigger 交给 assessor', () => {
  const { engine, assessed } = build()
  engine.receive(trigger())
  assert.equal(assessed.length, 0, 'receive 只排队，不同步评估')
  engine.evaluateDue()
  assert.equal(assessed.length, 1)
  assert.equal(assessed[0].triggers[0].id, 'tr1')
  assert.equal(assessed[0].policyVersion, 'v1')
  assert.equal(assessed[0].strength, 'strong')
})

test('candidate 在评估前为空，评估后有值', () => {
  const { engine } = build()
  engine.receive(trigger())
  assert.equal(engine.candidate('tr1'), undefined)
  engine.evaluateDue()
  const candidate = engine.candidate('tr1')
  assert.ok(candidate !== undefined)
  assert.equal(candidate.thread.key, 'github:issue-1')
})
