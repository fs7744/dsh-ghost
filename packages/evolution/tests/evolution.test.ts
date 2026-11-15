/**
 * test:evolution（一）—— C10-05 记忆进化 / C10-06 剧本·技能进化 / C10-07 度量。
 * 全部用内存 IO 与固定时间源，绝不碰真实磁盘、绝不静默改任何文件之外的东西。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import {
  appendRun, applyProposal, approve, canRollback, compareMetrics, createEvolutionService,
  createProposalStore, dashboard, encodeRun, memoryFileIo, parseRun, proposeFlowChange,
  proposeMemoryConstraint, proposeScriptPromotion, readRuns, reject, rollback, summarize,
  textDiff,
  type ConstraintDraft, type Occurrence, type ProposalDeps, type RunRecord,
} from '../src/index.ts'

const fixedNow = () => new Date('2026-11-15T08:00:00.000Z')
const deps: ProposalDeps = { now: fixedNow, makeId: () => 'fixed-id' }
const occurrences = (count: number): Occurrence[] =>
  Array.from({ length: count }, (_, index) => ({ at: `2026-11-15T0${index}:00:00.000Z`, note: `返工 ${index + 1}` }))
const constraint: ConstraintDraft = {
  name: 'no-npm', title: '不要用 npm', text: '统一用 pnpm，不用 npm。', source: 'task-42',
}
const run = (over: Partial<RunRecord> = {}): RunRecord => ({
  ticketId: 't1', at: '2026-11-15T08:00:00.000Z', completed: true,
  tokens: 100, toolCalls: 10, rework: 1, ...over,
})

test('C10-05 提案三次才触发：1/2 次不生成，第 3 次生成 pending 提案', () => {
  assert.equal(proposeMemoryConstraint({ key: 'npm', occurrences: occurrences(1), constraint, ...deps }), undefined)
  assert.equal(proposeMemoryConstraint({ key: 'npm', occurrences: occurrences(2), constraint, ...deps }), undefined)
  const proposal = proposeMemoryConstraint({ key: 'npm', occurrences: occurrences(3), constraint, ...deps })
  assert.ok(proposal !== undefined)
  assert.equal(proposal.kind, 'memory')
  assert.equal(proposal.status, 'pending')
  assert.equal(proposal.evidence.length, 3)
  assert.equal(proposal.constraint?.name, 'no-npm')
})

test('C10-05 状态机：approve / reject / rollback 且只有 approved 可回滚', () => {
  const proposal = proposeMemoryConstraint({ key: 'npm', occurrences: occurrences(3), constraint, ...deps })!
  const approved = approve(proposal, 'alice', deps)
  assert.equal(approved.status, 'approved')
  assert.equal(approved.decidedAt, '2026-11-15T08:00:00.000Z')
  assert.equal(approved.decidedBy, 'alice')
  assert.equal(canRollback(approved), true)
  assert.equal(rollback(approved, 'alice', deps).status, 'rolled-back')

  const rejected = reject(proposal, 'bob', deps)
  assert.equal(rejected.status, 'rejected')
  assert.equal(canRollback(rejected), false)
  assert.equal(rollback(rejected, 'bob', deps).status, 'rejected')
})

test('C10-05 人闸：驳回不落盘，批准才写 L2，剧本提案不自动应用', async () => {
  let writes = 0
  const sinks = { writeMemory: async (): Promise<void> => { writes += 1 } }
  const proposal = proposeMemoryConstraint({ key: 'npm', occurrences: occurrences(3), constraint, ...deps })!

  const rejectedResult = await applyProposal(reject(proposal, 'bob', deps), sinks)
  assert.equal(rejectedResult.applied, false)
  assert.equal(writes, 0, '驳回绝不写任何记忆')

  const approvedResult = await applyProposal(approve(proposal, 'alice', deps), sinks)
  assert.equal(approvedResult.applied, true)
  assert.equal(writes, 1)

  const flow = proposeFlowChange({
    nodeName: 'b', before: '# @f v1\n# goal g\na\nb\nc\n', after: '# @f v1\n# goal g\na\nb\nd\nc\n',
    reworks: occurrences(2), beforeMetrics: {}, afterMetrics: {}, ...deps,
  })
  const flowResult = await applyProposal(approve(flow, 'alice', deps), sinks)
  assert.equal(flowResult.applied, false, '剧本提案只落盘为文件，运行时不自动改 .flow')
  assert.equal(writes, 1)
})

test('C10-06 剧本提案：带 diff 与 before/after 度量', () => {
  const before = '# @f v1\n# goal g\na\nb\nc\n'
  const after = '# @f v1\n# goal g\na\nb\nd\nc\n'
  const proposal = proposeFlowChange({
    nodeName: 'b', before, after, reworks: occurrences(2),
    beforeMetrics: { completionRate: 0.5, rework: 2 },
    afterMetrics: { completionRate: 0.9, rework: 0 },
    ...deps,
  })
  assert.equal(proposal.kind, 'flow')
  assert.ok(proposal.flowChange?.diff.some(line => line.startsWith('+d')))
  assert.ok(proposal.flowChange?.diff.some(line => line.startsWith(' ')))
  assert.equal(proposal.flowChange?.beforeMetrics.completionRate, 0.5)
  assert.equal(proposal.flowChange?.afterMetrics.completionRate, 0.9)
  assert.ok(textDiff(before, after).some(line => line.startsWith('+')))
})

test('C10-06 技能提案：脚本连续 2 次跑通才沉淀，中间失败不算', () => {
  const two = proposeScriptPromotion({
    path: 'scripts/verify.mjs', content: 'export const ok = true',
    runs: [{ ok: true }, { ok: true }], ...deps,
  })
  assert.ok(two !== undefined)
  assert.equal(two.scriptChange?.passCount, 2)
  assert.equal(proposeScriptPromotion({ path: 'x', content: '', runs: [{ ok: true }], ...deps }), undefined)
  assert.equal(proposeScriptPromotion({
    path: 'x', content: '', runs: [{ ok: true }, { ok: false }, { ok: true }], ...deps,
  }), undefined)
})

test('C10-06 提案仓库：落盘为文件、可查看、驳回状态持久化', async () => {
  const io = memoryFileIo()
  const store = createProposalStore('/evo', io)
  const proposal = proposeMemoryConstraint({ key: 'npm', occurrences: occurrences(3), constraint, ...deps })!
  await store.put(proposal)
  assert.ok(io.files.has(join('/evo', 'proposals', `${proposal.id}.json`)))

  const listed = await store.list()
  assert.equal(listed.length, 1)
  assert.equal(listed[0]?.status, 'pending')

  await store.put(reject(proposal, 'bob', deps))
  assert.equal((await store.get(proposal.id))?.status, 'rejected')
  assert.equal((await store.list())[0]?.decidedBy, 'bob')
  assert.equal(await store.get('nope'), undefined)
})

test('C10-07 runs.jsonl：编解码往返，脏行被跳过', () => {
  const record = run({ ticketId: 't9', rework: 3 })
  assert.deepEqual(parseRun(encodeRun(record)), record)
  assert.equal(parseRun('not json'), undefined)
  assert.equal(parseRun('{"ok":true}'), undefined)
})

test('C10-07 runs.jsonl 汇总：追加、读回、完成率与均值正确', async () => {
  const io = memoryFileIo()
  await appendRun('/evo/runs.jsonl', run({ completed: false, tokens: 100, toolCalls: 10, rework: 2 }), io)
  await appendRun('/evo/runs.jsonl', run({ ticketId: 't2', completed: true, tokens: 100, toolCalls: 10, rework: 1 }), io)
  await io.append('/evo/runs.jsonl', 'GARBAGE LINE\n')
  const runs = await readRuns('/evo/runs.jsonl', io)
  assert.equal(runs.length, 2)
  const summary = summarize(runs)
  assert.equal(summary.runs, 2)
  assert.equal(summary.completionRate, 0.5)
  assert.equal(summary.avgTokens, 100)
  assert.equal(summary.totalRework, 3)
})

test('C10-07 before/after 对比与看板数据结构', () => {
  const before = [run({ completed: false }), run({ ticketId: 't2', completed: true })]
  const after = [
    run({ ticketId: 't3', tokens: 60, toolCalls: 6, rework: 0 }),
    run({ ticketId: 't4', tokens: 60, toolCalls: 6, rework: 0 }),
  ]
  const comparison = compareMetrics(before, after)
  assert.equal(comparison.find(item => item.metric === 'completionRate')?.improved, true)
  assert.equal(comparison.find(item => item.metric === 'avgTokens')?.improved, true)
  assert.equal(comparison.find(item => item.metric === 'completionRate')?.after, 1)
  const board = dashboard(before, after)
  assert.equal(board.runs, 4)
  assert.equal(board.comparison.length, 4)
  assert.equal(board.after.avgToolCalls, 6)
})

test('C10-05 服务：三次返工累积成提案 → 批准写 L2 → 驳回分支不写', async () => {
  const io = memoryFileIo()
  let written = 0
  let seq = 0
  const service = createEvolutionService({
    root: '/evo', io, now: fixedNow, makeId: () => `svc-${++seq}`,
    writeMemory: async (): Promise<void> => { written += 1 },
  })

  assert.equal((await service.propose({ key: 'npm', constraint })).count, 1)
  assert.equal((await service.propose({ key: 'npm', constraint })).count, 2)
  const third = await service.propose({ key: 'npm', constraint })
  assert.equal(third.created, true)
  assert.equal(third.count, 3)
  assert.ok(third.proposal !== undefined)
  assert.equal((await service.list()).length, 1)

  const approved = await service.approve({ id: third.proposal!.id, by: 'alice' })
  assert.equal(approved.applied, true)
  assert.equal(approved.proposal.status, 'approved')
  assert.equal(written, 1)

  for (let index = 0; index < 3; index += 1) await service.propose({ key: 'pnpm', constraint })
  const rejected = await service.reject({ id: 'svc-2', by: 'bob' })
  assert.equal(rejected.applied, false)
  assert.equal(rejected.proposal.status, 'rejected')
  assert.equal(written, 1, '驳回分支绝不写 L2')
})

test('C10-07 服务 metrics：记录 run 并返回看板与记录数', async () => {
  const io = memoryFileIo()
  const service = createEvolutionService({ root: '/evo', io, now: fixedNow })
  const first = await service.metrics({ record: run({ completed: false }) })
  assert.equal(first.recorded, 1)
  assert.equal(first.runs, 1)
  const second = await service.metrics({ record: run({ ticketId: 't2', completed: true }) })
  assert.equal(second.recorded, 2)
  assert.equal(second.before.runs + second.after.runs, 2)
  assert.equal(second.after.completionRate >= 0, true)
})
