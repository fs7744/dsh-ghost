/** B5 触发源：签名接受 / 拒绝、addressed 判定、非 addressed 不建票、飞书默认关闭。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import {
  githubWatchSpec, feishuWatchSpec, verifyGithubDelivery, githubMentions,
  shouldOpenTicket, toTicketTriggers, ingestAndOpenTickets, sampleWatchSpecs,
} from '../src/sources/index.ts'

const SECRET = 'unit-test-secret'
const ENV: NodeJS.ProcessEnv = { GH_WEBHOOK_SECRET: SECRET }
const githubSpec = githubWatchSpec({ botLogin: 'dsh-ghost' }).spec

function body(text = 'please fix @dsh-ghost') {
  return {
    action: 'created',
    repository: { full_name: 'acme/repo' },
    issue: { number: 7 },
    comment: { body: text, user: { type: 'User' } },
    sender: { login: 'alice', type: 'User' },
  }
}

/** 造一次带正确 HMAC 的 GitHub 投递。 */
function signed(text = 'please fix @dsh-ghost') {
  const payload = body(text)
  const raw = JSON.stringify(payload)
  const sig = `sha256=${createHmac('sha256', SECRET).update(raw, 'utf8').digest('hex')}`
  return { payload, raw, headers: { 'x-github-event': 'issue_comment', 'x-hub-signature-256': sig } }
}

test('githubWatchSpec 默认启用的声明式 hmac 配置', () => {
  const watch = githubWatchSpec({ botLogin: 'dsh-ghost', mentionAliases: ['ghost'] })
  assert.equal(watch.enabled, true)
  assert.equal(watch.spec.kind, 'github')
  assert.equal(watch.spec.auth?.type, 'hmac')
  assert.equal(watch.spec.auth?.type === 'hmac' && watch.spec.auth.secretEnv, 'GH_WEBHOOK_SECRET')
  assert.equal(watch.spec.auth?.type === 'hmac' && watch.spec.auth.header, 'x-hub-signature-256')
})

test('feishuWatchSpec 默认关闭且没有任何明文密钥', () => {
  const watch = feishuWatchSpec()
  assert.equal(watch.enabled, false)
  assert.equal(watch.spec.kind, 'generic')
  assert.equal(watch.spec.auth?.type, 'hmac')
  const serialized = JSON.stringify(watch.spec)
  assert.ok(!serialized.includes('secret:'), '配置里不该出现明文字段')
  assert.ok(serialized.includes('FEISHU_WEBHOOK_SECRET'))
  assert.ok(watch.spec.mapping?.fields.addressed?.contains?.includes('@ghost'))
})

test('正确签名接受并建一张 addressed 票', async () => {
  const delivery = signed()
  const out = await ingestAndOpenTickets(githubSpec, {
    body: delivery.payload, rawBody: delivery.raw, headers: delivery.headers, event: 'issue_comment',
  }, ENV)
  assert.equal(out.summary.ok, true)
  assert.equal(out.summary.tickets, 1)
  assert.equal(out.triggers[0]?.addressed, 'mention')
  assert.equal(out.triggers[0]?.channel?.address['number'], '7')
})

test('错误签名被拒且一张票都不建', async () => {
  const delivery = signed()
  const out = await ingestAndOpenTickets(githubSpec, {
    body: delivery.payload, rawBody: delivery.raw,
    headers: { ...delivery.headers, 'x-hub-signature-256': 'sha256=deadbeef' }, event: 'issue_comment',
  }, ENV)
  assert.equal(out.summary.ok, false)
  assert.equal(out.summary.reason, 'digest-mismatch')
  assert.equal(out.summary.tickets, 0)
  assert.equal(out.triggers.length, 0)
})

test('缺签名头被拒并给出 missing-signature', async () => {
  const delivery = signed()
  const out = await ingestAndOpenTickets(githubSpec, {
    body: delivery.payload, rawBody: delivery.raw,
    headers: { 'x-github-event': 'issue_comment' }, event: 'issue_comment',
  }, ENV)
  assert.equal(out.summary.ok, false)
  assert.equal(out.summary.reason, 'missing-signature')
})

test('未配密钥时拒绝并给出 secret-not-configured', async () => {
  const delivery = signed()
  const out = await ingestAndOpenTickets(githubSpec, {
    body: delivery.payload, rawBody: delivery.raw, headers: delivery.headers, event: 'issue_comment',
  }, {})
  assert.equal(out.summary.ok, false)
  assert.equal(out.summary.reason, 'secret-not-configured')
})

test('非 addressed 的旁观消息归一化成功但不建票', async () => {
  const delivery = signed('just chatting, no mention')
  const out = await ingestAndOpenTickets(githubSpec, {
    body: delivery.payload, rawBody: delivery.raw, headers: delivery.headers, event: 'issue_comment',
  }, ENV)
  assert.equal(out.summary.ok, true)
  assert.equal(out.summary.events[0]?.addressed, false)
  assert.equal(out.summary.tickets, 0)
})

test('空线程或空正文一律不建票', () => {
  assert.equal(shouldOpenTicket({ source: 'x', threadId: '', text: 'hi', addressed: true }), false)
  assert.equal(shouldOpenTicket({ source: 'x', threadId: 't', text: '', addressed: true }), false)
  assert.equal(shouldOpenTicket({ source: 'x', threadId: 't', text: 'hi' }), false)
  const triggers = toTicketTriggers([
    { source: 'x', threadId: 't', text: 'hi', addressed: true },
    { source: 'x', threadId: 'u', text: '旁听', addressed: false },
  ], { now: () => '2026-02-01T00:00:00.000Z', makeId: (_event, i) => `tr-${i}` })
  assert.equal(triggers.length, 1)
  assert.equal(triggers[0]?.id, 'tr-0')
})

test('verifyGithubDelivery 正确 HMAC 通过', () => {
  const delivery = signed()
  assert.equal(verifyGithubDelivery(delivery.raw, delivery.headers, SECRET).ok, true)
})

test('verifyGithubDelivery 错误 HMAC 被拒', () => {
  const delivery = signed()
  const bad = `sha256=${'0'.repeat(64)}` // 等长但内容错，才会走到恒定时间比较
  const result = verifyGithubDelivery(delivery.raw, { 'x-hub-signature-256': bad }, SECRET)
  assert.equal(result.ok, false)
  assert.equal(result.ok === false && result.reason, 'digest-mismatch')
})

test('githubMentions 复用 source-github 判定 @ 提及', () => {
  const options = { botLogin: 'dsh-ghost', mentionAliases: ['ghost'] }
  assert.equal(githubMentions('please @dsh-ghost fix', options), true)
  assert.equal(githubMentions('hi @ghost', options), true)
  assert.equal(githubMentions('no mention here', options), false)
})

test('飞书签名项可配、映射声明式，样例里飞书默认关闭', () => {
  const watch = feishuWatchSpec({ enabled: true, signatureHeader: 'x-my-sig', signatureAlgorithm: 'sha512', signaturePrefix: 'v1=' })
  assert.equal(watch.enabled, true)
  assert.equal(watch.spec.auth?.type === 'hmac' && watch.spec.auth.header, 'x-my-sig')
  assert.equal(watch.spec.auth?.type === 'hmac' && watch.spec.auth.algorithm, 'sha512')
  assert.equal(watch.spec.auth?.type === 'hmac' && watch.spec.auth.prefix, 'v1=')
  assert.equal(watch.spec.mapping?.events?.[0], 'im.message.receive_v1')
  const sample = sampleWatchSpecs()
  assert.equal(sample.specs.length, 2)
  assert.equal(sample.enabled['feishu'], false)
})
