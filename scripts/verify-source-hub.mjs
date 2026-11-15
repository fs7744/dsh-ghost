#!/usr/bin/env node
/**
 * 可插拔信息源验收：同一个宿主里同时挂三种完全不同的来源。
 *
 * 判定：来源清单可见且不含密钥；GitHub（HMAC）、声明式映射（token）、
 * 用户自定义 mapper 都能把各自格式的原始投递变成票；错误签名与未知来源被拒。
 */
import { createHmac } from 'node:crypto'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { boot, stop, login, createTransport } from './lib-driver.mjs'

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

// 密钥只从环境变量进宿主，配置里只有变量名
process.env.GH_WEBHOOK_SECRET = 'hub-dev-secret'
process.env.HUB_FORUM_TOKEN = 'forum-token'

let failures = 0
const check = (ok, label, extra = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra === '' ? '' : `：${extra}`}\n`)
  if (!ok) failures += 1
}

/** 调一次来源投递归一化；rawBody 用原始字符串。 */
const ingest = (transport, sourceId, body, headers = {}, event) => {
  const rawBody = JSON.stringify(body)
  return transport.call('ghostSources/ingest', {
    input: {
      sourceId,
      rawBody,
      body,
      headers,
      ...(event === undefined ? {} : { event }),
    },
  })
}

const server = await boot({ profile: 'p05', fromDefault: false })
try {
  const transport = createTransport(await login(server.url, 'none'))

  const listed = await transport.call('ghostSources/list', {})
  const ids = (listed.items ?? []).map(item => item.id)
  process.stdout.write(`来源    ${(listed.items ?? []).map(item => `${item.id}(${item.kind}/${item.auth})`).join(', ')}\n`)
  check(['github', 'forum', 'mine'].every(id => ids.includes(id)), '三种来源都已注册', ids.join(', '))
  check(JSON.stringify(listed).includes('hub-dev-secret') === false && JSON.stringify(listed).includes('forum-token') === false,
    '来源清单不泄露密钥')

  // 1) GitHub：内置适配器 + HMAC（头名与前缀都来自配置）
  const githubPayload = {
    action: 'created',
    repository: { full_name: 'fs7744/dsh-ghost' },
    issue: { number: 42, title: '构建挂了' },
    comment: { body: '@ghost 帮忙看下构建为什么挂了', html_url: 'https://example.test/42#c1', user: { login: 'alice', type: 'User' } },
    sender: { login: 'alice', type: 'User' },
  }
  const githubRaw = JSON.stringify(githubPayload)
  const signature = `sha256=${createHmac('sha256', process.env.GH_WEBHOOK_SECRET).update(githubRaw).digest('hex')}`
  const gh = await ingest(transport, 'github', githubPayload, { 'x-hub-signature-256': signature }, 'issue_comment')
  check(gh.accepted === 1 && gh.ticketIds?.[0] !== '', 'GitHub 内置适配器开票', `${gh.accepted} 张 ${gh.ticketIds?.[0] ?? ''}`)

  const bad = await ingest(transport, 'github', githubPayload, { 'x-hub-signature-256': 'sha256=deadbeef' }, 'issue_comment')
  check(bad.accepted === 0 && bad.reason === 'digest-mismatch', '错误签名被拒', bad.reason ?? '(无 reason)')

  // 2) 声明式映射：一个和 GitHub 毫无关系的 JSON 结构，只靠配置就能接
  const forumPayload = { payload: { kind: 'question', conversation: 'forum-room', id: '77', body: '@ghost 这个配置怎么改？', sender: 'bob', isHuman: 'true' } }
  const forum = await ingest(transport, 'forum', forumPayload, { 'x-forum-token': 'forum-token', 'x-source-event': 'message.created' })
  check(forum.accepted === 1, '声明式映射接住任意 webhook', `${forum.accepted} 张`)

  const noToken = await ingest(transport, 'forum', forumPayload, { 'x-source-event': 'message.created' })
  check(noToken.accepted === 0 && noToken.reason === 'missing-token', '缺少 token 被拒', noToken.reason ?? '(无 reason)')

  // 3) 用户自定义 mapper：真的动态加载 examples/im.mjs
  const imPayload = { type: 'im.message', room: 'dev', thread: 't1', text: '@ghost 帮我看下构建', from: { name: 'carol', bot: false } }
  const mine = await ingest(transport, 'mine', imPayload)
  check(mine.accepted === 1, '用户自定义 mapper 开票', `${mine.accepted} 张 ${mine.ticketIds?.[0] ?? ''}`)

  const unknown = await ingest(transport, 'not-configured', imPayload)
  check(unknown.accepted === 0 && unknown.reason === 'unknown-source', '未知来源被拒', unknown.reason ?? '(无 reason)')

  // 4) 三张票都能在 Remote 上看到，标题来自各自的映射
  const tickets = await transport.call('ghostTickets/list', {})
  const titles = (tickets.items ?? []).map(item => item.title).join(' | ')
  check((tickets.items ?? []).length >= 3, '三个来源的票都可见', `${(tickets.items ?? []).length} 张`)
  check(titles.includes('构建为什么挂了') && titles.includes('这个配置怎么改') && titles.includes('帮我看下构建'),
    '票标题来自各自的字段映射', titles.slice(0, 180))
} catch (error) {
  failures += 1
  process.stdout.write(`FAIL  ${String(error)}\n`)
} finally {
  await stop(server.child)
}
process.stdout.write(`\n${failures === 0 ? '可插拔信息源验收通过' : `${failures} 项失败`}\n`)
process.exit(failures === 0 ? 0 : 1)
