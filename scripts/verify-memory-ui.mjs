#!/usr/bin/env node
/**
 * 记忆界面验收（C10-03）：真实宿主的 `ghostMemory/*` Remote + 界面纯逻辑。
 *
 * 判定：分组/校验逻辑正确；Remote 能列出、读取、写入、删除；总开关关闭后
 * 模型侧与界面侧都写不进去；测试条目最后被清理，不留脏数据。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { boot, stop, login, createTransport } from './lib-driver.mjs'
import { groupEntries, validEntryName } from '../apps/desktop/src/memory-view.ts'

const REPO = join(import.meta.dirname, '..')

const TEST_NAME = 'ui-verify-entry'
let failures = 0
const check = (ok, label, extra = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra === '' ? '' : `：${extra}`}\n`)
  if (!ok) failures += 1
}

// 纯逻辑
check(validEntryName('build-command') && !validEntryName('Build Command'), '名称校验与后端 gate 一致')
const groups = groupEntries([
  { name: 'b', title: 'b', updated: new Date().toISOString() },
  { name: 'a', title: 'a', updated: '2020-01-01T00:00:00.000Z' },
], new Date())
check(groups.length === 2 && groups[0]?.items[0]?.name === 'b', '分组按时间与名称排序',
  groups.map(group => group.label).join(' / '))

const server = await boot({ profile: 'p05', fromDefault: false })
let transport
try {
  transport = createTransport(await login(server.url, 'none'))
  const call = (endpoint, input) => transport.call(`ghostMemory/${endpoint}`, input === undefined ? {} : { input })

  const before = await call('list')
  const initialNames = (before?.items ?? []).map(item => item.name)
  check(Array.isArray(before?.items), 'Remote 列出记忆条目', `${initialNames.length} 条`)

  const status = await call('status')
  check(typeof status?.enabled === 'boolean', 'Remote 读到总开关', `enabled=${status?.enabled}`)

  const written = await call('write', {
    name: TEST_NAME,
    title: '界面验收临时条目',
    text: '这是一条由 verify-memory-ui 写入的临时记忆，用于验证读写删。',
    source: 'verify-memory-ui',
  })
  check(written?.outcome?.ok === true, '写入一条记忆', JSON.stringify(written?.outcome).slice(0, 110))

  const listed = await call('list')
  check((listed?.items ?? []).some(item => item.name === TEST_NAME), '新条目出现在列表里')
  const read = await call('read', { name: TEST_NAME })
  check(typeof read?.content === 'string' && read.content.includes('临时记忆'),
    '读取正文', (read?.content ?? '').slice(0, 50))

  // 总开关：关闭后界面写入被拒，打开后恢复
  const off = await call('toggle', { enabled: false })
  check(off?.enabled === false && (await call('status'))?.enabled === false, '总开关可关闭并持久化查询')
  const saved = JSON.parse(readFileSync(join(REPO, '.ghost', 'memory', 'settings.json'), 'utf8'))
  check(saved.enabled === false, '总开关状态真的落盘（重启后仍生效）')
  const blocked = await call('write', { name: 'should-not-exist', text: '不应写入', source: 'verify-memory-ui' })
  check(blocked?.outcome?.ok === false && (blocked?.outcome?.reasons ?? []).some(reason => reason.includes('关闭')),
    '关闭后写入被拒', JSON.stringify(blocked?.outcome).slice(0, 110))
  const on = await call('toggle', { enabled: true })
  check(on?.enabled === true, '总开关可重新打开')

  const removed = await call('remove', { name: TEST_NAME })
  check(removed?.removed === true, '删除条目')
  const after = await call('list')
  check(!(after?.items ?? []).some(item => item.name === TEST_NAME), '删除后列表不再含该条目')
} catch (error) {
  failures += 1
  process.stdout.write(`FAIL  ${String(error)}\n`)
} finally {
  // 清理：无论中途哪一步失败，都不把临时条目和关闭状态留给下一次验收
  try {
    await transport?.call('ghostMemory/toggle', { input: { enabled: true } })
    await transport?.call('ghostMemory/remove', { input: { name: TEST_NAME } })
  } catch { /* 宿主可能已经退出 */ }
  await stop(server.child)
}
process.stdout.write(`\n${failures === 0 ? '记忆界面验收通过' : `${failures} 项失败`}\n`)
process.exit(failures === 0 ? 0 : 1)
