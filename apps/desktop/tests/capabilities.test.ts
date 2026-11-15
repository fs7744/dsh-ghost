/** 宿主能力台账：预设归一化、电脑操控状态、能力清单完整。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CAPABILITY_LEDGER, normalizeCuaStatus, normalizePresets } from '../src/capabilities-panel.ts'

test('Agent 预设归一化并按顺序排', () => {
  const presets = normalizePresets({ presets: [
    { id: 'cordis', order: 4 }, { id: 'standard', order: 1, isDefault: true }, { id: '' },
  ] })
  assert.equal(presets.length, 2)
  assert.equal(presets[0]?.id, 'standard')
  assert.equal(presets[0]?.isDefault, true)
})

test('电脑操控状态：宿主没装载就是不可用', () => {
  assert.equal(normalizeCuaStatus(undefined), undefined)
  assert.equal(normalizeCuaStatus({ supported: false })?.supported, false)
  assert.equal(normalizeCuaStatus({ supported: true })?.supported, true)
})

test('能力台账：每条都有状态与说明，且状态是已知取值', () => {
  assert.ok(CAPABILITY_LEDGER.length >= 10)
  const states = new Set(['wired', 'host-default', 'toggleable', 'not-wired'])
  for (const row of CAPABILITY_LEDGER) {
    assert.ok(states.has(row.state), `未知状态 ${row.state}`)
    assert.ok(row.note.length > 0, `${row.id} 缺说明`)
  }
})
