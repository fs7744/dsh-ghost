#!/usr/bin/env node
/**
 * 会话导出验收（C11-06）：真实宿主的 `session/page` → 视图模型 → Markdown / JSONL → 落盘。
 *
 * 判定：JSONL 一条不丢（行数 == 记录数且每行可解析）、Markdown 与界面视图一致、
 * 命令执行记录（不进模型消息）也能在导出里看见。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { boot, stop, login, createTransport } from './lib-driver.mjs'
import { toBubbles } from '../apps/desktop/src/session-log.ts'
import { exportFilename, exportJsonl, exportMarkdown } from '../apps/desktop/src/export.ts'

const REPO = join(import.meta.dirname, '..')
const OUT = join(REPO, 'out', 'session-export')
let failures = 0
const check = (ok, label, extra = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra === '' ? '' : `：${extra}`}\n`)
  if (!ok) failures += 1
}

const server = await boot({ profile: 'p05', fromDefault: false })
try {
  const transport = createTransport(await login(server.url, 'none'))
  const created = await transport.call('session/create', { request: { cwd: REPO } })
  const sessionId = created?.sessionId

  // 造一条不产生模型消息的命令日志，让导出里有可核对的内容
  await transport.call('commands/execute', { agentId: sessionId, line: '/compact', submittedAttachments: [] })
  const page = await transport.call('session/page', {
    request: { address: { kind: 'session', sessionId }, maxMessages: 500 },
  })
  const records = page?.records ?? []
  check(records.length > 0, '从宿主拿到会话日志', `${records.length} 条记录`)

  const jsonl = exportJsonl(records)
  const lines = jsonl.trimEnd().split('\n').filter(line => line !== '')
  check(lines.length === records.length, 'JSONL 一行一条、不丢记录', `${lines.length} / ${records.length}`)
  check(lines.every(line => { try { JSON.parse(line); return true } catch { return false } }), '每行都是合法 JSON')
  const parsed = lines.map(line => JSON.parse(line))
  check(parsed.some(record => record?.event?.type === 'command/run'), '原始命令事件完整保留')

  const bubbles = toBubbles(records)
  check(bubbles.some(item => item.kind === 'note' && item.text.includes('/compact')),
    '命令执行进视图模型（界面与导出都能看见）', `${bubbles.length} 条气泡`)

  const md = exportMarkdown(bubbles, { sessionId, title: '导出验收会话', exportedAt: '2026-11-15T10:00:00.000Z' })
  check(md.includes(`会话：\`${sessionId}\``), 'Markdown 头部带会话 id')
  check(md.includes(`消息数：${bubbles.length}`), 'Markdown 消息数与视图一致')
  check(md.includes('/compact'), 'Markdown 含命令执行记录')

  // 落成可审阅的产物（out/ 已 gitignore）
  mkdirSync(OUT, { recursive: true })
  const mdName = exportFilename(sessionId, 'md')
  const jsonlName = exportFilename(sessionId, 'jsonl')
  writeFileSync(join(OUT, mdName), md, 'utf8')
  writeFileSync(join(OUT, jsonlName), jsonl, 'utf8')
  check(readFileSync(join(OUT, mdName), 'utf8') === md && readFileSync(join(OUT, jsonlName), 'utf8') === jsonl,
    '两个格式都落盘且内容一致', `${mdName} / ${jsonlName}`)
  check(mdName.endsWith('.md') && jsonlName.endsWith('.jsonl') && !mdName.includes('/'), '文件名安全')
} catch (error) {
  failures += 1
  process.stdout.write(`FAIL  ${String(error)}\n`)
} finally {
  await stop(server.child)
}
process.stdout.write(`\n${failures === 0 ? '会话导出验收通过' : `${failures} 项失败`}\n`)
process.exit(failures === 0 ? 0 : 1)
