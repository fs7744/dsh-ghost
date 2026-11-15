#!/usr/bin/env node
/**
 * 一条工单跑到底：触发 → 准入 → 评估 → 建票 → 派活（真实模型）→ 报告。
 *
 * 这是 Engine 第一次被真实驱动：之前它只在测试里跑，现在它的"执行器"会真的
 * 往 harness 里发一条 prompt 并等回合结束。
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { boot, stop, login, createTransport } from './lib-driver.mjs'
import { Engine, MemoryRepositories, ticketStage } from '../packages/superagent/src/core/index.ts'

const REPO = join(import.meta.dirname, '..')
const env = join(REPO, '.env')
if (existsSync(env)) {
  for (const line of readFileSync(env, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (match !== null) process.env[match[1]] ??= match[2]
  }
}

const server = await boot({ profile: 'p05', fromDefault: false })
const transport = createTransport(await login(server.url, 'answer'))
const session = await transport.call('session/create', { request: { cwd: REPO } })
const sessionId = session.sessionId
await transport.call('session/selectModel', { request: { sessionId, provider: 'wb', model: 'hy3' } })
process.stdout.write(`会话    ${sessionId}\n`)

/** 等这一会话的回合结束，返回最后一条 assistant 文本。 */
async function waitTurn(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1500))
    const page = await transport.call('session/page', { request: { address: { kind: 'session', sessionId }, maxMessages: 120 } })
    const records = page.records ?? []
    const ended = records.some(r => r.event?.type === 'turn/end')
    if (ended) {
      const replies = records.filter(r => r.event?.type === 'assistant/message')
      const last = replies.at(-1)
      const text = (last?.event?.data?.message?.content ?? []).filter(p => p.type === 'text').map(p => p.text).join('')
      return { done: true, text, records: records.length }
    }
  }
  return { done: false, text: '', records: 0 }
}

const outbox = []
const picked = []
let lastReply = ''
let finished
const done = new Promise(resolve => { finished = resolve })

const repo = new MemoryRepositories()
const engine = new Engine({
  repo,
  policy: () => ({ version: 'v1', paused: false, gate: () => ({ admissible: true, strength: 'explicit', basis: 'mention' }), revalidate: () => true, admitsInferred: () => true, evalTimeoutMs: 5_000 }),
  scope: { scope: () => ({ listened: true, observed: false }) },
  assessor: {
    request: candidate => {
      // 确定性评估器：本地演示不为"要不要接单"再花一次模型调用
      setTimeout(() => {
        engine.decide(candidate.triggers[0].id, { kind: 'accept', title: `处理：${candidate.triggers[0].text.slice(0, 16)}`, scope: 'local', reason: '明确要求' })
      }, 0)
    },
  },
  executor: {
    start: (ticket, assignment) => { void runAssignment(ticket, assignment.id) },
    deliver: () => {},
    stop: () => {},
  },
  outbox: { send: message => outbox.push(message), status: () => undefined, withdraw: () => {} },
  now: () => new Date().toISOString(),
  emit: event => { if (event.type !== 'trigger.received') process.stdout.write(`  事件 ${event.type}\n`) },
})

/** 执行器：真的发 prompt，等回合结束，再把报告交回 Engine。 */
async function runAssignment(ticket, assignmentId) {
  picked.push(ticket)
  engine.assignmentStarted(ticket.id, assignmentId)
  process.stdout.write(`派活    assignment=${assignmentId} ticket=${ticket.id}\n`)
  try {
    await transport.call('session/prompt', {
      request: { requestId: `ticket-${Date.now()}`, sessionId, mode: 'queue', content: [{ type: 'text', text: ticket.title }] },
    })
    const turn = await waitTurn()
    lastReply = turn.text
    if (!turn.done) throw new Error('回合超时')
    engine.report(ticket.id, { state: 'ready', summary: turn.text.slice(0, 200), at: new Date().toISOString() })
    process.stdout.write(`报告    ready（${turn.records} 条记录）\n`)
  } catch (error) {
    engine.report(ticket.id, { state: 'failed', summary: String(error).slice(0, 120), at: new Date().toISOString() })
    process.stdout.write(`报告    failed：${String(error).slice(0, 120)}\n`)
  } finally {
    finished()
  }
}

// 触发
const trigger = {
  id: `tr-${Date.now()}`,
  source: 'local',
  threads: [{ source: 'local', id: 'demo-1' }],
  actor: { id: 'me', name: 'me' },
  human: true,
  at: new Date().toISOString(),
  text: '用一句话说明 dsh-ghost 是什么',
  channel: { source: 'local', thread: 'demo-1', address: { kind: 'console' } },
  meta: {},
}
process.stdout.write(`触发    ${trigger.text}\n`)
const received = engine.receive(trigger)
process.stdout.write(`收单    ${received}\n`)
engine.evaluateDue()

await Promise.race([done, new Promise(r => setTimeout(r, 150_000))])

process.stdout.write(`\n票数    ${picked.length}\n`)
for (const snapshot of picked) {
  // picked 里存的是旧快照：Engine 在仓库里改的是它自己的副本，必须重新取
  const ticket = repo.tickets.get(snapshot.id) ?? snapshot
  const assignment = ticket.assignments.at(-1)
  process.stdout.write(`  票      ${ticket.title}\n`)
  process.stdout.write(`  阶段    ${JSON.stringify(ticketStage(ticket))}\n`)
  process.stdout.write(`  报告    ${assignment?.report?.state ?? '(无)'} — ${(assignment?.report?.summary ?? '').slice(0, 60)}\n`)
}
process.stdout.write(`回复    ${lastReply.slice(0, 120) || '(空)'}\n`)
process.stdout.write(`外发    ${outbox.length} 条\n`)
await stop(server.child)
process.exit(0)
