/**
 * test:script-runtime —— C9-10 脚本运行时 / C9-11 输出协议 / C9-12 references 分层。
 * 全部用可注入 runner 与内存文件，绝不启动真实子进程、绝不读写磁盘。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CODES, coerceOutput, createReferences, createRuntime, failure, formatOutput,
  helpLine, isHelp, parseOutput, runScript, success,
  type Runner, type RunnerResult,
} from '../src/index.ts'

const root = '/pkg'
const okResult = (stdout: string): RunnerResult => ({ stdout, stderr: '', exitCode: 0, timedOut: false })
const okRunner = (stdout: string): Runner => async () => okResult(stdout)

test('C9-10/11 成功：runner 返回协议 JSON，结果 ok 且 code=OK', async () => {
  const outcome = await runScript(
    { script: 'scripts/verify.mjs' },
    { packageRoot: root, runner: okRunner(formatOutput(success({ count: 3 }))) },
  )
  assert.equal(outcome.ok, true)
  assert.equal(outcome.code, CODES.OK)
  assert.match(outcome.output ?? '', /"code":"OK"/)
  assert.equal(outcome.idempotentHit, false)
})

test('C9-10/11 失败自解释：脚本的 fix/hint 原样透传', async () => {
  const outcome = await runScript(
    { script: 'scripts/verify.mjs' },
    { packageRoot: root, runner: okRunner(formatOutput(failure('EBUILD', { fix: '先跑构建', hint: '看 references/build.md' }))) },
  )
  assert.equal(outcome.ok, false)
  assert.equal(outcome.code, 'EBUILD')
  assert.equal(outcome.fix, '先跑构建')
  assert.equal(outcome.hint, '看 references/build.md')
})

test('C9-10 超时：注入一个永不结束的 runner，也必须按时 ETIMEDOUT', async () => {
  const hanging: Runner = () => new Promise<RunnerResult>(() => {})
  const outcome = await runScript(
    { script: 'scripts/slow.mjs', timeoutMs: 30 },
    { packageRoot: root, runner: hanging },
  )
  assert.equal(outcome.ok, false)
  assert.equal(outcome.code, CODES.ETIMEDOUT)
  assert.equal(outcome.timedOut, true)
  assert.match(outcome.fix ?? '', /30ms/)
})

test('C9-10 runner 抛错归一化成 EEXEC', async () => {
  const broken: Runner = async () => { throw new Error('spawn failed') }
  const outcome = await runScript({ script: 'scripts/x.mjs' }, { packageRoot: root, runner: broken })
  assert.equal(outcome.code, CODES.EEXEC)
  assert.match(outcome.fix ?? '', /spawn failed/)
})

test('C9-10 安全闸门：扩展名白名单 / 绝对路径 / .. 逃逸都被拒', async () => {
  let calls = 0
  const runner: Runner = async () => { calls += 1; return okResult(formatOutput(success())) }
  const opts = { packageRoot: root, runner }
  assert.equal((await runScript({ script: 'scripts/x.sh' }, opts)).code, CODES.EEXT)
  assert.equal((await runScript({ script: '/tmp/x.mjs' }, opts)).code, CODES.EPATH)
  assert.equal((await runScript({ script: '../../etc/x.mjs' }, opts)).code, CODES.EPATH)
  assert.equal(calls, 0, '被拒的请求绝不能落到 runner')
})

test('C9-10 输出字节上限：超限截断并给提示', async () => {
  const huge = 'x'.repeat(5000)
  const outcome = await runScript(
    { script: 'scripts/x.mjs' },
    { packageRoot: root, maxOutputBytes: 64, runner: okRunner(huge) },
  )
  assert.match(outcome.hint ?? '', /截断/)
  assert.ok((outcome.output ?? '').length < huge.length)
  assert.ok((outcome.output ?? '').length <= 64)
})

test('C9-10 幂等键：相同键+相同请求只真正跑一次', async () => {
  let calls = 0
  const runner: Runner = async () => { calls += 1; return okResult(formatOutput(success())) }
  const runtime = createRuntime({ packageRoot: root, runner })
  const first = await runtime.run({ script: 'scripts/a.mjs', idempotencyKey: 'K1' })
  const second = await runtime.run({ script: 'scripts/a.mjs', idempotencyKey: 'K1' })
  assert.equal(first.ok, true)
  assert.equal(second.idempotentHit, true)
  assert.equal(calls, 1)
  assert.equal(second.code, first.code)
})

test('C9-10 幂等键误用：同一键对应不同请求被拒', async () => {
  const runtime = createRuntime({ packageRoot: root, runner: okRunner(formatOutput(success())) })
  await runtime.run({ script: 'scripts/a.mjs', idempotencyKey: 'K' })
  const mismatched = await runtime.run({ script: 'scripts/b.mjs', idempotencyKey: 'K' })
  assert.equal(mismatched.code, CODES.EIDEMPOTENT)
  assert.equal(mismatched.ok, false)
})

test('C9-10 并发上限：5 个并发请求峰值不超过 2', async () => {
  let active = 0
  let peak = 0
  const runner: Runner = async () => {
    active += 1
    peak = Math.max(peak, active)
    await new Promise(resolve => setTimeout(resolve, 10))
    active -= 1
    return okResult(formatOutput(success()))
  }
  const runtime = createRuntime({ packageRoot: root, maxConcurrency: 2, runner })
  await Promise.all(Array.from({ length: 5 }, (_, index) => runtime.run({ script: `scripts/s${index}.mjs` })))
  assert.ok(peak <= 2, `并发峰值 ${peak} 超过上限`)
  assert.ok(peak >= 2, '确实发生了并发')
})

test('C9-11 --help：只回一行摘要，不启动 runner', async () => {
  let calls = 0
  const runner: Runner = async () => { calls += 1; return okResult(formatOutput(success())) }
  const outcome = await runScript(
    { script: 'scripts/verify.mjs', args: ['--help'] },
    { packageRoot: root, runner },
  )
  assert.equal(outcome.code, CODES.HELP)
  assert.equal(calls, 0)
  assert.ok(!(outcome.output ?? '').includes('\n'))
})

test('C9-11 协议纯函数：编解码、脏行、非协议输出、一行摘要', () => {
  assert.deepEqual(parseOutput(formatOutput(success({ a: 1 }))), { ok: true, code: CODES.OK, data: { a: 1 } })
  assert.equal(parseOutput('definitely not json'), undefined)
  assert.equal(parseOutput('前置日志\n{"ok":false,"code":"X"}')?.code, 'X')
  assert.equal(coerceOutput('乱输出').code, CODES.EPROTOCOL)
  assert.ok(!helpLine('verify.mjs', '一行\n说明').includes('\n'))
  assert.ok(helpLine('v', 's').length <= 160)
  assert.equal(isHelp(['--help']), true)
  assert.equal(isHelp(['run']), false)
})

test('C9-12 references：索引常驻、单文件按需、超限截断给提示', () => {
  const refs = createReferences(
    { 'a.md': 'hello', 'big.md': 'z'.repeat(100) },
    { maxFileBytes: 10 },
  )
  const index = refs.index()
  assert.deepEqual(index.map(item => item.name), ['a.md', 'big.md'])
  assert.ok(index.every(item => typeof item.bytes === 'number'))
  assert.equal(index.find(item => item.name === 'big.md')?.bytes, 100)

  const loaded = refs.load('big.md')
  assert.equal(loaded?.truncated, true)
  assert.match(loaded?.hint ?? '', /截断/)
  assert.ok((loaded?.content ?? '').length <= 10)
  assert.equal(loaded?.totalBytes, 100)
  assert.equal(refs.load('a.md')?.truncated, false)
  assert.equal(refs.load('missing.md'), undefined)
})
