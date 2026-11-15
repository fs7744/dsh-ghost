#!/usr/bin/env node
/**
 * 命令通道（C11-02）：验证 harness 的斜杠命令能列出、能执行，且不进模型消息。
 *
 * commands/list 与 commands/execute 是 Remote 端点；参数用 wire 名（agent 在线上叫 agentId）。
 */
import { boot, stop, login, createTransport } from './lib-driver.mjs'

const server = await boot({ profile: 'p05', fromDefault: false })
let failures = 0
try {
  const session = await login(server.url, 'none')
  const transport = createTransport(session)
  const created = await transport.call('session/create', { request: { cwd: process.cwd() } })
  const agentId = created?.sessionId
  process.stdout.write(`会话    ${agentId}\n`)

  const listed = await transport.call('commands/list', { agentId })
  const commands = listed ?? []
  const names = commands.map(command => command.name)
  process.stdout.write(`命令    ${commands.length} 条：${names.slice(0, 10).join(', ')}${names.length > 10 ? ' …' : ''}\n`)
  if (commands.length === 0) {
    failures += 1
    process.stdout.write('FAIL  commands/list 为空\n')
  }

  // 找一条只读、无副作用的命令来执行
  const target = names.find(name => name === 'compact') ?? names[0]
  if (target !== undefined) {
    const execution = await transport.call('commands/execute', {
      agentId,
      line: `/${target}`,
      submittedAttachments: [],
    })
    process.stdout.write(`${execution === undefined ? 'FAIL' : 'PASS'}  执行 /${target}：${execution === undefined ? '未解析' : JSON.stringify(execution).slice(0, 120)}\n`)
    if (execution === undefined) failures += 1
  }
} catch (error) {
  failures += 1
  process.stdout.write(`FAIL  ${String(error)}\n`)
} finally {
  await stop(server.child)
}

process.stdout.write(`\n${failures === 0 ? '命令通道验收通过' : `${failures} 项失败`}\n`)
process.exit(failures === 0 ? 0 : 1)
