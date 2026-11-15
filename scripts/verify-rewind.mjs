#!/usr/bin/env node
/**
 * Checkpoint / rewind 验收（C11-05）：纯逻辑 + 真实宿主的 `session/fork`。
 *
 * 判定：能从日志里找出可回退点、构造正确的 fork 请求；宿主确实 fork 出新会话，
 * 且带 atSeq 时新会话是原会话的前缀（原会话不动，回退可撤销）。
 */
import { boot, stop, login, createTransport } from './lib-driver.mjs'
import { findRewindPoints, forkRequest, rewindLabel } from '../apps/desktop/src/rewind.ts'

let failures = 0
const check = (ok, label, extra = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra === '' ? '' : `：${extra}`}\n`)
  if (!ok) failures += 1
}

// 1) 纯逻辑：构造一段带两条用户消息的日志
const ev = (type, seq, data = {}) => ({ type: 'event', event: { type, seq, data } })
const synthetic = [
  ev('header', 0),
  ev('user/message', 4, { content: [{ type: 'text', text: '第一问' }] }),
  ev('assistant/message', 5, { message: { content: [{ type: 'text', text: '答一' }] } }),
  ev('user/message', 9, { content: [{ type: 'text', text: '第二问' }] }),
  ev('turn/end', 10, { reason: { kind: 'end' } }),
]
const points = findRewindPoints(synthetic)
check(points.length === 2 && points[0]?.seq === 4 && points[1]?.seq === 9,
  '从日志找出两个 checkpoint', points.map(point => point.seq).join(', '))
check(JSON.stringify(forkRequest('s1', points[0])) === JSON.stringify({ request: { sessionId: 's1', atSeq: 4 } }),
  'fork 请求带精确的 atSeq')
check(forkRequest('s1').request.atSeq === undefined, '不指定 checkpoint 时省略 atSeq（宿主选最近完成回合）')
check(rewindLabel(points[1]).includes('第 2 条消息'), '确认文案带序号')

// 2) 真实宿主
const server = await boot({ profile: 'p05', fromDefault: false })
try {
  const transport = createTransport(await login(server.url, 'none'))
  const created = await transport.call('session/create', { request: { cwd: process.cwd() } })
  const sessionId = created?.sessionId
  // 造几条日志（命令不进模型消息，避免依赖真模型）
  await transport.call('commands/execute', { agentId: sessionId, line: '/compact', submittedAttachments: [] })
  const page = await transport.call('session/page', {
    request: { address: { kind: 'session', sessionId }, maxMessages: 100 },
  })
  const records = page?.records ?? []
  check(records.length > 0, '源会话有可 fork 的事件', `${records.length} 条`)

  // 精确边界：取日志中间某个真实 seq。省略 atSeq 会要求「已完成回合」，
  // 而本会话只有命令日志；带 atSeq 则直接按事件前缀 fork。
  const middle = records[Math.floor(records.length / 2)]
  const atSeq = middle?.event?.seq
  if (typeof atSeq === 'number') {
    const exact = await transport.call('session/fork', forkRequest(sessionId, { seq: atSeq, label: '', index: 1 }))
    const exactId = exact?.sessionId
    check(typeof exactId === 'string' && exactId !== sessionId,
      `带 atSeq=${atSeq} 的 fork 返回新会话`, `${String(exactId).slice(-8)}`)
    const forked = await transport.call('session/page', {
      request: { address: { kind: 'session', sessionId: exactId }, maxMessages: 100 },
    })
    const forkedCount = forked?.records?.length ?? 0
    check(forkedCount > 0 && forkedCount <= records.length,
      '新会话是原会话的前缀', `${forkedCount} / ${records.length} 条`)

    // 原会话未被改动
    const original = await transport.call('session/page', {
      request: { address: { kind: 'session', sessionId }, maxMessages: 100 },
    })
    check((original?.records?.length ?? 0) === records.length, '原会话保持不变（回退可撤销）')
  } else {
    failures += 1
    process.stdout.write('FAIL  日志里没有可用的 seq\n')
  }
} catch (error) {
  failures += 1
  process.stdout.write(`FAIL  ${String(error)}\n`)
} finally {
  await stop(server.child)
}
process.stdout.write(`\n${failures === 0 ? 'Checkpoint / rewind 验收通过' : `${failures} 项失败`}\n`)
process.exit(failures === 0 ? 0 : 1)
