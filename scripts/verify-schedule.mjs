#!/usr/bin/env node
/**
 * 剧本 × 定时 验收（真实宿主）：
 *  1. 剧本头里的 `# schedule` 能解析成计划；
 *  2. 计划能建成宿主定时（持久化、时区、目标会话都是宿主的）；
 *  3. 「立即运行」能把提示词投递到目标会话——这就是定时到点时发生的事。
 */
import { join } from 'node:path'
import { boot, stop, login, createTransport } from './lib-driver.mjs'
import { buildCreateRequest, buildPrompt, parseFlow } from '../packages/playbook/lib/index.js'
import { parseScheduleLine } from '../packages/playbook/lib/schedule.js'

const REPO = process.cwd()
let failures = 0
const check = (ok, message) => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${message}\n`)
  if (!ok) failures += 1
}

const flowText = [
  '# @daily-report',
  '# goal 汇总昨日数据',
  '# schedule daily 09:00:00 Asia/Shanghai',
  'open-ticket',
  'close-ticket',
].join('\n')

const flow = parseFlow(flowText)
check(flow.errors.length === 0, '剧本能解析')
check(flow.flow.schedule !== undefined, `剧本头里的计划被读到：${flow.flow.schedule ?? '无'}`)

const schedule = parseScheduleLine(flow.flow.schedule ?? '')
check(schedule !== undefined, `计划能解析成结构：${JSON.stringify(schedule)}`)

let server
let scheduleId = ''
try {
  server = await boot({ profile: 'p05', fromDefault: false })
  const session = await login(server.url, 'none')
  const transport = createTransport({ ...session, onError: error => process.stdout.write(`WARN  ${String(error)}\n`) })
  const created = await transport.call('session/create', { request: { cwd: join(REPO, 'spikes', 'p05-transport', '.workspace') } })
  const sessionId = created?.sessionId ?? ''

  const request = buildCreateRequest({
    title: flow.flow.id,
    prompt: buildPrompt(flow.flow, 'flows/daily-report.flow'),
    schedule,
    sessionId,
  })
  const made = await transport.call('schedule/create', { request }).catch(error => ({ error: String(error) }))
  check(made?.error === undefined, `定时建成：${made?.id ?? JSON.stringify(made).slice(0, 160)}`)
  scheduleId = made?.id ?? ''

  const listed = await transport.call('schedule/list', { request: {} })
  const items = Array.isArray(listed?.items) ? listed.items : []
  const found = items.find(item => item.id === scheduleId)
  check(found !== undefined, '定时出现在宿主列表里（持久化在宿主）')
  check(found?.timeZone === 'Asia/Shanghai', `时区按剧本声明：${found?.timeZone ?? '无'}`)
  check(found?.target?.sessionId === sessionId, '目标是指定会话')

  const ran = await transport.call('schedule/run', { request: { id: scheduleId } }).catch(error => ({ error: String(error) }))
  check(ran?.error === undefined, '立即运行成功（等价于到点触发）')

  await new Promise(resolve => setTimeout(resolve, 1500))
  const page = await transport.call('session/page', {
    request: { address: { kind: 'session', sessionId }, maxMessages: 30 },
  })
  const records = Array.isArray(page?.records) ? page.records : []
  const delivered = records.some(record => JSON.stringify(record).includes('daily-report'))
  check(delivered, '提示词真的投到了目标会话（agent 会按剧本执行）')

  await transport.call('schedule/edit', { request: { id: scheduleId, action: 'delete' } }).catch(() => undefined)
} catch (error) {
  check(false, `验收出错：${String(error).slice(0, 300)}`)
} finally {
  if (server !== undefined) await stop(server.child)
}

process.stdout.write(`\n${failures === 0 ? '剧本定时验收通过' : `${failures} 项失败`}\n`)
process.exit(failures === 0 ? 0 : 1)
