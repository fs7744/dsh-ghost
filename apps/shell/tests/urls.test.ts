/**
 * token / URL 校验与静态服务决策单测（C5-01 / C5-02 / C2-02）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildConnectPath, buildEntryUrl, isDeepLink, isSafeToken, parseDeepLink,
  parseHostUrl, redactTokenInText,
} from '../src/urls.ts'
import { resolveStaticPath, selectMime, shouldProxy } from '../src/static-server.ts'

test('parseHostUrl 接受 127.0.0.1 + 端口 + 安全 token', () => {
  const r = parseHostUrl('http://127.0.0.1:41234/?token=tk_abc-123')
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.port, 41_234)
    assert.equal(r.token, 'tk_abc-123')
    assert.equal(r.origin, 'http://127.0.0.1:41234')
  }
})

test('parseHostUrl 拒绝非本机 host、localhost、https、缺端口与畸形 URL', () => {
  const bad = [
    'http://localhost:41234/?token=tk_a',
    'http://0.0.0.0:41234/?token=tk_a',
    'http://192.168.1.5:41234/?token=tk_a',
    'https://127.0.0.1:41234/?token=tk_a',
    'not a url',
    'http://127.0.0.1/?token=tk_a',
  ]
  for (const url of bad) assert.equal(parseHostUrl(url).ok, false, url)
})

test('parseHostUrl 拒绝缺失、空或带注入字符的 token', () => {
  assert.equal(parseHostUrl('http://127.0.0.1:41234/').ok, false)
  assert.equal(parseHostUrl('http://127.0.0.1:41234/?token=').ok, false)
  assert.equal(parseHostUrl('http://127.0.0.1:41234/?token=tk_a%26x%3D1').ok, false)
  assert.equal(parseHostUrl('http://127.0.0.1:41234/?token=tk_a%20b').ok, false)
})

test('isSafeToken 只接受 URL 安全字符集且长度受限', () => {
  assert.equal(isSafeToken('tk_a.b-c~9'), true)
  assert.equal(isSafeToken(''), false)
  assert.equal(isSafeToken('a b'), false)
  assert.equal(isSafeToken('a&b'), false)
  assert.equal(isSafeToken('x'.repeat(513)), false)
})

test('buildEntryUrl 生成本机入口并拒绝非法端口/token', () => {
  assert.equal(buildEntryUrl(41_234, 'tk_a'), 'http://127.0.0.1:41234/?token=tk_a')
  assert.throws(() => buildEntryUrl(0, 'tk_a'))
  assert.throws(() => buildEntryUrl(41_234, 'a&b'))
})

test('buildConnectPath 固定 interactions=answer', () => {
  assert.equal(buildConnectPath('tk_a.b'), '/connect?token=tk_a.b&interactions=answer')
})

test('buildConnectPath 拒绝 none 与非法 token（事件订阅必须 answer）', () => {
  assert.throws(() => buildConnectPath('tk_a', 'none'))
  assert.throws(() => buildConnectPath('a&b'))
})

test('redactTokenInText 把一次性 token 从日志里抹掉', () => {
  const token = 'tk_SECRET99'
  const line = `GET /?token=${token} 200; retry token=${token}`
  const out = redactTokenInText(line, token)
  assert.ok(!out.includes(token))
  assert.equal(out.split('***').length - 1, 2)
})

test('parseDeepLink 解析 action / target / params', () => {
  const r = parseDeepLink('dsh-ghost://ticket/42?focus=1')
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.action, 'ticket')
    assert.equal(r.target, '42')
    assert.equal(r.params['focus'], '1')
  }
})

test('parseDeepLink 拒绝错误 scheme / 未知 action / 畸形 URL', () => {
  assert.equal(parseDeepLink('https://x').ok, false)
  assert.equal(parseDeepLink('dsh-ghost://unknown/x').ok, false)
  assert.equal(parseDeepLink('%%%').ok, false)
  assert.equal(isDeepLink('DSH-GHOST://open/x'), true)
})

test('shouldProxy 把 /connect 与 /api 交给宿主，其余走静态', () => {
  assert.equal(shouldProxy('/connect?token=tk_a'), true)
  assert.equal(shouldProxy('/api/session/list'), true)
  assert.equal(shouldProxy('/assets/index.js'), false)
  assert.equal(shouldProxy('/'), false)
  assert.equal(selectMime('a/index.html'), 'text/html; charset=utf-8')
  assert.equal(selectMime('a/unknown.bin'), 'application/octet-stream')
})

test('resolveStaticPath 拒绝目录穿越、空字节，并对根路径回退 index.html', () => {
  const root = 'C:/app/dist'
  const a = resolveStaticPath(root, '/')
  assert.equal(a.ok, true)
  if (a.ok) assert.equal(a.filePath, 'C:/app/dist/index.html')
  assert.equal(resolveStaticPath(root, '/assets/../secret.txt').ok, false)
  assert.equal(resolveStaticPath(root, '/%00').ok, false)
  const js = resolveStaticPath(root, '/assets/app.js')
  assert.equal(js.ok, true)
  if (js.ok) assert.equal(js.filePath, 'C:/app/dist/assets/app.js')
})
