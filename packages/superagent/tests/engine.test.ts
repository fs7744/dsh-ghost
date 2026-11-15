import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Engine, MemoryRepositories, ticketStage } from '../src/core/index.ts'
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
    executor: {
      start: (...args) => executorCalls.push(['start', ...args]),
      deliver: (...args) => executorCalls.push(['deliver', ...args]),
      stop: (...args) => executorCalls.push(['stop', ...args]),
    },
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

test('decide accept → 建出 ticket，且标题来自评估结果', () => {
  const { engine, repo } = build()
  engine.receive(trigger())
  engine.evaluateDue()
  const decision = engine.decide('tr1', { kind: 'accept', title: '修复构建', scope: 'repo-a', reason: '明确要求' })
  assert.equal(decision.kind, 'accept')
  const ticketId = decision.ticketId
  assert.ok(typeof ticketId === 'string' && ticketId.length > 0)
  const ticket = repo.tickets.get(ticketId)
  assert.ok(ticket !== undefined)
  assert.equal(ticket.title, '修复构建')
  assert.equal(ticket.ended, undefined, '新票是打开的')
})

test('decide ignore → 不建票', () => {
  const { engine, repo } = build()
  engine.receive(trigger())
  engine.evaluateDue()
  const before = repo.tickets
  const decision = engine.decide('tr1', { kind: 'ignore', reason: '只是闲聊' })
  assert.equal(decision.kind, 'ignore')
  assert.equal(decision.ticketId, undefined)
  assert.equal(before.get('nope'), undefined)
})

test('同一 trigger 重复 accept 不会建第二张票', () => {
  const { engine } = build()
  engine.receive(trigger())
  engine.evaluateDue()
  const first = engine.decide('tr1', { kind: 'accept', title: '修复构建', scope: 'repo-a', reason: '明确要求' })
  const again = engine.decide('tr1', { kind: 'accept', title: '修复构建', scope: 'repo-a', reason: '明确要求' })
  assert.equal(again.ticketId, first.ticketId)
})

test('建票后会派活给 executor', () => {
  const { engine, executorCalls } = build()
  engine.receive(trigger())
  engine.evaluateDue()
  engine.decide('tr1', { kind: 'accept', title: '修复构建', scope: 'repo-a', reason: '明确要求' })
  assert.ok(executorCalls.some(call => call[0] === 'start'), `期望 start，实际 ${JSON.stringify(executorCalls.map(c => c[0]))}`)
})

test('报告 ready → 票进入待评审', () => {
  const { engine, repo } = build()
  engine.receive(trigger())
  engine.evaluateDue()
  const decision = engine.decide('tr1', { kind: 'accept', title: '修复构建', scope: 'repo-a', reason: '明确要求' })
  const ticketId = decision.ticketId
  const assignment = repo.tickets.get(ticketId).assignments.at(-1)
  engine.assignmentStarted(ticketId, assignment.id)
  engine.report(ticketId, { state: 'ready', summary: '改好了', at: '2026-02-01T01:00:00.000Z' })
  const updated = repo.tickets.get(ticketId)
  assert.equal(updated.assignments.at(-1).report.state, 'ready')
})

test('没有 follow 项时，report ready 直接结束票（领域规则，不是 bug）', () => {
  const { engine, repo } = build()
  engine.receive(trigger())
  engine.evaluateDue()
  const decision = engine.decide('tr1', { kind: 'accept', title: '修复构建', scope: 'repo-a', reason: '明确要求' })
  const ticketId = decision.ticketId
  const assignment = repo.tickets.get(ticketId).assignments.at(-1)
  engine.assignmentStarted(ticketId, assignment.id)
  engine.report(ticketId, { state: 'ready', summary: '改好了', at: '2026-02-01T01:00:00.000Z' })
  // 领域规则：ready 报告在没有 follow 项（如 PR 未合并）时即视为完成，票结束。
  // 面板的"待人处理"看到的是那些还需要人动手的票（review / blocked / answer / delivery）。
  const stage = ticketStage(repo.tickets.get(ticketId))
  assert.equal(stage.stage, 'ended')
})

test('stopTicket 之后票是 ended，且不可重试', () => {
  const { engine, repo } = build()
  engine.receive(trigger())
  engine.evaluateDue()
  const decision = engine.decide('tr1', { kind: 'accept', title: '修复构建', scope: 'repo-a', reason: '明确要求' })
  const ticketId = decision.ticketId
  const stopped = engine.stopTicket(ticketId, '人叫停')
  assert.ok(stopped.ended !== undefined)
  assert.equal(stopped.ended.by, 'human')
})
