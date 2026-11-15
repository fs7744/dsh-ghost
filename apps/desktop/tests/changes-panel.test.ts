/** 变更面板：归一化变更列表 + 差异渲染。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeChangedFiles, renderDiffHtml } from '../src/changes-panel.ts'

test('变更列表归一化，缺字段补零', () => {
  const files = normalizeChangedFiles([
    { path: 'a.ts', status: 'modified', additions: 3, deletions: 1 },
    { path: '', status: 'modified' },
    { status: 'added' },
  ])
  assert.equal(files.length, 1)
  assert.equal(files[0]?.additions, 3)
})

test('差异渲染：新增/删除/上下文分色', () => {
  const html = renderDiffHtml('@@ -1,2 +1,2 @@\n ctx\n-old\n+new')
  assert.match(html, /dl add/)
  assert.match(html, /dl del/)
  assert.match(html, /dl ctx/)
  assert.match(html, /dl-no/)
})
