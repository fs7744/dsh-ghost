/** 拉取型信息源：请求头取环境变量、列表拆分、失败给原因。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pullFromApi, resolveHeaderValue } from '../src/index.ts'

const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
})

test('请求头值 env:NAME 从环境变量取，不写明文', () => {
  assert.equal(resolveHeaderValue('env:TOKEN', { TOKEN: 'abc' }), 'abc')
  assert.equal(resolveHeaderValue('env:MISSING', {}), '')
  assert.equal(resolveHeaderValue('Bearer x'), 'Bearer x')
})

test('拉一次：整段响应包成一条投递', async () => {
  const result = await pullFromApi({ url: 'https://example.test/api' }, {
    fetchImpl: async () => jsonResponse({ id: 1, title: '坏了' }),
  })
  assert.equal(result.ok, true)
  assert.equal(result.requests.length, 1)
  assert.deepEqual(result.requests[0].body, { id: 1, title: '坏了' })
})

test('拉一次：listPath 里的数组拆成多条投递', async () => {
  const result = await pullFromApi({ url: 'https://example.test/api', listPath: 'data.items' }, {
    fetchImpl: async () => jsonResponse({ data: { items: [{ id: 1 }, { id: 2 }] } }),
  })
  assert.equal(result.ok, true)
  assert.equal(result.requests.length, 2)
  assert.deepEqual(result.requests[1].body, { id: 2 })
})

test('拉一次失败给原因，不抛异常', async () => {
  const failed = await pullFromApi({ url: 'https://example.test/api' }, {
    fetchImpl: async () => jsonResponse({}, 503),
  })
  assert.equal(failed.ok, false)
  assert.match(failed.reason ?? '', /503/)
  const empty = await pullFromApi({ url: '  ' }, { fetchImpl: async () => jsonResponse({}) })
  assert.equal(empty.ok, false)
})

test('拉取地址拒绝非 http(s) 协议与非法格式（防 SSRF / 文件读取）', async () => {
  let called = false
  const fetchImpl = async (): Promise<Response> => { called = true; return jsonResponse({}) }
  for (const url of ['file:///etc/passwd', 'ftp://example.test/x', 'javascript:alert(1)', 'not a url']) {
    const result = await pullFromApi({ url }, { fetchImpl })
    assert.equal(result.ok, false, url)
    assert.equal(called, false, `${url} 不应发出请求`)
  }
  // http(s) 仍正常放行
  const ok = await pullFromApi({ url: 'http://example.test/api' }, { fetchImpl })
  assert.equal(ok.ok, true)
  assert.equal(called, true)
})

test('拉一次带上鉴权头（值来自环境变量）', async () => {
  let seen: Record<string, string> = {}
  await pullFromApi({ url: 'https://example.test/api', headers: { authorization: 'env:TOKEN' } }, {
    env: { TOKEN: 'secret-value' },
    fetchImpl: async (_url, init) => {
      seen = (init?.headers ?? {}) as Record<string, string>
      return jsonResponse({})
    },
  })
  assert.equal(seen.authorization, 'secret-value')
})
