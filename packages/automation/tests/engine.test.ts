/** 自动化引擎：白名单、Playwright 优先、CDP 兜底、失败给原因。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBrowserEngine, hostAllowed } from '../src/index.ts'

test('站点白名单：空表示不限制，非空按域名与子域匹配', () => {
  assert.equal(hostAllowed('https://example.com/x'), true)
  assert.equal(hostAllowed('https://example.com/x', ['example.com']), true)
  assert.equal(hostAllowed('https://api.example.com/x', ['example.com']), true)
  assert.equal(hostAllowed('https://evil.com/x', ['example.com']), false)
  assert.equal(hostAllowed('不是网址', ['example.com']), false)
})

/** 假 Playwright：记录调用，模拟页面。 */
function fakePlaywright(behaviour: 'ok' | 'launch-fails') {
  const calls: string[] = []
  const page = {
    async goto(url: string) { calls.push(`goto:${url}`) },
    async title() { return '假页面' },
    async textContent() { return '正文内容' },
    async click(selector: string) { calls.push(`click:${selector}`) },
    async fill(selector: string, value: string) { calls.push(`fill:${selector}:${value}`) },
    async screenshot() { return Buffer.from('PNG') },
    async close() { calls.push('page-close') },
    isClosed() { return false },
  }
  const browser = {
    async newPage() { return page },
    async close() { calls.push('browser-close') },
  }
  return {
    calls,
    module: {
      chromium: {
        async launch(options: { channel?: string }) {
          calls.push(`launch:${options.channel ?? 'chromium'}`)
          if (behaviour === 'launch-fails') throw new Error('这个通道起不来')
          return browser
        },
      },
    },
  }
}

test('引擎优先用 Playwright（先系统浏览器通道）', async () => {
  const fake = fakePlaywright('ok')
  const created = await createBrowserEngine({
    headless: true,
    importPlaywright: async () => fake.module,
  })
  assert.equal('error' in created, false)
  if ('error' in created) return
  assert.equal(created.engine.kind, 'playwright')
  assert.match(created.note, /Playwright/)
  assert.equal(fake.calls[0], 'launch:msedge', '先试 msedge 通道')

  const title = await created.engine.open('https://example.com/')
  assert.equal(title, '假页面')
  assert.equal(await created.engine.click('#a'), 'clicked')
  assert.equal(await created.engine.type('#b', 'x'), 'filled')
  assert.equal(await created.engine.read(), '正文内容')
  await created.engine.close()
  assert.ok(fake.calls.includes('browser-close'))
})

test('Playwright 不可用时回落到 CDP（这里用假浏览器失败来说明错误路径）', async () => {
  const fake = fakePlaywright('launch-fails')
  const created = await createBrowserEngine({
    headless: true,
    importPlaywright: async () => fake.module,
  })
  // 所有通道都失败 → 继续尝试 CDP；本机没有浏览器时给出明确错误。
  if ('error' in created) {
    assert.match(created.error, /Chrome|Edge|浏览器/)
  } else {
    assert.equal(created.engine.kind, 'cdp')
  }
})
