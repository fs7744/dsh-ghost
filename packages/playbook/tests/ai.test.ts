/**
 * test:playbook-ai —— C9-05 diff / C9-06 生成 / C9-07 局部重写 / C9-08 试跑。
 * 全部走 node:test + 纯函数，不碰 DOM、网络、文件系统（除了读一个示例做基准）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  diffFlows, diffFlowTexts, formatDiff, generateFlow, parseFlow, rewriteFlow,
  tryRun, validate,
  type FlowGenerator, type FlowRewriter,
} from '../src/index.ts'

const base = '# @demo v1\n# goal 完成交付\na\nb : fail -> a (max 2)\nc\n'
const flowOf = (text: string) => parseFlow(text).flow

test('C9-05 diff：新增/删除节点都进条目，且文本 diff 有 +/- 行', () => {
  const added = diffFlows(base, `${base}d\n`)
  assert.ok(added.entries.some(entry => entry.category === 'node' && entry.change === 'added' && entry.node === 'd'))
  assert.equal(added.summary.added >= 1, true)
  assert.ok(formatDiff(added).some(line => line.startsWith('+d')))

  const removed = diffFlows(base, '# @demo v1\n# goal 完成交付\na\nb : fail -> a (max 2)\n')
  assert.ok(removed.entries.some(entry => entry.category === 'node' && entry.change === 'removed' && entry.node === 'c'))
  assert.ok(formatDiff(removed).some(line => line.startsWith('-c')))
})

test('C9-05 diff：改条件边与头信息都带 before/after', () => {
  const changed = diffFlows(base, '# @demo v1\n# goal 交付完成\na\nb : fail -> a (max 3)\nc\n')
  const edge = changed.entries.find(entry => entry.category === 'edge' && entry.change === 'changed')
  assert.ok(edge !== undefined)
  assert.match(edge.before ?? '', /max 2/)
  assert.match(edge.after ?? '', /max 3/)
  const meta = changed.entries.find(entry => entry.category === 'meta' && entry.field === 'goal')
  assert.ok(meta !== undefined)
  assert.equal(meta.before, '完成交付')
  assert.equal(meta.after, '交付完成')
})

test('C9-05 diff：同一文本往返无改动，且结果确定性', () => {
  const same = diffFlowTexts(flowOf(base), flowOf(base))
  assert.deepEqual(same.entries, [])
  assert.deepEqual(same.summary, { added: 0, removed: 0, changed: 0 })
  assert.ok(same.lines.every(line => line.sign === ' '))
  assert.deepEqual(diffFlows(base, base).entries, diffFlows(base, base).entries)
})

test('C9-06 生成：默认模板产物过 parseFlow + validate', () => {
  const result = generateFlow({ prompt: '收到 issue 后验证再回复', goal: '产出可审阅结果' })
  assert.deepEqual(parseFlow(result.text).errors, [])
  assert.deepEqual(validate(result.flow), [])
  assert.deepEqual(result.errors, [])
  assert.ok(result.flow.nodes.length >= 6)
  assert.match(result.flow.goal ?? '', /可审阅/)
})

test('C9-06 生成：确定性且关键词会定制节点（无需模型、无需 key）', () => {
  const a = generateFlow({ prompt: '普通流程' }).text
  const b = generateFlow({ prompt: '普通流程' }).text
  assert.equal(a, b)
  const plain = generateFlow({ prompt: '普通流程' }).flow.nodes.length
  const deployed = generateFlow({ prompt: '需要部署发布 deploy 到线上' }).flow.nodes.length
  assert.ok(deployed > plain, `带 deploy 关键词应多一个步骤：${plain} -> ${deployed}`)
})

test('C9-06 生成：非法产物（缺 goal / 悬空跳转）即报错', () => {
  const bad: FlowGenerator = { generate: () => '# @x v1\na : fail -> ghost\nb\n' }
  assert.throws(() => generateFlow({ prompt: 'x' }, bad), /校验/)
  const noGoal: FlowGenerator = { generate: () => '# @x v1\na\nb\n' }
  assert.throws(() => generateFlow({ prompt: 'x' }, noGoal), /校验/)
})

test('C9-07 局部重写：只改选中节点，其它节点 id/顺序/边全部保留', () => {
  const before = flowOf(base)
  const result = rewriteFlow({ text: base, instruction: '把 b 改成人闸审批', selection: { node: 'b' } })
  assert.deepEqual(validate(result.flow), [])
  assert.deepEqual(result.flow.nodes.map(node => node.name), ['a', 'b', 'c'])
  assert.equal(result.flow.nodes[1]?.kind, 'gate')
  assert.equal(result.flow.nodes[0]?.kind, before.nodes[0]?.kind)
  assert.deepEqual(result.flow.nodes[2]?.edges, before.nodes[2]?.edges)
  assert.equal(result.flow.nodes[1]?.edges[0]?.max, 2, '选中节点原有的回边上限要保留')
})

test('C9-07 局部重写：越界改动/非法产物都被拒', () => {
  const invasive: FlowRewriter = { rewrite: () => '# @demo v1\n# goal 完成交付\na\nnew-one\nc\n' }
  assert.throws(
    () => rewriteFlow({ text: base, instruction: '改一下', selection: { node: 'b' } }, invasive),
    /局部重写/,
  )
  const illegal: FlowRewriter = { rewrite: () => '这不是剧本' }
  assert.throws(
    () => rewriteFlow({ text: base, instruction: '改一下', selection: { node: 'b' } }, illegal),
    /校验/,
  )
})

test('C9-08 试跑：顺序走到终点，撞上人闸立刻停下', () => {
  const linear = flowOf('# @demo v1\n# goal g\na\nb\nc\n')
  const toEnd = tryRun(linear, { from: 'a' })
  assert.equal(toEnd.reason, 'end')
  assert.deepEqual(toEnd.steps.map(step => step.node), ['a', 'b', 'c'])

  const gated = flowOf('# @demo v1\n# goal g\na\n?review\nb\n')
  const atGate = tryRun(gated, { from: 'a' })
  assert.equal(atGate.reason, 'gate')
  assert.deepEqual(atGate.steps.map(step => step.node), ['a', 'review'])
})

test('C9-08 试跑：单条回边超过它声明的 max 即判环', () => {
  const loop = flowOf('# @demo v1\n# goal g\na : retry -> a (max 2)\nb\n')
  const result = tryRun(loop, { from: 'a', picks: { a: 'retry' }, maxBacktracks: 20 })
  assert.equal(result.reason, 'cycle')
  assert.match(result.message, /max 2/)
  assert.ok(result.backtracks >= 2)
})

test('C9-08 试跑：无 max 的回边靠全局回退上限兜底', () => {
  const loop = flowOf('# @demo v1\n# goal g\na : retry -> a\nb\n')
  const result = tryRun(loop, { from: 'a', picks: { a: 'retry' }, maxBacktracks: 2, maxSteps: 50 })
  assert.equal(result.reason, 'back-limit')
  assert.match(result.message, /上限 2/)

  const capped = tryRun(loop, { from: 'a', picks: { a: 'retry' }, maxSteps: 3, maxBacktracks: 100 })
  assert.equal(capped.reason, 'max-steps')
})

test('C9-08 试跑：起点不存在 / 悬空目标 / 条件边选择都能判定', () => {
  const linear = flowOf('# @demo v1\n# goal g\na\nb\nc\n')
  assert.equal(tryRun(linear, { from: 'zzz' }).reason, 'no-start')
  const dangling = flowOf('# @demo v1\n# goal g\na : go -> ghost\nb\n')
  assert.equal(tryRun(dangling, { from: 'a', picks: { a: 'go' } }).reason, 'dangling')
  const conditional = flowOf('# @demo v1\n# goal g\na : skip -> c\nb\nc\n')
  const hop = tryRun(conditional, { from: 'a', picks: { a: 'skip' } })
  assert.equal(hop.reason, 'end')
  assert.deepEqual(hop.steps.map(step => step.node), ['a', 'c'])
  assert.equal(hop.steps[1]?.via, 'condition')
})
