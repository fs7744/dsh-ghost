/** B4 视图模型：统一形状、空 / 满 / 人闸分支、Overview 只显示待人处理的票。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryRepositories } from '../src/core/index.ts'
import {
  VIEW_NAMES, VIEW_BUILDERS, sampleRepo, sampleExtra, sampleViews, renderViewText,
} from '../src/app/views/index.ts'

const empty = new MemoryRepositories()
const full = sampleRepo()
const extra = sampleExtra()

test('7 个视图名与 7 个 builder 一一对应', () => {
  assert.deepEqual([...VIEW_NAMES], ['overview', 'tickets', 'records', 'threads', 'sources', 'settings', 'deploy'])
  for (const name of VIEW_NAMES) assert.equal(typeof VIEW_BUILDERS[name], 'function')
})

test('空仓储下 7 个视图都是统一形状且 rows 为空', () => {
  const blank = { sources: [], settings: {}, checks: [] }
  for (const name of VIEW_NAMES) {
    const view = VIEW_BUILDERS[name](empty, blank)
    assert.equal(view.view, name)
    assert.deepEqual(view.rows, [], `${name} 空分支应有 0 行`)
    assert.equal(view.summary.total, 0, `${name} 空分支 total 应为 0`)
    assert.ok(Array.isArray(view.actions))
  }
})

test('sampleViews 产出的 7 个视图都含 rows / summary / actions', () => {
  const views = sampleViews()
  assert.equal(Object.keys(views).length, 7)
  for (const name of VIEW_NAMES) {
    const view = views[name]
    assert.equal(view.view, name)
    assert.ok(Array.isArray(view.rows) && Array.isArray(view.actions))
    assert.equal(typeof view.summary.total, 'number')
    assert.equal(typeof view.summary.text, 'string')
  }
})

test('Overview 空分支没有待人处理的票、没有动作', () => {
  const view = VIEW_BUILDERS.overview(empty)
  assert.equal(view.summary.needsPerson, 0)
  assert.equal(view.actions.length, 0)
  assert.match(view.summary.text, /没有需要人处理的票/)
})

test('Overview 满分支只挑 person 阶段的票', () => {
  const view = VIEW_BUILDERS.overview(full)
  assert.equal(view.rows.length, 1)
  assert.equal(view.rows[0]?.id, 'overview:tk-attention')
  assert.equal(view.rows[0]?.needsPerson, true)
  assert.match(String(view.rows[0]?.cells['stage']), /person/)
})

test('Overview 遵守 ready 无 follow 直接结束票的规则', () => {
  const view = VIEW_BUILDERS.overview(full)
  assert.ok(!view.rows.some(row => row.id.includes('tk-done')), '已结束的票不该进待人处理')
  assert.equal(view.summary.ended, 1)
  assert.equal(view.summary.needsPerson, 1)
})

test('Tickets 满分支列出全部票并给出 open / ended 汇总', () => {
  const view = VIEW_BUILDERS.tickets(full)
  assert.equal(view.rows.length, 3)
  assert.equal(view.summary.open, 2)
  assert.equal(view.summary.ended, 1)
  assert.ok(view.rows.some(row => row.id === 'ticket:tk-done'))
})

test('Tickets 人闸分支：叫停 / 重试动作都要过人闸', () => {
  const view = VIEW_BUILDERS.tickets(full)
  const gated = view.actions.filter(action => action.humanGate)
  assert.ok(gated.length >= 2)
  assert.ok(gated.some(action => action.tool === 'orchestrator_route'))
  assert.ok(gated.every(action => action.label.length > 0 && action.target !== ''))
})

test('Records 满分支把决策与报告都列出来并按时间排序', () => {
  const view = VIEW_BUILDERS.records(full)
  assert.equal(view.rows.length, 4) // 1 条决策 + 3 张票的报告
  assert.equal(view.summary.decisions, 1)
  assert.equal(view.summary.reports, 3)
  const times = view.rows.map(row => String(row.cells['at']))
  assert.deepEqual(times, [...times].sort())
})

test('Threads 满分支列出订阅并给可取消的人闸动作', () => {
  const view = VIEW_BUILDERS.threads(full)
  assert.equal(view.rows.length, 1)
  assert.equal(view.summary.subscriptions, 1)
  assert.ok(view.actions.some(action => action.tool === 'orchestrator_thread_unsubscribe' && action.humanGate))
})

test('Sources 视图把默认关闭的飞书源标成 disabled', () => {
  const view = VIEW_BUILDERS.sources(full, extra)
  assert.equal(view.rows.length, 2)
  assert.equal(view.summary.enabled, 1)
  assert.equal(view.summary.disabled, 1)
  const feishu = view.rows.find(row => row.id === 'source:feishu')
  assert.equal(feishu?.cells['enabled'], false)
})

test('Deploy 视图把自检失败项标成 needsPerson 并汇总', () => {
  const view = VIEW_BUILDERS.deploy(full, extra)
  assert.equal(view.summary.failed, 1)
  assert.equal(view.summary.needsPerson, 1)
  const failedRow = view.rows.find(row => row.id === 'check:githubSecret')
  assert.equal(failedRow?.needsPerson, true)
  assert.match(renderViewText(view), /\[deploy\]/)
})
