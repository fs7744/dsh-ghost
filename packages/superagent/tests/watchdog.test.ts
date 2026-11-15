/** B7-04 小时级看护：体检、自动拉起、指数退避、失败上限、健康恢复。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_WATCHDOG_INTERVAL_MS, initialWatchdogState, nextBackoffMs,
  watchdogTick, runWatchdog,
} from '../src/infra/watchdog.ts'

test('默认体检间隔是小时级', () => {
  assert.equal(DEFAULT_WATCHDOG_INTERVAL_MS, 3_600_000)
})

test('指数退避序列 1000 / 2000 / 4000 / 8000 / 16000', () => {
  const options = { backoffBaseMs: 1000, backoffMaxMs: 60_000 }
  assert.deepEqual(
    [1, 2, 3, 4, 5].map(failures => nextBackoffMs(failures, options)),
    [1000, 2000, 4000, 8000, 16000],
  )
})

test('退避有封顶，且第 0 次失败按基数处理', () => {
  assert.equal(nextBackoffMs(20, { backoffBaseMs: 1000, backoffMaxMs: 60_000 }), 60_000)
  assert.equal(nextBackoffMs(0, { backoffBaseMs: 1000 }), 1000)
})

test('初始状态计数全为 0', () => {
  assert.deepEqual(initialWatchdogState(), { failures: 0, backoffMs: 0, restarts: 0 })
})

test('体检健康时重置失败计数与退避', () => {
  const state = { failures: 3, backoffMs: 4000, restarts: 3 }
  const result = watchdogTick(state, true)
  assert.deepEqual(result.state, { failures: 0, backoffMs: 0, restarts: 3 })
  assert.equal(result.restarted, false)
  assert.deepEqual(state, { failures: 3, backoffMs: 4000, restarts: 3 }) // 不修改入参
})

test('体检失败时拉起并给出退避', () => {
  const result = watchdogTick(initialWatchdogState(), false, { backoffBaseMs: 1000 })
  assert.equal(result.restarted, true)
  assert.equal(result.state.failures, 1)
  assert.equal(result.state.restarts, 1)
  assert.equal(result.state.backoffMs, 1000)
  assert.match(result.reason, /自动拉起/)
})

test('连续失败超过上限就停止自动拉起并告警', () => {
  let state = initialWatchdogState()
  const options = { maxFailures: 5, backoffBaseMs: 1000 }
  for (let index = 0; index < 5; index++) state = watchdogTick(state, false, options).state
  const last = watchdogTick(state, false, options)
  assert.equal(last.restarted, false)
  assert.equal(last.state.backoffMs, 0)
  assert.match(last.reason, /上限/)
})

test('runWatchdog 全失败：退避按序增长，到第 6 轮因超限停下', () => {
  const restarts: number[] = []
  const ticks = runWatchdog({
    check: () => false, restart: () => { restarts.push(1) },
    sleep: () => {}, log: () => {},
  }, { maxTicks: 8, maxFailures: 5, backoffBaseMs: 1000, backoffMaxMs: 60_000, intervalMs: 1000 })
  assert.deepEqual(ticks.map(tick => tick.backoffMs), [1000, 2000, 4000, 8000, 16000, 0])
  assert.equal(restarts.length, 5)
})

test('runWatchdog 健康恢复后计数归零，下次失败从基数重来', () => {
  const sequence = [false, false, true, false]
  let index = 0
  const ticks = runWatchdog({
    check: () => sequence[index++] ?? false, restart: () => {},
    sleep: () => {}, log: () => {},
  }, { maxTicks: 4, backoffBaseMs: 1000, maxFailures: 5 })
  assert.equal(ticks[2]?.backoffMs, 0)
  assert.equal(ticks[2]?.failures, 0)
  assert.equal(ticks[3]?.backoffMs, 1000)
  assert.equal(ticks[3]?.failures, 1)
})

test('runWatchdog 按间隔 + 退避等待，全健康时不拉起', () => {
  const waits: number[] = []
  let restarts = 0
  const ticks = runWatchdog({
    check: () => true, restart: () => { restarts++ },
    sleep: ms => { waits.push(ms) }, log: () => {},
  }, { maxTicks: 3, intervalMs: 3_600_000 })
  assert.deepEqual(waits, [3_600_000, 3_600_000, 3_600_000])
  assert.equal(restarts, 0)
  assert.ok(ticks.every(tick => tick.backoffMs === 0 && !tick.restarted))
})
