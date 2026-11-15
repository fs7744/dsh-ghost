/** 可插拔来源层的单元测试：模板、签名、四种适配器、注册表。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  createRegistry, verifyAuth, getPath, render, applyMapping, importMapper,
  githubAdapter, genericAdapter, passthroughAdapter, customAdapter,
} from '../src/index.ts'
import type { AdapterContext, GenericMapping, SourceRequest, SourceSpec } from '../src/index.ts'

const SECRET = 'unit-secret'
const context: AdapterContext = { importMapper }

const request = (body: unknown, headers: Record<string, string> = {}, event?: string): SourceRequest => ({
  headers,
  rawBody: JSON.stringify(body),
  body,
  ...(event === undefined ? {} : { event }),
})

const genericMapping: GenericMapping = {
  eventHeader: 'x-source-event',
  events: ['message.created'],
  where: [{ path: 'payload.kind', equals: 'question' }],
  fields: {
    threadId: '{{payload.conversation}}#{{payload.id}}',
    text: '{{payload.body}}',
    actor: '{{payload.sender}}',
    human: '{{payload.isHuman}}',
    addressed: { contains: ['@ghost'] },
    channel: {
      thread: '{{payload.conversation}}',
      address: { number: '{{payload.id}}' },
    },
  },
}

test('模板：点路径、headers、event 与缺失字段', async () => {
  const req = request({ payload: { id: 7, nested: { a: 'x' } } }, { 'x-who': 'alice' }, 'created')
  assert.equal(getPath(req.body, 'payload.nested.a'), 'x')
  assert.equal(render('{{payload.id}} {{headers.x-who}} {{event}} {{payload.missing}}', req), '7 alice created ')
  assert.equal(render('{{payload.nested}}', req), '{"a":"x"}')
})

test('声明式映射：条件、别名、human、channel 都从配置来', async () => {
  const good = request(
    { payload: { kind: 'question', conversation: 'room-1', id: '42', body: '@ghost 帮我看下', sender: 'alice', isHuman: 'true' } },
    { 'x-source-event': 'message.created' },
  )
  const events = applyMapping(genericMapping, good, 'generic')
  assert.equal(events.length, 1)
  assert.equal(events[0]?.threadId, 'room-1#42')
  assert.equal(events[0]?.human, true)
  assert.equal(events[0]?.addressed, true)
  assert.equal(events[0]?.channel?.address.number, '42')
  assert.equal(events[0]?.channel?.source, 'generic')

  const wrongEvent = request(good.body, { 'x-source-event': 'message.deleted' })
  assert.equal(applyMapping(genericMapping, wrongEvent, 'generic').length, 0)
  const wrongKind = request({ payload: { ...(good.body as { payload: object }).payload, kind: 'note' } }, { 'x-source-event': 'message.created' })
  assert.equal(applyMapping(genericMapping, wrongKind, 'generic').length, 0)
})

test('HMAC：头名/前缀可配，原始字节参与计算，错误摘要被拒', async () => {
  const req = request({ hello: 'world' })
  const signature = `sha256=${createHmac('sha256', SECRET).update(req.rawBody).digest('hex')}`
  const auth: SourceSpec['auth'] = { type: 'hmac', header: 'x-my-signature', prefix: 'sha256=', secret: SECRET }
  assert.equal(verifyAuth(auth, { ...req, headers: { 'x-my-signature': signature } }).ok, true)
  assert.deepEqual(verifyAuth(auth, { ...req, headers: { 'x-my-signature': 'sha256=deadbeef' } }), { ok: false, reason: 'digest-mismatch' })
  assert.deepEqual(verifyAuth(auth, req), { ok: false, reason: 'missing-signature' })
  // 重新序列化会改变字节，签名必须失配
  const tampered = { ...req, rawBody: JSON.stringify({ hello: 'world' }, null, 2) }
  assert.equal(verifyAuth(auth, { ...tampered, headers: { 'x-my-signature': signature } }).ok, false)
})

test('token / none / 密钥来自环境变量', async () => {
  const req = request({}, { 'x-token': 'abc' })
  assert.equal(verifyAuth({ type: 'token', header: 'x-token', value: 'abc' }, req).ok, true)
  assert.equal(verifyAuth({ type: 'token', header: 'x-token', value: 'nope' }, req).ok, false)
  assert.equal(verifyAuth({ type: 'none' }, req).ok, true)
  const envAuth: SourceSpec['auth'] = { type: 'token', header: 'x-token', valueEnv: 'HUB_TEST_TOKEN' }
  assert.equal(verifyAuth(envAuth, req, { HUB_TEST_TOKEN: 'abc' }).ok, true)
  assert.deepEqual(verifyAuth(envAuth, req, {}), { ok: false, reason: 'token-not-configured' })
})

test('GitHub 适配器：复用 source-github，带出写回地址', async () => {
  const payload = {
    action: 'created',
    repository: { full_name: 'fs7744/dsh-ghost' },
    issue: { number: 42, title: '构建失败' },
    comment: { body: '@ghost 帮忙看下', html_url: 'https://example.test/42#c1', user: { login: 'alice', type: 'User' } },
    sender: { login: 'alice', type: 'User' },
  }
  const list = await githubAdapter.normalize(request(payload, {}, 'issue_comment'), { id: 'github', kind: 'github', options: { botLogin: 'ghost' } }, context)
  assert.equal(list.length, 1)
  assert.equal(list[0]?.threadId, 'fs7744/dsh-ghost#42')
  assert.equal(list[0]?.addressed, true)
  assert.equal(list[0]?.channel?.address.number, '42')
})

test('generic 适配器：接一个完全不是 GitHub 的来源', async () => {
  const payload = { payload: { kind: 'question', conversation: 'room-9', id: '88', body: '这个怎么配？', sender: 'bob', isHuman: 'true' } }
  const events = genericAdapter.normalize(request(payload, { 'x-source-event': 'message.created' }), { id: 'forum', kind: 'generic', mapping: genericMapping }, context)
  assert.equal((events as unknown[]).length, 1)
  assert.equal((events as Array<{ threadId: string }>)[0]?.threadId, 'room-9#88')
})

test('passthrough 适配器：过滤掉形状不合法的事件', async () => {
  const events = passthroughAdapter.normalize(request([
    { source: 'im', threadId: 'a', text: '你好' },
    { source: 'im', threadId: 'b' },
    'garbage',
  ]), { id: 'passthrough', kind: 'passthrough' }, context)
  assert.equal((events as unknown[]).length, 1)
})

test('custom 适配器：真的加载用户写的 .mjs mapper', async () => {
  const mapper = pathToFileURL(join(import.meta.dirname, '..', 'examples', 'im.mjs')).href
  const events = await customAdapter.normalize(
    request({ type: 'im.message', room: 'dev', thread: 't1', text: '@ghost 帮我看构建', from: { name: 'alice', bot: false } }),
    { id: 'mine', kind: 'custom', mapper, options: { mention: '@ghost' } },
    context,
  )
  const list = events as Array<{ source: string; threadId: string; addressed?: boolean; channel?: { address: Record<string, string> } }>
  assert.equal(list.length, 1)
  assert.equal(list[0]?.source, 'my-im')
  assert.equal(list[0]?.threadId, 'im:dev:t1')
  assert.equal(list[0]?.addressed, true)
  assert.equal(list[0]?.channel?.address.room, 'dev')
})

test('注册表：列出来源、拒绝未知来源与错误签名、正常归一化', async () => {
  const specs: SourceSpec[] = [
    { id: 'github', kind: 'github', options: { botLogin: 'ghost' } },
    { id: 'forum', kind: 'generic', mapping: genericMapping },
    { id: 'raw', kind: 'passthrough' },
  ]
  const registry = createRegistry(specs, context)
  assert.deepEqual(registry.list().map(item => item.id), ['github', 'forum', 'raw'])
  assert.equal(registry.list()[0]?.auth, 'none')
  assert.deepEqual(await registry.normalize('nope', request({})), { ok: false, reason: 'unknown-source', events: [] })

  const secured = createRegistry([
    { id: 'signed', kind: 'passthrough', auth: { type: 'token', header: 'x-token', value: 'abc' } },
  ], context)
  assert.deepEqual(await secured.normalize('signed', request({ source: 'im', threadId: 'a', text: 'x' })), { ok: false, reason: 'missing-token', events: [] })
  const ok = await secured.normalize('signed', request({ source: 'im', threadId: 'a', text: 'x' }, { 'x-token': 'abc' }))
  assert.equal(ok.ok, true)
  assert.equal(ok.events.length, 1)
})
