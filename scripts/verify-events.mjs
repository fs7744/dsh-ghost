#!/usr/bin/env node
/**
 * 事件契约漂移校验（PLAN §5.1 / REVIEW R1）。
 *
 * 把运行时 harness 里的 `API_REMOTE_FORWARDED_EVENTS` 与仓库里已生成的
 * `harness-contract/events.json` 逐项比对；harness 升级后加/删/改事件都会在这里报出来，
 * 而不是等界面订阅失效才发现。同时钉住我们 UI 实际依赖的几个事件仍在白名单里。
 *
 * 只做只读扫描，不启动宿主；失败 exit 1。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readDeclaredEvents } from '../harness-contract/gen-events.mjs'

const REPO = join(import.meta.dirname, '..')
const FILE = join(REPO, 'harness-contract', 'events.json')
/** 界面与插件实际订阅/依赖的事件；任一消失都算破坏性变更。 */
const REQUIRED = ['api-session/added', 'api-session/activity', 'approval/request', 'user-questions/request', 'commands/change']

let failures = 0
const check = (ok, label, extra = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra === '' ? '' : `：${extra}`}\n`)
  if (!ok) failures += 1
}

try {
  if (!existsSync(FILE)) throw new Error('events.json 不存在，先跑 npm run gen:events')
  const saved = JSON.parse(readFileSync(FILE, 'utf8'))
  const current = await readDeclaredEvents()

  check(Array.isArray(saved.events) && saved.schema === 1, 'events.json 结构合法')
  check(saved.count === saved.events?.length, '计数与条目数一致', `${saved.count} / ${saved.events?.length ?? 0}`)
  check(saved.harness !== 'unknown', '记录了 harness 版本', saved.harness)

  const byName = new Map(saved.events.map(item => [item.event, item]))
  const currentNames = new Set(current.map(item => item.event))
  const added = current.filter(item => !byName.has(item.event)).map(item => item.event)
  const removed = [...byName.keys()].filter(name => !currentNames.has(name))
  const changed = current.filter(item => {
    const old = byName.get(item.event)
    return old !== undefined && (old.mode !== item.mode || JSON.stringify(old.resources) !== JSON.stringify(item.resources))
  }).map(item => item.event)
  check(added.length === 0 && removed.length === 0 && changed.length === 0,
    '事件清单与运行时一致（无漂移）',
    `新增 ${added.join(',') || '0'} / 移除 ${removed.join(',') || '0'} / 变更 ${changed.join(',') || '0'}`)

  const missing = REQUIRED.filter(name => !currentNames.has(name))
  check(missing.length === 0, '界面依赖的事件仍在白名单里', missing.length === 0 ? REQUIRED.join(', ') : `缺少 ${missing.join(', ')}`)
  const waterfall = current.filter(item => item.mode === 'waterfall').map(item => item.event)
  check(waterfall.includes('approval/request'), '审批仍是 waterfall（需应答而非广播）', waterfall.join(', '))
} catch (error) {
  failures += 1
  process.stdout.write(`FAIL  ${String(error)}\n`)
}

process.stdout.write(`\n${failures === 0 ? '事件契约校验通过' : `${failures} 项失败`}\n`)
process.exit(failures === 0 ? 0 : 1)
