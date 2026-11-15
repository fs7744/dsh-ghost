/** UI 扩展契约：清单校验、归一化、行渲染。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizePanels, normalizeSlots, panelRows, validatePanelManifest, validateSlotContribution,
} from '../src/index.ts'

test('面板清单：合法项保留，非法项给原因', () => {
  assert.deepEqual(validatePanelManifest({ id: 'my-panel', title: '我的面板', source: { endpoint: 'myPlugin/rows' } }), [])
  assert.equal(validatePanelManifest({ id: 'Bad Id', title: '', source: {} }).length >= 3, true)
  const result = normalizePanels([
    { id: 'b', title: 'B', source: { endpoint: 'p/rows' }, order: 5 },
    { id: 'a', title: 'A', source: { endpoint: 'p/rows' }, order: 1 },
    { id: 'a', title: '重复', source: { endpoint: 'p/rows' }, order: 2 },
    { id: 'x', title: '', source: { endpoint: 'p/rows' } },
  ])
  assert.deepEqual(result.items.map(item => item.id), ['a', 'b'])
  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0]?.errors.join('；') ?? '', /title/)
})

test('插槽：未知插槽被丢弃', () => {
  assert.deepEqual(validateSlotContribution({ slot: 'chat.toolbar', label: '按钮' }), [])
  const result = normalizeSlots([
    { slot: 'chat.toolbar', label: '打开我的面板', endpoint: 'myPlugin/open' },
    { slot: 'nowhere', label: '无效' },
  ])
  assert.equal(result.items.length, 1)
  assert.equal(result.errors.length, 1)
})

test('面板行：对象按 columns 取值，字符串直接当标题', () => {
  const rows = panelRows([
    { name: '票 A', status: 'working', count: 3 },
    '纯文本行',
  ], ['status', 'count'])
  assert.equal(rows.length, 2)
  assert.equal(rows[0]?.name, '票 A')
  assert.deepEqual(rows[0]?.cells, ['working', '3'])
  assert.equal(rows[1]?.name, '纯文本行')
  assert.equal(panelRows({ items: [{ id: 'x' }] })[0]?.name, 'x')
})
