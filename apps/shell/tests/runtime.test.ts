/**
 * runtime 子进程管理单测（C5-02 / C5-09）：退避、状态机、健康检查、
 * 崩溃重启、状态锁。全部用假子进程/假探测/假时钟，不启动真实 harness。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  acquireStateLock, backoffDelay, DEFAULT_BACKOFF, releaseStateLock,
  RuntimeController, type BackoffPolicy, type RuntimeDeps, type RuntimeState,
} from '../src/runtime.ts'
import {
  FakeClock, FakeFs, FakeLauncher, FakeLogger, FakePorts, FakeProbe, FakeSleeper, settle,
} from './fakes.ts'

interface Harness {
  deps: RuntimeDeps
  states: RuntimeState[]
  ready: string[]
  fatal: Error[]
  launcher: FakeLauncher
  probe: FakeProbe
  sleeper: FakeSleeper
  logger: FakeLogger
  clock: FakeClock
}

function harness(opts?: {
  probeResults?: readonly boolean[]
  policy?: BackoffPolicy
  healthAttempts?: number
}): Harness {
  const states: RuntimeState[] = []
  const ready: string[] = []
  const fatal: Error[] = []
  const launcher = new FakeLauncher()
  const probe = new FakeProbe(opts?.probeResults)
  const sleeper = new FakeSleeper()
  const logger = new FakeLogger()
  const clock = new FakeClock()
  const deps: RuntimeDeps = {
    ports: new FakePorts(),
    launcher,
    probe,
    clock,
    sleeper,
    logger,
    policy: opts?.policy ?? { ...DEFAULT_BACKOFF },
    healthAttempts: opts?.healthAttempts ?? 3,
    healthIntervalMs: 10,
    onState: s => { states.push(s) },
    onReady: i => { ready.push(i.token) },
    onFatal: e => { fatal.push(e) },
  }
  return { deps, states, ready, fatal, launcher, probe, sleeper, logger, clock }
}

test('backoffDelay 按指数增长并以 maxMs 封顶', () => {
  const policy: BackoffPolicy = { baseMs: 100, factor: 2, maxMs: 800, maxRestarts: 5 }
  assert.equal(backoffDelay(0, policy), 100)
  assert.equal(backoffDelay(1, policy), 200)
  assert.equal(backoffDelay(2, policy), 400)
  assert.equal(backoffDelay(3, policy), 800)
  assert.equal(backoffDelay(9, policy), 800)
})

test('backoffDelay 对负数/NaN/零基数不产生 NaN 或负值', () => {
  const policy = { ...DEFAULT_BACKOFF }
  assert.equal(backoffDelay(-5, policy), 500)
  assert.ok(backoffDelay(Number.NaN, policy) >= 0)
  assert.equal(backoffDelay(2, { ...policy, baseMs: 0 }), 0)
})

test('启动成功：状态序列 starting->healthy，一次性 token 只注入一次', async () => {
  const h = harness()
  const c = new RuntimeController(h.deps)
  await c.start()
  assert.equal(c.getState(), 'healthy')
  assert.deepEqual(h.states, ['starting', 'healthy'])
  assert.equal(h.ready.length, 1)
  assert.match(h.ready[0] ?? '', /^tk_1_FAKE$/)
  assert.equal(c.getCurrentInfo()?.port, 41_001)
  assert.equal(h.probe.calls.length, 1)
})

test('健康检查前两次失败第三次成功仍进入 healthy 且产生等待', async () => {
  const h = harness({ probeResults: [false, false, true] })
  const c = new RuntimeController(h.deps)
  await c.start()
  assert.equal(c.getState(), 'healthy')
  assert.equal(h.probe.calls.length, 3)
  assert.deepEqual(h.sleeper.waits, [10, 10])
})

test('启动健康检查全失败会退避重启，重启后换发新 token', async () => {
  const h = harness({ probeResults: [false, false, false, true], healthAttempts: 3 })
  const c = new RuntimeController(h.deps)
  await c.start()
  assert.equal(c.getState(), 'healthy')
  assert.equal(c.getRestartCount(), 1)
  assert.equal(h.ready.length, 1)
  assert.match(h.ready[0] ?? '', /^tk_2_FAKE$/)
  assert.ok(h.states.includes('restarting'))
})

test('运行期崩溃触发退避重启并注入新的一次性 token', async () => {
  const h = harness()
  const c = new RuntimeController(h.deps)
  await c.start()
  const first = h.launcher.last
  assert.ok(first !== null)
  first.emitExit(1)
  await settle()
  assert.equal(c.getState(), 'healthy')
  assert.equal(c.getRestartCount(), 1)
  assert.equal(h.ready.length, 2)
  assert.notEqual(h.ready[0], h.ready[1])
  assert.match(h.ready[1] ?? '', /^tk_2_FAKE$/)
  assert.equal(first.killed, true)
})

test('exit 与 error 双触发只产生一次重启（防并发重启）', async () => {
  const h = harness()
  const c = new RuntimeController(h.deps)
  await c.start()
  const first = h.launcher.last
  assert.ok(first !== null)
  first.emitExit(1)
  first.emitError(new Error('boom'))
  await settle()
  assert.equal(c.getRestartCount(), 1)
})

test('连续崩溃超过 maxRestarts 进入 failed 并回调 onFatal', async () => {
  const h = harness({ policy: { baseMs: 1, factor: 2, maxMs: 2, maxRestarts: 2 } })
  const c = new RuntimeController(h.deps)
  await c.start()
  for (let i = 0; i < 5 && c.getState() !== 'failed'; i += 1) {
    const last = h.launcher.last
    if (last !== null) last.emitExit(1)
    await settle()
  }
  assert.equal(c.getState(), 'failed')
  assert.equal(h.fatal.length, 1)
  assert.equal(c.getRestartCount(), 2)
})

test('主动 stop 后崩溃回调失效，不再重启', async () => {
  const h = harness()
  const c = new RuntimeController(h.deps)
  await c.start()
  const first = h.launcher.last
  c.stop()
  assert.equal(c.getState(), 'stopped')
  if (first !== null) first.emitExit(1)
  await settle()
  assert.equal(c.getRestartCount(), 0)
  assert.equal(h.ready.length, 1)
})

test('状态锁：首启获得、他人占用拒绝、stale 回收、仅自己可释放', () => {
  const fs = new FakeFs()
  const clock = new FakeClock(10_000)
  const deps = { fs, clock, pidAlive: (pid: number) => pid === 111 || pid === 222, staleAfterMs: 5_000 }
  assert.deepEqual(acquireStateLock('C:/state', 111, deps), { acquired: true, reason: 'acquired' })
  assert.deepEqual(acquireStateLock('C:/state', 222, deps), { acquired: false, reason: 'in-use' })
  clock.nowMs = 20_000
  const reclaimed = acquireStateLock('C:/state', 222, deps)
  assert.equal(reclaimed.reason, 'stale-reclaimed')
  assert.equal(releaseStateLock('C:/state', 111, deps), false)
  assert.equal(releaseStateLock('C:/state', 222, deps), true)
  assert.equal(fs.exists('C:/state/runtime.lock'), false)
})

test('状态锁：pid 已死或锁文件损坏都按 stale 回收', () => {
  const fs = new FakeFs()
  const clock = new FakeClock(10_000)
  const deps = { fs, clock, pidAlive: () => false, staleAfterMs: 999_999 }
  fs.writeFile('C:/state/runtime.lock', '{broken')
  assert.equal(acquireStateLock('C:/state', 333, deps).reason, 'stale-reclaimed')
  fs.writeFile('C:/state/runtime.lock', JSON.stringify({ pid: 999, ts: 10_000 }))
  assert.equal(acquireStateLock('C:/state', 333, deps).reason, 'stale-reclaimed')
})
