import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { mentionsAgent, toTriggers, verifySignature } from '../src/index.ts'

const now = () => '2026-04-01T00:00:00.000Z'
const sign = (secret: string, body: string) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`

const repo = { full_name: 'fs7744/dsh-ghost', owner: { login: 'fs7744' }, name: 'dsh-ghost' }

test('签名：正确通过，篡改拒绝，缺失拒绝', () => {
  const secret = 's3cret'
  const body = '{"hello":"world"}'
  assert.deepEqual(verifySignature({ secret }, body, sign(secret, body)), { ok: true })
  assert.equal(verifySignature({ secret }, body, sign(secret, '{}')).ok, false)
  assert.equal(verifySignature({ secret }, body, undefined).ok, false)
  assert.equal(verifySignature({ secret }, body, 'sha1=abc').ok, false)
})

test('没有密钥时跳过校验（只允许本地调试）', () => {
  assert.deepEqual(verifySignature({}, 'x', undefined), { ok: true })
})

test('@ 提及按边界匹配：不误伤 ghostbusters / ghost-bot / 邮箱', () => {
  const options = { botLogin: 'ghost' }
  assert.equal(mentionsAgent('@ghost 看一下', options), true)
  assert.equal(mentionsAgent('请 @ghost，谢谢', options), true)
  assert.equal(mentionsAgent('@ghostbusters 看一下', options), false)
  assert.equal(mentionsAgent('@ghost-bot 看一下', options), false)
  assert.equal(mentionsAgent('发到 a@ghost.com', options), false)
  assert.equal(mentionsAgent('@dsh-ghost 看一下', { botLogin: 'dsh-ghost' }), true)
})

test('issue_comment：人 @ agent → addressed=mention，线程是 repo#编号', () => {
  const payload = {
    action: 'created',
    repository: repo,
    issue: { number: 12, title: '构建挂了' },
    comment: { body: '帮我看看 @dsh-ghost', html_url: 'https://github.com/x/y/issues/12#c1', user: { login: 'alice', type: 'User' } },
    sender: { login: 'alice', type: 'User' },
  }
  const [trigger] = toTriggers('issue_comment', payload, { botLogin: 'dsh-ghost' }, now)
  assert.ok(trigger !== undefined)
  assert.equal(trigger.source, 'github')
  assert.equal(trigger.human, true)
  assert.equal(trigger.addressed, 'mention')
  assert.deepEqual(trigger.threads, [{ source: 'github', id: 'fs7744/dsh-ghost#12' }])
  assert.equal(trigger.at, '2026-04-01T00:00:00.000Z')
  assert.equal(trigger.meta.event, 'issue_comment')
})

test('issue_comment：没点名就不算 addressed', () => {
  const payload = {
    action: 'created', repository: repo, issue: { number: 12 },
    comment: { body: '随手记一下', user: { login: 'alice', type: 'User' } },
    sender: { login: 'alice', type: 'User' },
  }
  const [trigger] = toTriggers('issue_comment', payload, { botLogin: 'dsh-ghost' }, now)
  assert.equal(trigger?.addressed, undefined)
})

test('机器人写的消息 human=false，即使点名也不算 addressed', () => {
  const payload = {
    action: 'created', repository: repo, issue: { number: 7 },
    comment: { body: '@dsh-ghost 自动回复', user: { login: 'ci-bot', type: 'Bot' } },
    sender: { login: 'ci-bot', type: 'Bot' },
  }
  const [trigger] = toTriggers('issue_comment', payload, { botLogin: 'dsh-ghost' }, now)
  assert.equal(trigger?.human, false)
  assert.equal(trigger?.addressed, undefined)
})

test('issues opened 也能触发，但不带 addressed', () => {
  const payload = { action: 'opened', repository: repo, issue: { number: 3, title: '新需求', body: '希望支持 X', html_url: 'u' }, sender: { login: 'bob', type: 'User' } }
  const [trigger] = toTriggers('issues', payload, {}, now)
  assert.equal(trigger?.human, true)
  assert.equal(trigger?.addressed, undefined)
  assert.match(trigger?.text ?? '', /新需求/)
})

test('PR 事件与 issue 共用线程编号', () => {
  const payload = { action: 'opened', repository: repo, pull_request: { number: 12, title: '修一下' }, sender: { login: 'bob', type: 'User' } }
  const [trigger] = toTriggers('pull_request', payload, {}, now)
  assert.deepEqual(trigger?.threads, [{ source: 'github', id: 'fs7744/dsh-ghost#12' }])
})

test('未知事件 / 缺仓库 → 空数组，不抛错', () => {
  assert.deepEqual(toTriggers('ping', { repository: repo }, {}, now), [])
  assert.deepEqual(toTriggers('issue_comment', { action: 'created' }, {}, now), [])
})

test('mentionsAgent 支持别名且大小写不敏感', () => {
  assert.equal(mentionsAgent('请 @DSH-Ghost 看一下', { botLogin: 'dsh-ghost' }), true)
  assert.equal(mentionsAgent('请 @ghost 看一下', { mentionAliases: ['ghost'] }), true)
  assert.equal(mentionsAgent('无关内容', { botLogin: 'dsh-ghost' }), false)
})
