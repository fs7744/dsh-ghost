/** 代码视图：语言识别、高亮转义、行号、超长保护、冲突标记。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  detectLang, hasConflictMarkers, highlight, truncateForView, withLineNumbers,
} from '../src/code-view.ts'

test('语言识别按扩展名', () => {
  assert.equal(detectLang('src/app.ts'), 'ts')
  assert.equal(detectLang('a/b/c.py'), 'py')
  assert.equal(detectLang('data.json'), 'json')
  assert.equal(detectLang('README.md'), 'md')
  assert.equal(detectLang('image.png'), 'text')
})

test('高亮会转义 HTML，不把文件内容当标记注入', () => {
  const html = highlight('const a = "<script>alert(1)</script>"', 'ts')
  assert.match(html, /tok-keyword/)
  assert.equal(html.includes('<script>'), false)
  assert.match(html, /&lt;script&gt;/)
})

test('行号与超长保护', () => {
  const numbered = withLineNumbers('a\nb')
  assert.match(numbered, /ln/)
  assert.match(numbered, /b/)
  const clipped = truncateForView(Array.from({ length: 30 }, (_, i) => `l${i}`).join('\n'), 10)
  assert.equal(clipped.truncated, true)
  assert.equal(clipped.totalLines, 30)
  assert.equal(clipped.text.split('\n').length, 10)
})

test('冲突标记能被认出', () => {
  assert.equal(hasConflictMarkers('a\n<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> b\n'), true)
  assert.equal(hasConflictMarkers('a\nb\n'), false)
})
