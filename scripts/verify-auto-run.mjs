#!/usr/bin/env node
/**
 * 自动执行验收：票建好后**不需要人推**，插件里的执行器自己把它跑完。
 *
 * 前提：宿主里有活动会话（本脚本先建一个并选好模型）。
 * 判定：票从 working/queued 变成有报告，最终按领域规则结束。
 */
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { boot, stop, login, createTransport } from './lib-driver.mjs'

const REPO = join(import.meta.dirname, '..')
const envFile = join(REPO, '.env')
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (match !== null) process.env[match[1]] ??= match[2]
  }
}
const stateFile = join(REPO, '.ghost', 'tickets.json')
rmSync(stateFile, { force: true })
rmSync(`${stateFile}.snapshot.json`, { force: true })

const server = await boot({ profile: 'p05', fromDefault: false })
let failures = 0
try {
  const transport = createTransport(await login(server.url, 'none'))
  const created = await transport.call('session/create', { request: { cwd: REPO } })
  await transport.call('session/selectModel', { request: { sessionId: created.sessionId, provider: 'wb', model: 'hy3' } })
  process.stdout.write(`会话    ${created.sessionId}\n`)

  const accepted = await transport.call('ghostTickets/accept', {
    input: { source: 'verify', threadId: 'verify/auto-1', text: '用一句话说明：这个仓库用什么包管理器？', human: true, addressed: true },
  })
  process.stdout.write(`开票    ${accepted.ticketId}\n`)

  // 等执行器把票跑完（不需要任何人工推进）
  const deadline = Date.now() + 180_000
  let detail
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2000))
    const result = await transport.call('ghostTickets/get', { input: { id: accepted.ticketId } })
    detail = result.ticket
    if (detail !== undefined && detail.assignments.some(assignment => assignment.report !== null)) break
  }

  if (detail === undefined) {
    failures += 1
    process.stdout.write('FAIL  票查不到\n')
  } else {
    const report = detail.assignments.find(assignment => assignment.report !== null)?.report
    process.stdout.write(`${report === null || report === undefined ? 'FAIL' : 'PASS'}  执行器自己跑完了：${report?.state ?? '(无报告)'}\n`)
    if (report === null || report === undefined) failures += 1
    process.stdout.write(`      报告：${(report?.summary ?? '').slice(0, 320)}\n`)
    process.stdout.write(`      阶段：${JSON.stringify(detail.stage)}\n`)
    if (report?.state !== 'ready') failures += 1
  }
} catch (error) {
  failures += 1
  process.stdout.write(`FAIL  ${String(error)}\n`)
} finally {
  await stop(server.child)
}
process.stdout.write(`\n${failures === 0 ? '自动执行验收通过' : `${failures} 项失败`}\n`)
process.exit(failures === 0 ? 0 : 1)
