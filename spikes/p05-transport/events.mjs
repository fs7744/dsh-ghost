#!/usr/bin/env node
/**
 * 事件流探针：证明"面板实时更新"能成立。
 *
 * 协议（见 harness 的 gateway/stream-protocol.ts）：
 *   连接 ws://<host>/api/remote.mux（带 API Cookie）
 *   开流: { type:'open', streamId, endpoint:'$events', payload:{ args:{} } }
 *   收帧: { type:'item', streamId, value:{ type:'ready'|'emit'|'waterfall', … } }
 */
import { readFileSync } from 'node:fs'
import WebSocket from 'ws'
import { boot, connect, rpc, stop, WORKSPACE } from './lib/harness-client.mjs'

const WAIT_READY_MS = 15_000
const LISTEN_MS = 8_000

const contract = JSON.parse(readFileSync(new URL('../../harness-contract/remotes.json', import.meta.url), 'utf8'))
const has = endpoint => contract.remotes.some(r => r.endpoint === endpoint)

const server = await boot()
// 订阅事件必须 interactions=answer（none 会被 gateway 以 interactions-forbidden 拒绝）
const { origin, cookie } = await connect(server.url, { interactions: 'answer' })
const wsUrl = `${origin.replace('http', 'ws')}/api/remote.mux`

const frames = []
const ready = new Promise((resolveReady, rejectReady) => {
  const timer = setTimeout(() => rejectReady(new Error(`开流后 ${WAIT_READY_MS}ms 没收到 ready`)), WAIT_READY_MS)
  const socket = new WebSocket(wsUrl, { headers: { cookie } })
  socket.on('open', () => {
    process.stdout.write(`PASS  连接 mux  ${wsUrl}\n`)
    socket.send(JSON.stringify({ type: 'open', streamId: 's1', endpoint: '$events', payload: { args: {} } }))
  })
  socket.on('message', raw => {
    let message
    try { message = JSON.parse(raw.toString()) } catch { return }
    if (message.streamId !== 's1') return
    if (message.type === 'item') {
      frames.push(message.value)
      if (message.value?.type === 'ready') {
        clearTimeout(timer)
        resolveReady({ socket, clientId: message.value.clientId, host: message.value.host })
      }
    }
    if (message.type === 'error') process.stdout.write(`WARN  stream error: ${JSON.stringify(message.error)}\n`)
  })
  socket.on('error', error => { clearTimeout(timer); rejectReady(error) })
})

let socket
try {
  const opened = await ready
  socket = opened.socket
  process.stdout.write(`PASS  收到 ready  clientId=${opened.clientId} host=${opened.host?.home ?? '?'}\n`)

  // 制造一次真实状态变化：建一个会话（纯读不会产生任何事件）。
  if (has('session/create')) {
    try {
      const created = await rpc({ origin, cookie }, 'session/create', { request: { cwd: WORKSPACE } })
      process.stdout.write(`     已创建会话 sessionId=${created?.sessionId}\n`)
    } catch (error) {
      process.stdout.write(`     session/create 未成功：${String(error).slice(0, 160)}\n`)
    }
  }

  await new Promise(r => setTimeout(r, LISTEN_MS))
  const emits = frames.filter(f => f?.type === 'emit')
  const waterfalls = frames.filter(f => f?.type === 'waterfall')
  const names = [...new Set(emits.map(e => e.event))]
  process.stdout.write(`${emits.length > 0 || waterfalls.length > 0 ? 'PASS' : 'WARN'}  收到 ${
    emits.length} emit / ${waterfalls.length} waterfall，事件名：${names.slice(0, 8).join(', ') || '(空)'}\n`)
} catch (error) {
  process.stdout.write(`FAIL  ${String(error)}\n`)
} finally {
  try { socket?.close() } catch { /* 已关闭 */ }
  await stop(server.child)
}

const ok = frames.some(f => f?.type === 'ready')
process.stdout.write(`\n${ok ? '事件流可用' : '事件流不可用'}：帧总数 ${frames.length}\n`)
process.exit(ok ? 0 : 1)
