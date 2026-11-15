#!/usr/bin/env node
/**
 * 安全自检（C2）：四条"必须被拒"的路径。
 *
 *  1. 没有 Cookie 调 RPC            → 401
 *  2. 伪造 Cookie 调 RPC            → 401
 *  3. Host 不是本机（DNS rebinding）→ 403
 *  4. interactions=none 订阅事件    → 被网关拒绝
 *
 * 这些都是 harness 的现成机制；我们的价值是**把它们钉成测试**，
 * 以后升级 harness 时若边界松动，这里会先红。
 */
import { request as httpRequest } from 'node:http'
import WebSocket from 'ws'
import { boot, stop, login } from './lib-driver.mjs'

const server = await boot({ profile: 'p05', fromDefault: false })
const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok, detail })
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}\n`)
}

const rpc = async (headers, endpoint = 'session/list') => {
  const response = await fetch(`${server.url.split('/?')[0]}/api/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ type: 'client-request', rpcId: 'auth-1', method: endpoint, payload: { args: { _request: {} } } }),
  })
  return response.status
}

try {
  // 1) 无 Cookie
  const anonymous = await rpc({})
  record('无 Cookie 的 RPC 被拒', anonymous === 401, `HTTP ${anonymous}`)

  // 2) 伪造 Cookie
  const forged = await rpc({ cookie: 'dsh-session=forged-value' })
  record('伪造 Cookie 被拒', forged === 401, `HTTP ${forged}`)

  // 3) 非本机 Host（DNS rebinding 防线）
  //    注意：fetch 会把 Host 强制改回 URL 的主机名，所以这里必须用底层 http。
  const rebinding = await new Promise(resolve => {
    const url = new URL(server.url)
    const req = httpRequest({
      host: '127.0.0.1',
      port: url.port,
      path: '/api/session/list',
      method: 'POST',
      headers: { host: 'evil.example.com', 'content-type': 'application/json' },
    }, response => { response.resume(); resolve(response.statusCode) })
    req.on('error', () => resolve(0))
    req.end(JSON.stringify({ type: 'client-request', rpcId: 'auth-3', method: 'session/list', payload: { args: { _request: {} } } }))
  })
  record('非本机 Host 被拒', rebinding === 403, `HTTP ${rebinding}`)

  // 4) interactions=none 不能订阅事件
  const { origin, cookie } = await login(server.url, 'none')
  const denied = await new Promise(resolve => {
    const socket = new WebSocket(`${origin.replace('http', 'ws')}/api/remote.mux`, { headers: { cookie } })
    const timer = setTimeout(() => { socket.close(); resolve({ ok: false, detail: '超时未收到拒绝' }) }, 8000)
    socket.on('open', () => socket.send(JSON.stringify({ type: 'open', streamId: 's1', endpoint: '$events', payload: { args: {} } })))
    socket.on('message', raw => {
      clearTimeout(timer)
      const text = raw.toString()
      socket.close()
      resolve({ ok: /interactions-forbidden/.test(text), detail: text.slice(0, 120) })
    })
    socket.on('error', () => { clearTimeout(timer); resolve({ ok: false, detail: 'socket error' }) })
  })
  record('interactions=none 不能订阅事件', denied.ok, denied.detail)
} finally {
  await stop(server.child)
}

const failed = results.filter(result => !result.ok).length
process.stdout.write(`\n${results.length - failed}/${results.length} 通过\n`)
process.exit(failed === 0 ? 0 : 1)
