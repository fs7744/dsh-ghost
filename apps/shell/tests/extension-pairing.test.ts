/** 浏览器扩展配对：配对码一次性 + 静态服务的 /extension/pair 路由。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { createPairingStore } from '../src/extension-pairing.ts'
import { startStaticServer } from '../src/electron-static.ts'

test('配对码：一次性、5 分钟过期、能换新', () => {
  let now = 1_000
  const store = createPairingStore({ now: () => now, random: () => 0.123456 })
  const ticket = store.issue()
  assert.equal(ticket.code, '123456')
  assert.equal(store.verify('123456'), true)
  assert.equal(store.verify('123456'), false, '用过就作废')

  const second = store.issue()
  assert.equal(second.code, '123456')
  now += 5 * 60_000 + 1
  assert.equal(store.verify('123456'), false, '过期后不能配对')
})

test('配对码：空格与大小写不影响输入（用户手抄）', () => {
  const store = createPairingStore({ random: () => 0.5 })
  store.issue()
  assert.equal(store.verify(' 500000 '), true)
})

test('静态服务：POST /extension/pair 换地址与 Cookie，码错则 401', async () => {
  const server = await startStaticServer({
    distDir: join(import.meta.dirname, '..', 'dist'),
    harnessPort: 65000,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    pairExtension: async code => (code === '123456'
      ? { origin: 'http://127.0.0.1:65000', cookieName: 'dsh', cookieValue: 'secret-cookie', cwd: '/tmp' }
      : undefined),
  })
  try {
    const ok = await fetch(`http://127.0.0.1:${server.port}/extension/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: '123456' }),
    })
    assert.equal(ok.status, 200)
    const payload = await ok.json() as { origin: string; cookieName: string; cookieValue: string }
    assert.equal(payload.origin, 'http://127.0.0.1:65000')
    assert.equal(payload.cookieName, 'dsh')
    assert.equal(payload.cookieValue, 'secret-cookie')

    const bad = await fetch(`http://127.0.0.1:${server.port}/extension/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: '000000' }),
    })
    assert.equal(bad.status, 401)
  } finally {
    await server.close()
  }
})
