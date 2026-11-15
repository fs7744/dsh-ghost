/** 自动化：浏览器发现、CDP 表达式、Windows 脚本与元素解析。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  browserCandidates, clickExpression, clickScript, elementsScript, escapePowerShellString, fillExpression,
  findBrowser, isWindows, keysScript, launchArgs, parseDevToolsUrl, parseElements, screenshotScript,
  truncateText, typeScript,
} from '../src/index.ts'

test('浏览器发现：Windows 下找 Chrome/Edge，缺失则 undefined', () => {
  const list = browserCandidates('win32', { PROGRAMFILES: 'C:\\Program Files', 'PROGRAMFILES(X86)': 'C:\\Program Files (x86)' })
  assert.ok(list.some(item => item.name === 'Chrome'))
  assert.ok(list.some(item => item.name === 'Edge'))
  const found = findBrowser('win32', { PROGRAMFILES: 'C:\\Program Files', 'PROGRAMFILES(X86)': 'C:\\Program Files (x86)' },
    path => path.includes('msedge.exe'))
  assert.equal(found?.name, 'Edge')
  assert.equal(findBrowser('win32', {}, () => false), undefined)
})

test('启动参数带独立用户目录与调试端口', () => {
  const args = launchArgs('/tmp/profile', false)
  assert.ok(args.includes('--remote-debugging-port=0'))
  assert.ok(args.some(arg => arg.startsWith('--user-data-dir=')))
  assert.equal(args.includes('--headless=new'), false)
  assert.ok(launchArgs('/tmp/profile', true).includes('--headless=new'))
})

test('从 stderr 里认 DevTools 地址', () => {
  assert.equal(parseDevToolsUrl('DevTools listening on ws://127.0.0.1:52341/devtools/browser/abc'), 'ws://127.0.0.1:52341/devtools/browser/abc')
  assert.equal(parseDevToolsUrl('nothing here'), undefined)
})

test('页面操作表达式带上选择器与转义', () => {
  const click = clickExpression('a[href="x"]')
  assert.match(click, /querySelector/)
  assert.match(click, /a\[href=\\"x\\"\]/)
  const fill = fillExpression('#q', '说"话"')
  assert.match(fill, /dispatchEvent/)
  assert.match(fill, /input/)
})

test('正文截断带说明', () => {
  assert.equal(truncateText('abc', 10), 'abc')
  assert.match(truncateText('x'.repeat(20), 10), /已截断/)
})

test('Windows 脚本：单引号转义、截图与点击都生成得出', () => {
  assert.equal(escapePowerShellString("it's"), "it''s")
  const shot = screenshotScript("C:\\tmp\\a'b.png")
  assert.match(shot, /CopyFromScreen/)
  assert.match(shot, /a''b/)
  const click = clickScript(10.4, 20.6)
  assert.match(click, /SetCursorPos\(10, 21\)/)
  assert.match(click, /mouse_event/)
  const type = typeScript("hi'中")
  assert.match(type, /hi''中/)
  assert.match(type, /SendInput/)
  const keys = keysScript('^{}a')
  assert.match(keys, /SendWait/)
  assert.match(elementsScript(50), /UIAutomationClient/)
  assert.match(elementsScript(50), /-ge 50/)
})

test('元素树解析：单对象与数组都认，缺字段补零', () => {
  const one = parseElements('{"name":"保存","type":"ControlType.Button","x":10,"y":20,"w":30,"h":40}')
  assert.equal(one.length, 1)
  assert.equal(one[0]?.type, 'Button')
  assert.equal(one[0]?.width, 30)
  const many = parseElements('[{"name":"a","type":"ControlType.Text"},{"automationId":"id1"}]')
  assert.equal(many.length, 2)
  assert.equal(many[1]?.name, '')
  assert.equal(many[1]?.automationId, 'id1')
  assert.deepEqual(parseElements('not json'), [])
})

test('电脑操控只在 Windows 上', () => {
  assert.equal(isWindows('win32'), true)
  assert.equal(isWindows('darwin'), false)
})
