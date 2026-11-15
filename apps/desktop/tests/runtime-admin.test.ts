/**
 * 运行时 / 管理 / Superagent 面板纯逻辑单测（test:panels 的一部分）。
 * 覆盖：归一化空/畸形响应、状态计算与排序、权限开关、待人处理筛选与分组。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  collabRows, genericRows, goalTone, jobTone, normalizeGoals, normalizeJobs, normalizePlan,
  normalizeSkills, normalizeTerminals, planFromProjections, sortJobs, sortSkills, toneLabel,
} from '../src/runtime-panels.ts'
import {
  canToggleBundle, countEnabled, normalizeBundles, normalizeMarket, normalizeMcp,
  normalizePlugins, normalizeProviders, normalizeSettings, sortByName,
} from '../src/admin-panels.ts'
import {
  groupByStage, needsPerson, normalizeWorkItems, selectNeedsPerson, strategySummary,
} from '../src/superagent-panel.ts'

// toneLabel 只用 services.t，用一个最小替身即可。
const translator = { t: (key: string): string => key } as never

test('genericRows 丢弃空壳与畸形项，从多种字段挑 id/name/state/detail', () => {
  assert.deepEqual(genericRows(undefined), [])
  assert.deepEqual(genericRows({ nope: 1 }), [])
  const rows = genericRows([
    { id: 'a', title: '任务', status: 'ok', summary: '说明' },
    null,
    'garbage',
    {},
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.name, '任务')
  assert.equal(rows[0]?.state, 'ok')
  assert.equal(rows[0]?.detail, '说明')
})

test('jobTone 把任意状态归一到四种色调', () => {
  assert.equal(jobTone('RUNNING'), 'running')
  assert.equal(jobTone('queued'), 'running')
  assert.equal(jobTone('failed'), 'failed')
  assert.equal(jobTone('killed'), 'failed')
  assert.equal(jobTone('completed'), 'done')
  assert.equal(jobTone(''), 'idle')
  assert.equal(toneLabel('running', translator), 'runtime.running')
  assert.equal(toneLabel('done', translator), 'runtime.done')
})

test('normalizeJobs + sortJobs：运行中优先，失败/空闲/已完成随后', () => {
  const jobs = sortJobs(normalizeJobs({ jobs: [
    { id: 'j1', state: 'done' },
    { id: 'j2', state: 'running' },
    { id: 'j3', state: 'failed' },
    { id: 'j4', state: 'idle' },
  ] }))
  assert.deepEqual(jobs.map(job => job.state), ['running', 'failed', 'idle', 'done'])
  assert.deepEqual(normalizeJobs(null), [])
})

test('normalizeSkills + sortSkills 按名称升序', () => {
  const skills = sortSkills(normalizeSkills({ skills: [
    { name: 'zeta', description: 'Z' },
    { name: 'alpha', description: 'A' },
    { name: '' },
  ] }))
  assert.deepEqual(skills.map(skill => skill.name), ['alpha', 'zeta'])
  assert.equal(skills[0]?.description, 'A')
  assert.deepEqual(normalizeSkills(undefined), [])
})

test('normalizeTerminals 与 goalTone 复用通用归一化', () => {
  const terminals = normalizeTerminals([{ id: 't1', title: 'bash', status: 'running' }])
  assert.equal(terminals.length, 1)
  assert.equal(terminals[0]?.name, 'bash')
  assert.equal(goalTone('active'), 'running')
  assert.equal(goalTone('paused'), 'idle')
})

test('normalizeGoals 兼容单对象 {goal:...} 形态', () => {
  const goals = normalizeGoals({ goal: { id: 'g1', title: '目标一', state: 'running' } })
  assert.equal(goals.length, 1)
  assert.equal(goals[0]?.tone, 'running')
  assert.equal(goals[0]?.name, '目标一')
})

test('planFromProjections + normalizePlan 挖步骤并计算 done', () => {
  const raw = planFromProjections({ values: { todo: { items: [
    { id: 's1', text: '第一步', status: 'done' },
    { id: 's2', text: '第二步', state: 'pending' },
    { text: '第三步', done: true },
  ] } } })
  const steps = normalizePlan(raw)
  assert.equal(steps.length, 3)
  assert.equal(steps[0]?.done, true)
  assert.equal(steps[1]?.done, false)
  assert.equal(steps[2]?.done, true)
  assert.deepEqual(planFromProjections(null), [])
  assert.deepEqual(normalizePlan([{ noText: 1 }]), [])
})

test('collabRows 合并子代理与团队两个来源', () => {
  const rows = collabRows({ values: {
    subagents: [{ id: 'a1', name: 'worker-1', state: 'running' }],
    agentTeam: [{ id: 't1', name: 'team-a' }],
  } })
  assert.equal(rows.length, 2)
  assert.ok(rows.some(row => row.name.includes('子代理')), '带子代理前缀')
  assert.ok(rows.some(row => row.name.includes('团队')), '带团队前缀')
  assert.deepEqual(collabRows({ values: {} }), [])
})

test('normalizeBundles 权限开关：默认启用、显式停用、内置不可切换', () => {
  const bundles = normalizeBundles({ bundles: [
    { name: 'alpha' },
    { name: 'beta', enabled: false },
    { name: 'core', builtin: true },
    { name: '', enabled: true },
  ] })
  assert.equal(bundles.length, 3)
  assert.equal(bundles.find(row => row.name === 'alpha')?.enabled, true)
  assert.equal(bundles.find(row => row.name === 'beta')?.enabled, false)
  assert.equal(countEnabled(bundles), 2)
  assert.equal(canToggleBundle(bundles.find(row => row.name === 'core')!), false)
  assert.equal(canToggleBundle(bundles.find(row => row.name === 'alpha')!), true)
  assert.deepEqual(normalizeBundles(null), [])
})

test('normalizeProviders / normalizeMcp / normalizePlugins 空与畸形安全', () => {
  const providers = normalizeProviders({ providers: [
    { name: 'wb', models: [{ id: 'a' }, { id: 'b' }] },
    { id: 'local' },
  ] })
  assert.deepEqual(providers.map(row => row.name), ['local', 'wb'])
  assert.equal(providers.find(row => row.name === 'wb')?.models, 2)
  const mcp = normalizeMcp([{ name: 'fs', state: 'online', tools: [1, 2] }])
  assert.equal(mcp[0]?.tools, 2)
  assert.deepEqual(normalizeMcp(undefined), [])
  const plugins = normalizePlugins([{ id: 'p1', name: 'P1', enabled: false }])
  assert.equal(plugins[0]?.enabled, false)
  assert.deepEqual(normalizePlugins(null), [])
})

test('normalizeSettings 兼容纯键值 map 并按 key 排序', () => {
  const settings = normalizeSettings({ revision: 3, theme: 'dark', lang: 'zh' })
  assert.deepEqual(settings.map(row => row.key), ['lang', 'theme'])
  assert.equal(settings.find(row => row.key === 'theme')?.value, 'dark')
  assert.deepEqual(normalizeSettings(undefined), [])
})

test('normalizeMarket + sortByName 按名称排序', () => {
  const market = normalizeMarket({ results: [
    { name: 'zeta', version: '2.0' },
    { name: 'alpha', description: 'A' },
  ] })
  assert.deepEqual(market.map(row => row.name), ['alpha', 'zeta'])
  assert.deepEqual(sortByName([{ name: 'b' }, { name: 'a' }]).map(row => row.name), ['a', 'b'])
})

test('normalizeWorkItems / needsPerson / groupByStage / strategySummary', () => {
  const items = normalizeWorkItems({ tickets: [
    { id: 't1', title: '修 bug', stage: { stage: 'person', action: 'ask' } },
    { id: 't2', title: '跑测试', stage: { stage: 'working' } },
    { id: 't3', title: '完成', stage: { stage: 'ended' } },
    { id: 't4', title: '其它', stage: 'mystery' },
  ] })
  assert.equal(items.length, 4)
  assert.equal(needsPerson(items[0]!), true)
  assert.equal(needsPerson(items[1]!), false)
  assert.equal(selectNeedsPerson(items).length, 1)
  const groups = groupByStage(items)
  assert.deepEqual(groups.map(group => group.key), ['person', 'working', 'ended', 'other'])
  assert.match(strategySummary(items, (key: string) => key), /superagent.needsPerson: 1/)
  assert.deepEqual(normalizeWorkItems(undefined), [])
})
