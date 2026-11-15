/**
 * 诊断包单测（C5-10）：脱敏零命中 + 纯 JS zip 结构。
 * 用假 token / key / cookie 验证输出里零命中（这是 verify:shell 也会复用的口径）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDiagnosticZip, collectDiagnostics, redactText, redactValue,
  type DiagnosticCollector, type DiagnosticFile,
} from '../src/diagnostics.ts'
import { FakeClock } from './fakes.ts'

const TOKEN = 'tk_FAKE_SECRET_9f8a'
const KEY = 'sk-fake-WBKEY-12345678'
const COOKIE = 'api_session=FAKECOOKIEVALUE; Path=/'
const SECRETS = [TOKEN, KEY, COOKIE]

function makeCollector(): DiagnosticCollector {
  return {
    versions: () => ({ product: '0.0.0', shell: '0.0.0', electron: '44', chromium: '1', node: `runtime-${TOKEN}` }),
    logTail: () => `GET /?token=${TOKEN}\nCookie: ${COOKIE}\nkey=${KEY}`,
    hostHealth: () => ({ ok: true, state: 'healthy', port: 41_000, restartCount: 0 }),
    tickets: () => [{ id: 't1', note: `apiKey=${KEY}` }],
    environment: () => ({ WB_KEY: KEY, cookie: COOKIE, safe: 'ok', token: TOKEN }),
    knownSecrets: () => SECRETS,
  }
}

const files: DiagnosticFile[] = [
  { name: 'a.txt', content: 'hello' },
  { name: 'b.json', content: '{"x":1}' },
]

test('redactText 把假 token/key/cookie 全部脱敏，输出零命中', () => {
  const text = [
    `url http://127.0.0.1:41000/?token=${TOKEN}`,
    `Authorization: Bearer ${KEY}`,
    `Cookie: ${COOKIE}`,
    JSON.stringify({ apiKey: KEY, token: TOKEN }),
    `raw ${TOKEN} ${KEY} ${COOKIE}`,
  ].join('\n')
  const out = redactText(text, SECRETS)
  for (const secret of SECRETS) assert.ok(!out.includes(secret), `leaked ${secret}`)
  assert.ok(out.includes('[REDACTED]'))
})

test('redactText 正则兜底覆盖未列入 knownSecrets 的常见敏感形态', () => {
  const out = redactText('x token=abc123&y=1\nAuthorization: Bearer zzz\nCookie: sid=qqq', [])
  assert.ok(!out.includes('abc123'))
  assert.ok(!out.includes('zzz'))
  assert.ok(!out.includes('sid=qqq'))
})

test('redactText 按长度降序替换，避免短串是长串子串时残留', () => {
  const long = 'tk_LONG_SECRET_VALUE'
  const short = 'tk_LONG'
  const out = redactText(`value=${long}`, [short, long])
  assert.ok(!out.includes(long))
  assert.ok(!out.includes(short))
})

test('redactValue 对敏感字段名整值替换并递归处理嵌套', () => {
  const input = { token: TOKEN, nested: { apiKey: KEY, safe: 'hello' }, list: [{ cookie: COOKIE }] }
  const out = redactValue(input, SECRETS) as Record<string, unknown>
  assert.equal(out['token'], '[REDACTED]')
  const nested = out['nested'] as Record<string, unknown>
  assert.equal(nested['apiKey'], '[REDACTED]')
  assert.equal(nested['safe'], 'hello')
  assert.ok(!JSON.stringify(out).includes(TOKEN))
})

test('collectDiagnostics 所有文件内容与 zip 字节零命中假敏感值', () => {
  const bundle = collectDiagnostics(makeCollector(), new FakeClock())
  for (const file of bundle.files) {
    for (const secret of SECRETS) assert.ok(!file.content.includes(secret), `${file.name} leaked`)
  }
  const asLatin1 = Buffer.from(bundle.zip).toString('latin1')
  for (const secret of SECRETS) assert.ok(!asLatin1.includes(secret), `zip leaked ${secret}`)
})

test('collectDiagnostics 产出 README 清单与 ISO createdAt', () => {
  const bundle = collectDiagnostics(makeCollector(), new FakeClock(0))
  const names = bundle.files.map(f => f.name)
  for (const expected of ['versions.json', 'host-health.json', 'tickets.json', 'environment.json', 'logs-tail.txt', 'README.txt']) {
    assert.ok(names.includes(expected), expected)
  }
  const readme = bundle.files.find(f => f.name === 'README.txt')
  assert.ok(readme?.content.includes('logs-tail.txt'))
  assert.match(bundle.createdAt, /^\d{4}-\d{2}-\d{2}T/)
})

test('buildDiagnosticZip 生成标准 ZIP 头与 EOCD', () => {
  const zip = buildDiagnosticZip(files)
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  assert.equal(view.getUint32(0, true), 0x04034b50)
  assert.equal(view.getUint32(zip.length - 22, true), 0x06054b50)
  assert.equal(view.getUint16(zip.length - 12, true), 2)
})

test('buildDiagnosticZip 本地头里的文件名与内容可逐项还原', () => {
  const zip = buildDiagnosticZip(files)
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  let offset = 0
  for (const file of files) {
    assert.equal(view.getUint32(offset, true), 0x04034b50)
    const compSize = view.getUint32(offset + 18, true)
    const nameLen = view.getUint16(offset + 26, true)
    const extraLen = view.getUint16(offset + 28, true)
    const nameStart = offset + 30
    let name = ''
    for (let j = 0; j < nameLen; j += 1) name += String.fromCharCode(zip[nameStart + j] ?? 0)
    assert.equal(name, file.name)
    const dataStart = nameStart + nameLen + extraLen
    const data = zip.slice(dataStart, dataStart + compSize)
    assert.equal(Buffer.from(data).toString('utf8'), file.content)
    offset = dataStart + compSize
  }
  assert.equal(view.getUint32(offset, true), 0x02014b50)
})

test('buildDiagnosticZip 打包脱敏后的内容，zip 字节零命中敏感串', () => {
  const raw: DiagnosticFile[] = [{ name: 'x.txt', content: `token=${TOKEN} key=${KEY}` }]
  const clean = raw.map(f => ({ ...f, content: redactText(f.content, SECRETS) }))
  const zip = buildDiagnosticZip(clean)
  const asLatin1 = Buffer.from(zip).toString('latin1')
  for (const secret of SECRETS) assert.ok(!asLatin1.includes(secret))
})

test('空文件列表与空 knownSecrets 不抛错且仍生成合法 EOCD', () => {
  const zip = buildDiagnosticZip([])
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  assert.equal(view.getUint32(0, true), 0x06054b50)
  assert.equal(redactText('plain text', []), 'plain text')
})
