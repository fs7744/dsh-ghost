#!/usr/bin/env node
/**
 * GitHub 来源端到端：签名校验 → 映射成 Trigger → 经 Remote 开票。
 *
 * 起一个真实的 HTTP 接收器（模拟 GitHub 投递），再把收下的事件交给宿主。
 * 不需要公网、不需要 ngrok：本地回环投递就能验证整条链路。
 */
import { createServer } from 'node:http'
import { createHmac } from 'node:crypto'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { boot, stop, login, createTransport } from './lib-driver.mjs'
import { toTriggers, verifySignature } from '../packages/source-github/src/index.ts'

const SECRET = 'local-dev-secret'
const BOT = 'dsh-ghost'
// 票状态会被 persisting() 持久化；不清快照就可能匹配到上一条验收留下的旧票。
const REPO = join(import.meta.dirname, '..')
rmSync(join(REPO, '.ghost', 'tickets.json.snapshot.json'), { force: true })

const server = await boot({ profile: 'p05', fromDefault: false })
let failures = 0
let receiver
try {
  const transport = createTransport(await login(server.url, 'none'))

  // 1) 真实 HTTP 接收器：校验签名 → 映射 → 交给宿主开票
  const received = []
  const rejected = []
  receiver = createServer((request, response) => {
    let raw = ''
    request.on('data', chunk => { raw += chunk })
    request.on('end', async () => {
      const check = verifySignature({ secret: SECRET }, raw, request.headers['x-hub-signature-256'])
      if (!check.ok) {
        rejected.push(check.reason)
        response.writeHead(401).end(check.reason)
        return
      }
      const event = String(request.headers['x-github-event'] ?? '')
      const triggers = toTriggers(event, JSON.parse(raw), { botLogin: BOT })
      for (const trigger of triggers) {
        // 注意：Remote 参数按方法形参名包装 —— 这里方法签名是 acceptTicket(input)
        const created = await transport.call('ghostTickets/accept', {
          input: {
            source: trigger.source,
            threadId: trigger.threads[0].id,
            text: trigger.text,
            human: trigger.human,
            addressed: trigger.addressed === 'mention',
            ...(trigger.url === undefined ? {} : { url: trigger.url }),
            ...(trigger.channel === undefined ? {} : { channel: trigger.channel }),
            actor: String(trigger.actor?.id ?? 'unknown'),
          },
        })
        received.push({ ok: true, ticketId: created.ticketId, addressed: trigger.addressed === 'mention' })
      }
      response.writeHead(202).end('accepted')
    })
  })
  await new Promise(resolve => receiver.listen(0, '127.0.0.1', resolve))
  const port = receiver.address().port

  /** 按 GitHub 的方式投递一次 webhook。 */
  const deliver = async (event, payload, secret = SECRET) => {
    const body = JSON.stringify(payload)
    const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
    const response = await fetch(`http://127.0.0.1:${port}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-github-event': event, 'x-hub-signature-256': signature },
      body,
    })
    return response.status
  }

  const payload = {
    action: 'created',
    repository: { full_name: 'fs7744/dsh-ghost' },
    issue: { number: 42, title: '构建失败' },
    comment: { body: '@dsh-ghost 帮忙看下这个构建为什么挂了', html_url: 'https://github.com/fs7744/dsh-ghost/issues/42#c1', user: { login: 'alice', type: 'User' } },
    sender: { login: 'alice', type: 'User' },
  }

  // 2) 正确签名 → 202 且开出票
  const good = await deliver('issue_comment', payload)
  process.stdout.write(`${good === 202 ? 'PASS' : 'FAIL'}  正确签名投递  HTTP ${good}\n`)
  if (good !== 202) failures += 1

  // 3) 错误签名 → 401，且不产生票
  const before = received.length
  const bad = await deliver('issue_comment', { ...payload, issue: { number: 43 } }, 'wrong-secret')
  process.stdout.write(`${bad === 401 ? 'PASS' : 'FAIL'}  错误签名被拒  HTTP ${bad}（${rejected.at(-1) ?? '—'}）\n`)
  if (bad !== 401) failures += 1
  if (received.length !== before) { failures += 1; process.stdout.write('FAIL  错误签名却产生了票\n') }

  // 4) 票在宿主的 Remote 面上可见，且带 addressed 语义
  const listed = await transport.call('ghostTickets/list', {})
  const ticket = (listed.items ?? []).find(item => item.title.includes('构建'))
  process.stdout.write(`${ticket === undefined ? 'FAIL' : 'PASS'}  Remote 上能看到票：${ticket?.title ?? '(无)'}\n`)
  if (ticket === undefined) failures += 1

  const accepted = received.find(item => item.ok === true)
  process.stdout.write(`${accepted?.addressed === true ? 'PASS' : 'FAIL'}  被 @ 的消息标记为 addressed\n`)
  if (accepted?.addressed !== true) failures += 1
} catch (error) {
  failures += 1
  process.stdout.write(`FAIL  ${String(error)}\n`)
} finally {
  receiver?.close()
  await stop(server.child)
}
process.stdout.write(`\n${failures === 0 ? 'GitHub 来源验收通过' : `${failures} 项失败`}\n`)
process.exit(failures === 0 ? 0 : 1)
