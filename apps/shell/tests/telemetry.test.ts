/**
 * 遥测与隐私单测（C7）：默认关闭、本地优先、可导出可删除、导出脱敏。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TelemetryBuffer } from '../src/telemetry.ts'
import { FakeClock } from './fakes.ts'

test('默认关闭：record 不记录事件', () => {
  const b = new TelemetryBuffer(new FakeClock())
  assert.equal(b.isEnabled(), false)
  assert.equal(b.record('boot'), false)
  assert.equal(b.size, 0)
})

test('开启后按开关记录事件', () => {
  const b = new TelemetryBuffer(new FakeClock())
  b.setEnabled(true)
  assert.equal(b.record('boot'), true)
  assert.equal(b.record('ticket', 'detail'), true)
  assert.equal(b.size, 2)
})

test('再次关闭会清空缓冲', () => {
  const b = new TelemetryBuffer(new FakeClock())
  b.setEnabled(true)
  b.record('x')
  b.setEnabled(false)
  assert.equal(b.size, 0)
  assert.equal(b.isEnabled(), false)
})

test('export 对 detail 强制脱敏，输出零命中', () => {
  const b = new TelemetryBuffer(new FakeClock(5_000))
  b.setEnabled(true)
  b.record('net', 'token=tk_FAKE_123 cookie=SIDFAKE')
  const out = b.export(['tk_FAKE_123', 'SIDFAKE'])
  assert.ok(!out.includes('tk_FAKE_123'))
  assert.ok(!out.includes('SIDFAKE'))
})

test('export 输出结构化 JSON 与 exportedAt', () => {
  const b = new TelemetryBuffer(new FakeClock(7_000))
  b.setEnabled(true)
  b.record('boot')
  const parsed = JSON.parse(b.export()) as { exportedAt: number; events: Array<{ kind: string }> }
  assert.equal(parsed.exportedAt, 7_000)
  assert.equal(parsed.events.length, 1)
  assert.equal(parsed.events[0]?.kind, 'boot')
})

test('clear 清空缓冲但保持开关状态', () => {
  const b = new TelemetryBuffer(new FakeClock())
  b.setEnabled(true)
  b.record('a')
  b.clear()
  assert.equal(b.size, 0)
  assert.equal(b.isEnabled(), true)
})

test('事件时间戳来自注入时钟', () => {
  const clock = new FakeClock(1_000)
  const b = new TelemetryBuffer(clock)
  b.setEnabled(true)
  b.record('a')
  clock.nowMs = 2_000
  b.record('b')
  const parsed = JSON.parse(b.export()) as { events: Array<{ ts: number }> }
  assert.equal(parsed.events[0]?.ts, 1_000)
  assert.equal(parsed.events[1]?.ts, 2_000)
})

test('detail 缺省时导出为空串', () => {
  const b = new TelemetryBuffer(new FakeClock())
  b.setEnabled(true)
  b.record('boot')
  const parsed = JSON.parse(b.export()) as { events: Array<{ detail: string }> }
  assert.equal(parsed.events[0]?.detail, '')
})
