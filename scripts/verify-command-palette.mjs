#!/usr/bin/env node
/**
 * 命令面板验收（C11-01）：真实宿主的 `commands/list` → 面板解析/过滤 → `commands/execute`。
 *
 * 重点验证两条：搜索与补全用的是宿主返回的**真实**命令描述符；
 * 斜杠命令执行后**不产生模型消息**（user/message 数量不变）。
 */
import { boot, stop, login, createTransport } from './lib-driver.mjs'
import {
  commandLine, filterCommands, isCommandLine, moveSelection, parseSlash, toCommandItems,
} from '../apps/desktop/src/palette.ts'

let failures = 0
const check = (ok, label, extra = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra === '' ? '' : `：${extra}`}\n`)
  if (!ok) failures += 1
}

const server = await boot({ profile: 'p05', fromDefault: false })
try {
  const transport = createTransport(await login(server.url, 'none'))
  const created = await transport.call('session/create', { request: { cwd: process.cwd() } })
  const agentId = created?.sessionId

  const raw = await transport.call('commands/list', { agentId })
  const items = toCommandItems(Array.isArray(raw) ? raw : [])
  check(items.length > 0, '从宿主拿到真实命令清单', `${items.length} 条：${items.map(item => item.name).join(', ')}`)
  check(items.every(item => typeof item.name === 'string' && item.name !== ''), '描述符归一化后名称有效')

  const all = filterCommands(items, parseSlash('/').query)
  check(all.length === items.length, '输入 / 列出全部命令', `${all.length} 条`)

  const prefix = filterCommands(items, parseSlash('/comp').query)
  check(prefix.length > 0 && prefix[0]?.name === 'compact', '前缀搜索把 compact 排第一', prefix.map(item => item.name).join(', '))
  check(filterCommands(items, 'zzzz').length === 0, '无匹配时返回空')

  const withArgs = parseSlash('/compact 保留测试结果')
  check(withArgs.active === false && withArgs.args === '保留测试结果' && withArgs.name === 'compact',
    '输入空格后进入参数阶段', JSON.stringify(withArgs))
  check(isCommandLine('/compact 保留测试结果'), '带参数的斜杠输入仍走命令通道')
  check(commandLine('compact', '保留测试结果') === '/compact 保留测试结果', '拼出可执行的命令行')
  check(moveSelection(items.length, 0, -1) === items.length - 1, '键盘上移循环到末项')

  // 执行一条只读命令，并确认它没有产生模型消息
  const page = async () => transport.call('session/page', { request: { address: { kind: 'session', sessionId: agentId }, maxMessages: 80 } })
  const userMessages = value => (value?.records ?? []).filter(record => record.event?.type === 'user/message').length
  const before = userMessages(await page())

  const target = items.find(item => item.name === 'compact') ?? items[0]
  const line = commandLine(target?.name ?? 'compact')
  const execution = await transport.call('commands/execute', { agentId, line, submittedAttachments: [] })
  check(execution !== undefined && execution !== null, `执行 ${line} 返回 settled 结果`, JSON.stringify(execution).slice(0, 130))

  const after = userMessages(await page())
  check(after === before, '命令没有产生模型消息', `user/message ${before} → ${after}`)
} catch (error) {
  failures += 1
  process.stdout.write(`FAIL  ${String(error)}\n`)
} finally {
  await stop(server.child)
}
process.stdout.write(`\n${failures === 0 ? '命令面板验收通过' : `${failures} 项失败`}\n`)
process.exit(failures === 0 ? 0 : 1)
