/** 皮肤预设：内置赛博朋克等预设，id 唯一、变量齐全。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findPreset, SKIN_PRESETS } from '../src/themes.ts'

test('内置预设里有默认与赛博朋克，id 不重复', () => {
  const ids = SKIN_PRESETS.map(preset => preset.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(ids.includes('default'))
  assert.ok(ids.includes('cyberpunk'))
  assert.equal(findPreset('default')?.css, '', '默认预设不注入任何 CSS')
  assert.equal(findPreset('nope'), undefined)
})

test('赛博朋克预设覆盖了关键配色变量，且用 html:root 保证压得住浅色主题', () => {
  const preset = findPreset('cyberpunk')
  assert.ok(preset !== undefined)
  const css = preset.css
  for (const variable of ['--surface-lowest', '--surface-high', '--on-surface', '--accent', '--danger', '--ok']) {
    assert.match(css, new RegExp(`${variable}:`), `缺少 ${variable}`)
  }
  assert.match(css, /html:root/, '必须用 html:root 才能压过 body.theme-light')
  assert.match(css, /--accent: #00f0ff/, '主色应是霓虹青')
})
