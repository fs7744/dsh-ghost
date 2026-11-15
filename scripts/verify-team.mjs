#!/usr/bin/env node
/**
 * 多 agent 验收（真实宿主）：
 *  1. 团队模式能通过 Remote 开关，并且**投影里能看到**（界面读的就是投影）；
 *  2. 投影里有子 agent 目录 / 团队任务 / 权限档位这些字段（界面要显示它们）。
 */
import { join } from 'node:path'
import { boot, stop, login, createTransport } from './lib-driver.mjs'

const REPO = process.cwd()
let failures = 0
const check = (ok, message) => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${message}\n`)
  if (!ok) failures += 1
}

let server
try {
  server = await boot({ profile: 'p05', fromDefault: false })
  const session = await login(server.url, 'none')
  const transport = createTransport({ ...session, onError: error => process.stdout.write(`WARN  ${String(error)}\n`) })
  const created = await transport.call('session/create', { request: { cwd: join(REPO, 'spikes', 'p05-transport', '.workspace') } })
  const agentId = created?.sessionId ?? ''

  const readTeam = async () => {
    const proj = await transport.call('session/projections', { request: { sessionId: agentId } })
    return proj?.values ?? {}
  }

  const before = await readTeam()
  check(before.agentTeam !== undefined, '投影里有 agentTeam 段（界面读它）')
  check(before.agentTeam?.enabled === false, '初始团队模式是关的')

  await transport.call('agentTeams/setEnabled', { agentId, enabled: true })
  const after = await readTeam()
  check(after.agentTeam?.enabled === true, '开关生效：投影里的 agentTeam.enabled 变成 true')

  await transport.call('agentTeams/setEnabled', { agentId, enabled: false })
  const back = await readTeam()
  check(back.agentTeam?.enabled === false, '也能关回去')

  check('subagentCatalog' in before, '投影里有子 agent 目录字段')
  check(Array.isArray(before.agentTeam?.tasks), '投影里有团队任务列表')
  check(typeof before.permissions?.currentValue === 'string', `投影里有权限档位：${before.permissions?.currentValue ?? '无'}`)
} catch (error) {
  check(false, `验收出错：${String(error).slice(0, 300)}`)
} finally {
  if (server !== undefined) await stop(server.child)
}

process.stdout.write(`\n${failures === 0 ? '多 agent 验收通过' : `${failures} 项失败`}\n`)
process.exit(failures === 0 ? 0 : 1)
