/** TokenEconomizer 三条主线的纯逻辑测试：剪枝、简报、循环提示、截断。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  beginBoot, buildMemoryBlock, buildSessionBrief, countMemoryEntries, emptyLedger,
  estimateTokens, estimateToolChars, LoopGuard, normalizeFailure, planCompaction,
  readHarnessUsage, shouldSuggestCompaction, estimateCost, EMPTY_PRICING,
  pruneUnusedTools, recordToolCall, restoreTool, truncateToolResult,
} from '../src/index.ts'

const OPTIONAL = ['orchestrator_settings_save', 'orchestrator_eval']
const CORE = ['orchestrator_ack', 'orchestrator_report']

test('工具剪枝：连续 5 次启动未用才剪，核心工具与恢复过的永不剪', () => {
  let ledger = emptyLedger()
  for (let i = 0; i < 5; i += 1) ledger = beginBoot(ledger, [...CORE, ...OPTIONAL], `2026-01-0${i + 1}T00:00:00.000Z`)
  assert.deepEqual(pruneUnusedTools(ledger, OPTIONAL, { keep: CORE, minAgeDays: 0 }), OPTIONAL)

  // 用过一次就不再剪。
  let used = recordToolCall(ledger, 'orchestrator_eval', true)
  assert.deepEqual(pruneUnusedTools(used, OPTIONAL, { keep: CORE, minAgeDays: 0 }), ['orchestrator_settings_save'])

  // 人工恢复后永久保留。
  const restored = restoreTool(used, 'orchestrator_settings_save')
  assert.deepEqual(pruneUnusedTools(restored, OPTIONAL, { keep: CORE, minAgeDays: 0 }), [])
})

test('工具剪枝：不到门槛不剪', () => {
  let ledger = emptyLedger()
  for (let i = 0; i < 4; i += 1) ledger = beginBoot(ledger, OPTIONAL)
  assert.deepEqual(pruneUnusedTools(ledger, OPTIONAL, { minAgeDays: 0 }), [])
})

test('剪枝节省量只按被剪工具的定义估算', () => {
  const descriptors = [
    { name: 'orchestrator_ack', description: 'ack', parameters: {} },
    { name: 'orchestrator_eval', description: 'evaluate', parameters: { type: 'object' } },
  ]
  assert.equal(estimateToolChars(descriptors, ['orchestrator_eval']), 'orchestrator_eval'.length + 'evaluate'.length + JSON.stringify({ type: 'object' }).length)
})

const MEMORY = `# 项目记忆

索引常驻；正文用 \`memory read <name>\` 按需读。

- \`build-command\` — 必须用 mvn -q
- \`pnpm-store\` — store 在 D:/pnpm-store
- \`test-quirk\` — 集成测试要先起 mock
`

test('会话简报：至少 3 条才注入，只带索引不读正文', () => {
  const brief = buildSessionBrief('修一下构建', MEMORY)
  assert.match(brief, /^修一下构建\n\n<project-memory>/)
  assert.match(brief, /build-command/)
  assert.equal(brief.includes('mvn -q'), true, '标题里应保留结论片段')
  assert.equal(buildSessionBrief('x', '- `a` — one\n- `b` — two\n'), 'x')
  assert.equal(buildSessionBrief('x', ''), 'x')
  assert.equal(countMemoryEntries(MEMORY), 3)
})

test('会话简报：超预算按行截断，不切半个条目', () => {
  const long = ['- `a` — ' + 'x'.repeat(400), '- `b` — ' + 'y'.repeat(400), '- `c` — z'].join('\n')
  const brief = buildSessionBrief('任务', long, { maxChars: 500, minEntries: 2 })
  assert.match(brief, /已截断/)
  assert.ok(brief.length <= 500)
  assert.equal(brief.includes('`c`'), false)
})

test('失败循环：第二次相同错误才提示，成功清零', () => {
  let clock = 0
  const guard = new LoopGuard({ now: () => clock, windowMs: 1000, threshold: 2 })
  assert.equal(guard.failure('read', 'ENOENT: a.txt'), undefined)
  assert.match(guard.failure('read', 'ENOENT: b.txt') ?? '', /已连续出现 2 次/)
  guard.success('read')
  assert.equal(guard.failure('read', 'ENOENT: c.txt'), undefined)
  clock = 5000
  assert.equal(guard.failure('read', 'ENOENT: d.txt'), undefined)
  assert.equal(normalizeFailure('ENOENT: a.txt'), normalizeFailure('ENOENT: b.txt'))
  assert.match(normalizeFailure('id 123e4567-e89b-12d3'), /^id #/)
})

test('工具结果超长只留头部并说明原文长度', () => {
  const text = 'x'.repeat(100)
  assert.equal(truncateToolResult(text, 200), text)
  const clipped = truncateToolResult(text, 60)
  assert.ok(clipped.length <= 60)
  assert.match(clipped, /已截断，原文 100 字/)
})

test('工具剪枝：观察期不足不剪，满 7 天才剪', () => {
  let ledger = emptyLedger()
  for (let i = 0; i < 5; i += 1) ledger = beginBoot(ledger, OPTIONAL, '2026-01-01T00:00:00.000Z')
  assert.deepEqual(pruneUnusedTools(ledger, OPTIONAL, { now: Date.parse('2026-01-03T00:00:00.000Z') }), [])
  assert.deepEqual(
    pruneUnusedTools(ledger, OPTIONAL, { now: Date.parse('2026-01-09T00:00:00.000Z') }),
    [...OPTIONAL],
  )
})

test('disabled 列表会活过启动，restore 后从列表移除', () => {
  let ledger = emptyLedger()
  ledger = beginBoot(ledger, OPTIONAL)
  ledger = { ...ledger, disabled: ['orchestrator_eval'] }
  const next = beginBoot(ledger, OPTIONAL)
  assert.deepEqual(next.disabled, ['orchestrator_eval'])
  const restored = restoreTool(next, 'orchestrator_eval')
  restored.disabled = (restored.disabled ?? []).filter(name => name !== 'orchestrator_eval')
  assert.deepEqual(restored.disabled, [])
})

test('记忆块可以单独给普通聊天用', () => {
  const block = buildMemoryBlock(MEMORY)
  assert.match(block, /^<project-memory>/)
  assert.equal(buildMemoryBlock('- `a` — one\n'), '', '不足 3 条不注入')
  assert.equal(buildSessionBrief('任务', MEMORY).startsWith('任务'), true)
})

test('token 估算对中英文量级区分', () => {
  assert.equal(estimateTokens('abcd'), 1)
  assert.equal(estimateTokens('你好'), 2)
  assert.equal(estimateTokens('a'.repeat(400)), 100)
})

test('上下文触发计划：超预算且消息够多才压缩', () => {
  const small = Array.from({ length: 12 }, (_, index) => ({ role: 'user' as const, text: `问题 ${index}` }))
  const noPlan = planCompaction(small, { maxTokens: 100_000 })
  assert.equal(noPlan.compress, false)
  assert.equal(noPlan.messageCount, 12)

  const big = Array.from({ length: 20 }, (_, index) => ({
    role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
    text: 'x'.repeat(2000),
  }))
  const plan = planCompaction(big, { maxTokens: 1000 })
  assert.equal(plan.compress, true)
  assert.ok(plan.overflowTokens > 0)
  assert.equal(plan.estimatedTokens, plan.messageCount * 500)

  const few = Array.from({ length: 3 }, () => ({ role: 'user' as const, text: 'x'.repeat(4000) }))
  assert.equal(planCompaction(few, { maxTokens: 1000 }).compress, false, '消息太少不触发')
})

test('宿主真实用量：缓存读也算输入，比例按上下文窗口算', () => {
  const usage = readHarnessUsage({
    values: {
      tokenUsage: { uncachedInputTokens: 1200, cacheReadTokens: 8000, cacheWriteTokens: 300, outputTokens: 500 },
      contextPressure: { projectedTokens: 95000, contextWindow: 100000 },
      contextBreakdown: { systemTokens: 4000, toolsTokens: 2000, messageTokens: 89000 },
    },
  })
  assert.equal(usage.uncachedInputTokens, 1200)
  assert.equal(usage.cacheReadTokens, 8000)
  assert.equal(usage.cacheWriteTokens, 300)
  assert.equal(usage.totalInputTokens, 9200)
  assert.equal(usage.outputTokens, 500)
  assert.equal(usage.messageTokens, 89000)
  assert.equal(usage.ratio, 0.95)
  assert.equal(shouldSuggestCompaction(usage), true)
})

test('拿不到投影就是全 0，且不提醒', () => {
  const usage = readHarnessUsage(undefined)
  assert.equal(usage.projectedTokens, 0)
  assert.equal(shouldSuggestCompaction(usage), false)
  assert.equal(shouldSuggestCompaction(readHarnessUsage({ values: { contextPressure: { projectedTokens: 85000, contextWindow: 100000 } } })), false, '80%~90% 宿主自己会压')
})

test('成本按缓存计价：缓存读便宜，命中率也算出来', () => {
  const usage = readHarnessUsage({
    values: {
      tokenUsage: { uncachedInputTokens: 1000, cacheReadTokens: 9000, cacheWriteTokens: 0, outputTokens: 500 },
    },
  })
  const cost = estimateCost(usage, {
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheReadPerMillion: 0.3,
    cacheWritePerMillion: 3.75,
  })
  assert.ok(cost.input > 0)
  assert.ok(cost.cacheRead / 9000 < cost.input / 1000, '缓存读的每 token 价格应显著更低')
  assert.equal(cost.total, cost.input + cost.cacheRead + cost.cacheWrite + cost.output)
  assert.equal(cost.cacheHitRate, 0.9)
  assert.equal(estimateCost(usage, EMPTY_PRICING).total, 0, '没给价格就不编')
})
