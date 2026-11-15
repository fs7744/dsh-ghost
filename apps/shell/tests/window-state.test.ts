/**
 * 窗口状态持久化单测（C5-01）：校验 / 修复 bounds。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeBounds } from '../src/window-state.ts'
import { DEFAULT_CONFIG } from '../src/config.ts'

const displays = [{ x: 0, y: 0, width: 1920, height: 1080 }]

test('sanitizeBounds 合法 bounds 原样保留', () => {
  const b = { x: 50, y: 60, width: 1000, height: 700 }
  assert.deepEqual(sanitizeBounds(b, DEFAULT_CONFIG.window, displays), b)
})

test('sanitizeBounds 非对象输入回退默认', () => {
  for (const v of [null, 42, 'x']) {
    assert.deepEqual(sanitizeBounds(v, DEFAULT_CONFIG.window, displays), DEFAULT_CONFIG.window)
  }
})

test('sanitizeBounds 尺寸过小或过大回退默认', () => {
  assert.deepEqual(sanitizeBounds({ ...DEFAULT_CONFIG.window, width: 100 }, DEFAULT_CONFIG.window, displays), DEFAULT_CONFIG.window)
  assert.deepEqual(sanitizeBounds({ ...DEFAULT_CONFIG.window, height: 99_999 }, DEFAULT_CONFIG.window, displays), DEFAULT_CONFIG.window)
})

test('sanitizeBounds 窗口整体离屏时回退默认', () => {
  const off = { x: 5_000, y: 5_000, width: 900, height: 600 }
  assert.deepEqual(sanitizeBounds(off, DEFAULT_CONFIG.window, displays), DEFAULT_CONFIG.window)
})

test('sanitizeBounds 无显示器信息时不判离屏、保留 bounds', () => {
  const b = { x: 3_000, y: 3_000, width: 900, height: 600 }
  assert.deepEqual(sanitizeBounds(b, DEFAULT_CONFIG.window, []), b)
})

test('sanitizeBounds 字段含 NaN/字符串回退默认', () => {
  assert.deepEqual(sanitizeBounds({ x: 0, y: 0, width: 800, height: Number.NaN }, DEFAULT_CONFIG.window, displays), DEFAULT_CONFIG.window)
  assert.deepEqual(sanitizeBounds({ x: '0', y: 0, width: 800, height: 600 }, DEFAULT_CONFIG.window, displays), DEFAULT_CONFIG.window)
})
