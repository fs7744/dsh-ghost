#!/usr/bin/env node
/**
 * GitHub 全闭环验收：webhook → 来源映射 → 票 → 执行器（真模型）→ 报告 → 评论回到 GitHub。
 *
 * 两端都是本地回环假服务器：webhook 接收器校验签名，GitHub API 接收评论并记录。
 * 不需要公网、不需要真实 token。判定标准：票 ready，且评论真的发出去了（不是只排队）。
 */
import { createServer } from 'node:http'
import { createHmac } from 'node:crypto'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { boot, stop, login, createTransport } from './lib-driver.mjs'
import { toTriggers, verifySignature } from '../packages/source-github/src/index.ts'

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
rmSync(`${stateFile}.snapshot.json`, { force: true })

const SECRET = 'loop-dev-secret'
const BOT = 'dsh-ghost'
const GH_REPO = 'fs7744/dsh-ghost'
const QUESTION = '@dsh-ghost 用一句话说明：这个仓库用什么包管理器？'

let failures = 0
const check = (ok, label, extra = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra === '' ? '' : `：${extra}`}\n`)
  if (!ok) failures += 1
}

// 1) 假 GitHub API：记录每一条评论投递
const comments = []
const api = createServer((request, response) => {
  let raw = ''
  request.on('data', chunk => { raw += chunk })
  request.on('end', () => {
    let body = {}
    try { body = JSON.parse(raw) } catch { /* 空 body 也记账 */ }
    comments.push({ url: String(request.url), body, authorization: String(request.headers.authorization ?? '') })
    response.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify({ id: 5000 + comments.length }))
  })
})
await new Promise(resolve => api.listen(0, '127.0.0.1', resolve))
const apiPort = api.address().port

// 出口配置经环境变量注入宿主（boot 会继承 process.env）
process.env.GH_API_BASE = `http://127.0.0.1:${apiPort}`
process.env.GH_TOKEN = 'loop-test-token'
process.env.GH_REPO = GH_REPO

const server = await boot({ profile: 'p05', fromDefault: false })
let receiver
try {
  const transport = createTransport(await login(server.url, 'none'))
  const created = await transport.call('session/create', { request: { cwd: REPO } })
  await transport.call('session/selectModel', { request: { sessionId: created.sessionId, provider: 'wb', model: 'hy3' } })

  // 2) webhook 接收器：签名校验 → 映射 → 带 channel 交给宿主开票
  let ticketId = ''
  let rejected = ''
  receiver = createServer((request, response) => {
    let raw = ''
    request.on('data', chunk => { raw += chunk })
    request.on('end', async () => {
      const verification = verifySignature({ secret: SECRET }, raw, request.headers['x-hub-signature-256'])
      if (!verification.ok) {
        rejected = verification.reason
        response.writeHead(401).end(verification.reason)
        return
      }
      const event = String(request.headers['x-github-event'] ?? '')
      for (const trigger of toTriggers(event, JSON.parse(raw), { botLogin: BOT })) {
        const accepted = await transport.call('ghostTickets/accept', {
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
        ticketId = accepted.ticketId
      }
      response.writeHead(202).end('accepted')
    })
  })
  await new Promise(resolve => receiver.listen(0, '127.0.0.1', resolve))
  const receiverPort = receiver.address().port

  const payload = {
    action: 'created',
    repository: { full_name: GH_REPO },
    issue: { number: 42, title: '包管理器确认' },
    comment: { body: QUESTION, html_url: `https://github.com/${GH_REPO}/issues/42#c1`, user: { login: 'alice', type: 'User' } },
    sender: { login: 'alice', type: 'User' },
  }
  const body = JSON.stringify(payload)
  const signature = `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`
  const delivered = await fetch(`http://127.0.0.1:${receiverPort}/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-github-event': 'issue_comment', 'x-hub-signature-256': signature },
    body,
  })
  check(delivered.status === 202, 'webhook 正确签名投递', `HTTP ${delivered.status}${rejected === '' ? '' : ` ${rejected}`}`)
  check(ticketId !== '', '来源事件开出票', ticketId)

  // 3) 等执行器自己把票跑完
  let detail
  const deadline = Date.now() + 200_000
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 2000))
    const result = await transport.call('ghostTickets/get', { input: { id: ticketId } })
    detail = result.ticket
    if (detail !== undefined && detail.assignments.some(assignment => assignment.report?.state === 'ready')) break
  }
  const report = detail?.assignments.find(assignment => assignment.report !== null)?.report
  check(report?.state === 'ready', '票被自动跑到 ready', (report?.summary ?? '(无报告)').slice(0, 90))
  await new Promise(resolve => setTimeout(resolve, 1500))
  let earlyState
  try { earlyState = JSON.parse(readFileSync(stateFile, 'utf8')) } catch { earlyState = undefined }
  process.stdout.write(`诊断    outbox=${JSON.stringify(earlyState?.outbox ?? null)} replies=${(earlyState?.replies ?? []).length}\n`)

  // 4) 结果真的回写到 GitHub，而且带上入口的 issue 编号
  const issueComments = comments.filter(item => item.url.includes(`/repos/${GH_REPO}/issues/42/comments`))
  const withText = issueComments.filter(item => typeof item.body.body === 'string' && item.body.body.length > 8)
  check(withText.length > 0, '评论已投递到原 issue', `${issueComments.length} 条到 #42，${withText.length} 条有正文`)
  check(withText.some(item => (report?.summary ?? '').slice(0, 24).length > 0 && item.body.body.includes((report?.summary ?? '').slice(0, 24))),
    '评论正文就是票的报告', (withText.at(-1)?.body.body ?? '(无)').slice(0, 90))
  check(comments.length > 0 && comments.every(item => item.authorization === 'Bearer loop-test-token'), '出口带上了配置的令牌', `${comments.length} 条请求`);

  // 5) 幂等：等过一个兜底 flush 周期，评论数不增长
  const before = comments.length
  await new Promise(resolve => setTimeout(resolve, 12_000))
  check(comments.length === before, '重复 flush 没有刷屏', `${before} → ${comments.length}`)

  // 6) 状态文件里能看到回复已 sent（可观测性）
  let state
  try { state = JSON.parse(readFileSync(stateFile, 'utf8')) } catch { state = undefined }
  const sent = (state?.replies ?? []).filter(item => item.status === 'sent')
  check(sent.length > 0, '状态文件记录了已发送的回复', `${(state?.replies ?? []).length} 条记录 / ${sent.length} 条 sent`)
} catch (error) {
  failures += 1
  process.stdout.write(`FAIL  ${String(error)}\n`)
} finally {
  receiver?.close()
  api.close()
  await stop(server.child)
}
process.stdout.write(`\n${failures === 0 ? 'GitHub 全闭环验收通过' : `${failures} 项失败`}\n`)
process.exit(failures === 0 ? 0 : 1)
