/**
 * 审批 / 上下文压缩点 / 反馈聚合纯逻辑单测（test:panels 的一部分）。
 * 覆盖：审批选项解析、压缩点标记计算、反馈聚合、会话统计容错。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { LogRecord } from '../src/session-log.ts'
import {
  buildApprovalReply, extractApprovals, optionKind, parseApprovalOptions,
} from '../src/approval.ts'
import {
  barTone, computeOccupancy, findCompactionMarks, formatTokens, markOffsets, type CompactionMark,
} from '../src/context-bar.ts'
import {
  aggregateFeedback, buildFeedbackPut, formatDuration, normalizeFeedbackEntries, sessionStats,
} from '../src/feedback.ts'

test('optionKind 从 id / 文案推断允许、总是允许、拒绝、其它', () => {
  assert.equal(optionKind('allow', '批准'), 'allow')
  assert.equal(optionKind('always-allow', '总是允许'), 'always')
  assert.equal(optionKind('deny', '拒绝'), 'deny')
  assert.equal(optionKind('reject', ''), 'deny')
  assert.equal(optionKind('misc', '随便'), 'other')
})

test('parseApprovalOptions 丢弃畸形项并按语义排序', () => {
  const options = parseApprovalOptions([
    { id: 'deny', label: '拒绝' },
    { id: 'allow', label: '批准' },
    { id: 'always', label: '总是允许' },
    { id: 'misc', label: '其它' },
    null,
    { label: '' },
  ])
  assert.deepEqual(options.map(option => option.kind), ['allow', 'always', 'deny', 'other'])
  assert.deepEqual(parseApprovalOptions(undefined), [])
  assert.deepEqual(parseApprovalOptions({ nope: 1 }), [])
})

test('extractApprovals 兼容 {active:[]} 形态并跳过已答项', () => {
  const approvals = extractApprovals({ values: { userApproval: { active: [
    {
      callId: 'c1', question: '允许写文件?', agentId: 's1',
      options: [{ id: 'allow', label: '批准' }, { id: 'deny', label: '拒绝' }],
    },
    { callId: 'c2', question: '已答', answered: true },
  ] } } })
  assert.equal(approvals.length, 1)
  assert.equal(approvals[0]?.callId, 'c1')
  assert.equal(approvals[0]?.options[0]?.kind, 'allow')
  assert.deepEqual(extractApprovals(null), [])
})

test('buildApprovalReply：拒绝 -> approved:false，批准 -> true', () => {
  const request = {
    id: 'r1', callId: 'c1', agentId: 's1', title: 'T', detail: 'D',
    options: parseApprovalOptions([{ id: 'deny', label: '拒绝' }, { id: 'allow', label: '批准' }]),
  }
  const deny = request.options.find(option => option.kind === 'deny')!
  const allow = request.options.find(option => option.kind === 'allow')!
  const denied = buildApprovalReply(request, deny)
  assert.equal(denied.endpoint, 'actionCards/act')
  assert.equal(denied.args['verb'], 'deny')
  assert.equal((denied.args['payload'] as { approved: boolean }).approved, false)
  const approved = buildApprovalReply(request, allow)
  assert.equal(approved.args['verb'], 'allow')
  assert.equal((approved.args['payload'] as { approved: boolean }).approved, true)
})

test('computeOccupancy 归一化为 0..1，空 / 畸形 / 越界都安全', () => {
  assert.deepEqual(computeOccupancy(500, 1000), { ratio: 0.5, used: 500, total: 1000 })
  assert.deepEqual(computeOccupancy(2000, 1000), { ratio: 1, used: 2000, total: 1000 })
  assert.deepEqual(computeOccupancy(-5, 1000), { ratio: 0, used: -5, total: 1000 })
  assert.deepEqual(computeOccupancy(undefined, undefined), { ratio: 0, used: 0, total: 0 })
  assert.deepEqual(computeOccupancy('x', 0), { ratio: 0, used: 0, total: 0 })
})

test('barTone 阈值与 formatTokens 千分位格式化', () => {
  assert.equal(barTone(0.9), 'danger')
  assert.equal(barTone(0.7), 'warn')
  assert.equal(barTone(0.3), 'ok')
  assert.equal(formatTokens(0), '0')
  assert.equal(formatTokens(950), '950')
  assert.equal(formatTokens(12500), '12.5k')
  assert.equal(formatTokens(Number.NaN), '0')
})

test('findCompactionMarks 提取压缩点、被压原文并按 seq 升序', () => {
  const records: LogRecord[] = [
    { type: 'event', event: { type: 'compaction/done', seq: 5, data: { summary: '被压掉的原文A', reason: 'auto' } } },
    { type: 'event', event: { type: 'user/message', seq: 2, data: { content: 'hi' } } },
    { type: 'event', event: { type: 'compaction/start', seq: 3, data: { dropped: '原文B' } } },
    { type: 'event', event: { type: 'turn/end', seq: 7, data: { reason: { kind: 'stop' } } } },
  ]
  const marks = findCompactionMarks(records)
  assert.equal(marks.length, 2)
  assert.deepEqual(marks.map(mark => mark.seq), [3, 5])
  assert.equal(marks[0]?.original, '原文B')
  assert.equal(marks[1]?.original, '被压掉的原文A')
  assert.deepEqual(findCompactionMarks([]), [])
  assert.deepEqual(findCompactionMarks([{ type: 'event', event: { type: 'user/message', seq: 1, data: {} } }]), [])
})

test('markOffsets 把 seq 映射为百分比并 clamp 到 0..100', () => {
  const marks: CompactionMark[] = [
    { seq: 3, label: 'a', original: '' },
    { seq: 5, label: 'b', original: '' },
  ]
  assert.deepEqual(markOffsets(marks, 10), [30, 50])
  assert.deepEqual(markOffsets([{ seq: 20, label: 'a', original: '' }], 10), [100])
  assert.deepEqual(markOffsets([{ seq: 1, label: 'a', original: '' }], 0), [0])
})

test('normalizeFeedbackEntries 兼容数字 rating、丢弃无 target 项', () => {
  assert.deepEqual(normalizeFeedbackEntries(undefined), [])
  const entries = normalizeFeedbackEntries({ items: [
    { target: 'm1', kind: 'positive' },
    { target: 'm2', rating: 1 },
    { target: 'm3', rating: -1 },
    { target: 'm4', kind: 'weird' },
    { target: '', kind: 'positive' },
    null,
  ] })
  assert.equal(entries.length, 4)
  assert.equal(entries[0]?.kind, 'positive')
  assert.equal(entries[1]?.kind, 'positive')
  assert.equal(entries[2]?.kind, 'negative')
  assert.equal(entries[3]?.kind, 'other')
})

test('aggregateFeedback 聚合赞踩并按数量降序分组', () => {
  const summary = aggregateFeedback({ items: [
    { target: 'm1', kind: 'positive' },
    { target: 'm1', kind: 'negative' },
    { target: 'm2', rating: 1 },
    { target: 'm3', rating: -1 },
  ] })
  assert.equal(summary.total, 4)
  assert.equal(summary.positive, 2)
  assert.equal(summary.negative, 2)
  assert.equal(summary.byTarget[0]?.target, 'm1')
  assert.equal(summary.byTarget[0]?.positive, 1)
  assert.equal(summary.byTarget[0]?.negative, 1)
  assert.deepEqual(aggregateFeedback(null), { total: 0, positive: 0, negative: 0, byTarget: [] })
})

test('sessionStats / formatDuration / buildFeedbackPut 容错与构造', () => {
  const stats = sessionStats({ values: {
    sessionStats: { turns: 4, llmMs: 1500 },
    tokenUsage: { inputTokens: 100, outputTokens: 20 },
  } })
  assert.deepEqual(stats, { turns: 4, llmMs: 1500, inputTokens: 100, outputTokens: 20 })
  assert.deepEqual(sessionStats(null), { turns: 0, llmMs: 0, inputTokens: 0, outputTokens: 0 })
  assert.equal(formatDuration(0), '0ms')
  assert.equal(formatDuration(500), '500ms')
  assert.equal(formatDuration(1500), '1.5s')
  assert.equal(formatDuration(90_000), '1.5min')
  assert.deepEqual(buildFeedbackPut('sess', 'm1', true), {
    request: { agentId: 'sess', target: 'm1', kind: 'positive' },
  })
  assert.deepEqual(buildFeedbackPut('sess', 'm2', false).request['kind'], 'negative')
})
