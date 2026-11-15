#!/usr/bin/env node
/**
 * 技能投放验收：确认 harness 真的发现了我们编译出来的 skill。
 *
 * 三步：建会话（cwd 在仓库内）→ `skills/list` → 检查 ticket-flow 在列且描述正确。
 */
import { boot, stop, WORKSPACE } from '../spikes/p05-transport/lib/harness-client.mjs'
import { createTransport, login } from '../packages/harness-port/src/index.ts'

const server = await boot({ profile: 'p1' })
let failures = 0
try {
  const session = await login(server.url, 'none')
  const transport = createTransport({ ...session, onError: error => process.stdout.write(`WARN  ${String(error)}\n`) })

  const created = await transport.call('session/create', { request: { cwd: WORKSPACE } })
  process.stdout.write(`      会话 ${created?.sessionId}\n`)

  const listed = await transport.call('skills/list', { request: { sessionId: created?.sessionId } })
  const names = (listed?.skills ?? []).map(skill => skill.name)
  process.stdout.write(`      harness 看到 ${names.length} 个技能：${names.slice(0, 8).join(', ') || '(空)'}\n`)

  const mine = (listed?.skills ?? []).find(skill => skill.name === 'ticket-flow')
  if (mine === undefined) {
    failures += 1
    process.stdout.write('FAIL  skills/list 里没有 ticket-flow\n')
  } else {
    process.stdout.write(`PASS  skills/list 含 ticket-flow：${mine.description.slice(0, 40)}…\n`)
    if (typeof mine.path === 'string') process.stdout.write(`      path=${mine.path}\n`)
  }
} catch (error) {
  failures += 1
  process.stdout.write(`FAIL  ${String(error)}\n`)
} finally {
  await stop(server.child)
}
process.stdout.write(`\n${failures === 0 ? '技能投放验收通过' : `${failures} 项失败`}\n`)
process.exit(failures === 0 ? 0 : 1)
