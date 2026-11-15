#!/usr/bin/env node
/**
 * P1 验收：用 @dsh-ghost/harness-port 的类型化传输层跑通"取数 + 订阅事件"。
 *
 * 跑法：npm run verify:port
 * 它证明三件事：
 *   1. 端点名与参数键是编译期检查的（拼错 tsc 就报错）
 *   2. 不加载任何 harness 前端包也能调用
 *   3. 事件流能推过来（建会话 → api-session/added）
 *
 * 说明：启动/登录复用 spikes 里的开发用启停脚本，避免重复实现。
 */
import WebSocket from 'ws'
import { boot, stop, WORKSPACE } from '../spikes/p05-transport/lib/harness-client.mjs'
import { createTransport, login } from '../packages/harness-port/src/index.ts'

/** 把 Node 的 ws 适配成 harness-port 要求的 SocketLike。 */
function createWebSocket(url, headers) {
  const socket = new WebSocket(url, { headers })
  return {
    send: data => socket.send(data),
    close: () => socket.close(),
    onOpen: handler => socket.on('open', handler),
    onMessage: handler => socket.on('message', raw => handler(raw.toString())),
    onError: handler => socket.on('error', handler),
  }
}

const server = await boot({ profile: 'p1' })
let failures = 0
try {
  // 注意 interactions: 'answer' —— 订阅事件的前提（P0.5 实测）
  const session = await login(server.url, 'answer')
  const transport = createTransport({ ...session, createWebSocket, onError: error => process.stdout.write(`WARN  ${String(error)}\n`) })
  process.stdout.write(`boot  ${server.url.replace(/token=[\w.-]+/, 'token=***')}\n`)

  const list = await transport.call('session/list', { _request: {} })
  const before = Array.isArray(list?.items) ? list.items.length : '?'
  process.stdout.write(`PASS  session/list          items=${before}\n`)

  const frames = []
  await transport.events(frame => frames.push(frame))
  await new Promise(r => setTimeout(r, 300))

  const created = await transport.call('session/create', { request: { cwd: WORKSPACE } })
  process.stdout.write(`PASS  session/create        sessionId=${created?.sessionId}\n`)

  await new Promise(r => setTimeout(r, 1500))
  const ready = frames.filter(f => f.type === 'ready')
  const emits = frames.filter(f => f.type === 'emit')
  const names = [...new Set(emits.map(f => f.event))]
  process.stdout.write(`PASS  events/ready          clientId=${ready[0]?.clientId ?? '?'}\n`)
  process.stdout.write(`${emits.length > 0 ? 'PASS' : 'FAIL'}  events/emit           ${emits.length} 帧：${names.join(', ') || '(空)'}\n`)
  if (emits.length === 0) failures += 1
} catch (error) {
  failures += 1
  process.stdout.write(`FAIL  ${String(error)}\n`)
} finally {
  await stop(server.child)
}

process.stdout.write(`\n${failures === 0 ? 'harness-port 验收通过' : `${failures} 项失败`}\n`)
process.exit(failures === 0 ? 0 : 1)
