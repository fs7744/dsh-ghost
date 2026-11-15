/** 剧本 × 定时：计划声明解析、宿主 timing 构造、任务列表归一化。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCreateRequest, buildPrompt, buildTiming, normalizeScheduleTasks, normalizeTime, parseScheduleLine,
} from '../src/schedule.ts'
import { parseFlow } from '../src/parse.ts'

test('时刻归一化：宿主只收 HH:mm:ss', () => {
  assert.equal(normalizeTime('09:00'), '09:00:00')
  assert.equal(normalizeTime('23:59:59'), '23:59:59')
  assert.equal(normalizeTime('24:00'), undefined)
  assert.equal(normalizeTime('9:00'), undefined)
})

test('计划声明解析：daily / weekly / cron / every', () => {
  assert.deepEqual(parseScheduleLine('daily 09:00 Asia/Shanghai'), {
    kind: 'daily', time: '09:00:00', timeZone: 'Asia/Shanghai',
  })
  assert.deepEqual(parseScheduleLine('weekly 1,3,5 08:30:00 Asia/Shanghai'), {
    kind: 'weekly', time: '08:30:00', days: '1,3,5', timeZone: 'Asia/Shanghai',
  })
  assert.deepEqual(parseScheduleLine('cron 0 9 * * 1-5 Asia/Shanghai'), {
    kind: 'cron', expression: '0 9 * * 1-5', timeZone: 'Asia/Shanghai',
  })
  assert.deepEqual(parseScheduleLine('every 3600'), { kind: 'every', seconds: 3600 })
  assert.equal(parseScheduleLine('daily 25:00'), undefined)
  assert.equal(parseScheduleLine('weekly 9 08:00'), undefined, '星期几只能是 1-7')
  assert.equal(parseScheduleLine('cron 0 9 * *'), undefined, 'cron 必须是 5 段')
})

test('timing 构造：对齐宿主的形状', () => {
  const daily = buildTiming({ kind: 'daily', time: '09:00:00', timeZone: 'Asia/Shanghai' })
  assert.deepEqual(daily, { kind: 'daily', daily: { time: '09:00:00', time_zone: 'Asia/Shanghai' } })
  const weekly = buildTiming({ kind: 'weekly', time: '08:00:00', days: '1,5', timeZone: 'UTC' })
  assert.deepEqual(weekly, { kind: 'weekly', weekly: { days: [1, 5], time: '08:00:00', time_zone: 'UTC' } })
  const cron = buildTiming({ kind: 'cron', expression: '0 9 * * *', timeZone: 'Asia/Shanghai' })
  assert.deepEqual(cron, { kind: 'cron', cron: { expression: '0 9 * * *', time_zone: 'Asia/Shanghai' } })
  assert.deepEqual(buildTiming({ kind: 'every', seconds: 60 }), { kind: 'every', every_seconds: 60 })
})

test('创建请求：带目标会话与不带（每次新建）', () => {
  const request = buildCreateRequest({
    title: 'daily-report',
    prompt: '按剧本「daily-report」执行。',
    schedule: { kind: 'daily', time: '09:00:00' },
    sessionId: 'session-x',
  })
  assert.deepEqual(request?.target, { kind: 'session', sessionId: 'session-x' })
  const fresh = buildCreateRequest({
    title: 'daily-report',
    prompt: 'p',
    schedule: { kind: 'daily', time: '09:00:00' },
  })
  assert.deepEqual(fresh?.target, { kind: 'new' })
  assert.equal(buildCreateRequest({ title: 'x', prompt: 'p', schedule: { kind: 'daily' } }), undefined)
})

test('提示词带上剧本 id 与流程路径', () => {
  assert.match(buildPrompt({ id: 'daily-report' }), /daily-report/)
  assert.match(buildPrompt({ id: 'daily-report' }, 'flows/daily-report.flow'), /flows\/daily-report\.flow/)
})

test('剧本头里写 # schedule 能被解析出来', () => {
  const flow = parseFlow([
    '# @ticket-flow v2',
    '# goal 汇总昨日数据',
    '# schedule daily 09:00:00 Asia/Shanghai',
    'open-ticket',
  ].join('\n'))
  assert.equal(flow.errors.length, 0)
  assert.equal(flow.flow.schedule, 'daily 09:00:00 Asia/Shanghai')
})

test('宿主任务列表归一化', () => {
  const rows = normalizeScheduleTasks([
    { id: 's1', kind: 'daily', title: '每日汇总', time: '09:00:00.000', timeZone: 'Asia/Shanghai', status: 'active', target: { kind: 'session', sessionId: 'session-a' } },
    { id: 's2', kind: 'cron', title: '工作日', expression: '0 9 * * 1-5', status: 'paused' },
    { kind: 'daily' },
  ])
  assert.equal(rows.length, 2)
  assert.equal(rows[0]?.when, '09:00:00.000')
  assert.equal(rows[0]?.sessionId, 'session-a')
  assert.equal(rows[1]?.when, '0 9 * * 1-5')
})
