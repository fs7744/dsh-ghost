#!/usr/bin/env node
/**
 * 常驻编排验收：真实模型自己调用 `ghost_ticket` 开一张票。
 *
 * 判定：插件状态文件出现一张票，且会话里能看到 tool/call 记录。
 * 这是"引擎常驻在宿主里"的第一手证据。
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

let server = await boot({ profile: 'p05', fromDefault: false })
let second
let failures = 0
try {
  const transport = createTransport(await login(server.url, 'answer'))
  const created = await transport.call('session/create', { request: { cwd: REPO } })
  await transport.call('session/selectModel', { request: { sessionId: created.sessionId, provider: 'wb', model: 'hy3' } })
  process.stdout.write(`会话    ${created.sessionId}\n`)

  await transport.call('session/prompt', {
    request: {
      requestId: `ticket-${Date.now()}`,
      sessionId: created.sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: '请用 ghost_ticket 工具开一张票：检查 README 是否有过期段落。只开票，然后告诉我票号。' }],
    },
  })
  process.stdout.write('prompt  已投递\n')

  const deadline = Date.now() + 150_000
  let state
  while (Date.now() < deadline) {
    if (existsSync(stateFile)) {
      state = JSON.parse(readFileSync(stateFile, 'utf8'))
      if ((state.tickets ?? []).length > 0) break
    }
    await new Promise(r => setTimeout(r, 1500))
  }

  if (state === undefined || (state.tickets ?? []).length === 0) {
    failures += 1
    process.stdout.write('FAIL  插件没有开出票（状态文件为空）\n')
  } else {
    const ticket = state.tickets[0]
    process.stdout.write(`PASS  常驻引擎开出票：${ticket.id.slice(0, 8)} · ${ticket.title} · ${JSON.stringify(ticket.stage)}\n`)
  }

  // 持久化验收：重启一次宿主，票应当还在
  await stop(server.child)
  second = await boot({ profile: 'p05', fromDefault: false })
  const transport2 = createTransport(await login(second.url, 'none'))
  await new Promise(r => setTimeout(r, 2000))
  const after = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : { tickets: [] }
  process.stdout.write(`${after.tickets.length > 0 ? 'PASS' : 'FAIL'}  重启后票仍在：${after.tickets.length} 张\n`)
  if (after.tickets.length === 0) failures += 1

  // 用重启后的客户端读会话日志（harness 的会话是持久化的）
  const page = await transport2.call('session/page', { request: { address: { kind: 'session', sessionId: created.sessionId }, maxMessages: 80 } })
  const calls = (page.records ?? []).filter(record => record.event?.type === 'tool/call').map(record => record.event.data.name)
  process.stdout.write(`${calls.includes('ghost_ticket') ? 'PASS' : 'FAIL'}  会话里出现 tool/call：${calls.join(', ') || '(无)'}\n`)
  if (!calls.includes('ghost_ticket')) failures += 1
} catch (error) {
  failures += 1
  process.stdout.write(`FAIL  ${String(error)}\n`)
} finally {
  if (server.child.exitCode === null) await stop(server.child)
  if (typeof second !== 'undefined' && second.child.exitCode === null) await stop(second.child)
}
process.stdout.write(`\n${failures === 0 ? '常驻编排验收通过' : `${failures} 项失败`}\n`)
process.exit(failures === 0 ? 0 : 1)
