/** B7-03 SETUP 12 步计划 + B7-02 自检与 status 退出码。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SETUP_STEPS, buildSetupPlan, executeSetupPlan, runSetup } from '../src/infra/setup.ts'
import type { SetupIO, SetupStep } from '../src/infra/setup.ts'
import { runSelfCheck, EXIT_OK, EXIT_INCOMPLETE, EXIT_SECURITY } from '../src/infra/selfcheck.ts'
import { parseArgs, runService } from '../src/infra/service.ts'

/** 假 IO + 假 executor：问答、计划、执行三段都能确定性断言。 */
function harness(answers: Record<string, string> = {}) {
  const logs: string[] = []
  const asked: string[] = []
  const applied: SetupStep[] = []
  const setupIO: SetupIO = {
    ask: question => { asked.push(question.id); return answers[question.id] ?? '' },
    log: message => { logs.push(message) },
  }
  const executor = { apply: (step: SetupStep) => { applied.push(step) } }
  return { setupIO, logs, asked, applied, executor }
}

const good = {
  stateDirReady: true,
  env: { GH_WEBHOOK_SECRET: 'placeholder' } as NodeJS.ProcessEnv,
  assetsReady: true,
  selfBuiltRoutes: [],
}

test('SETUP 是 12 步、id 唯一、每步都有默认值', () => {
  assert.equal(SETUP_STEPS.length, 12)
  assert.equal(new Set(SETUP_STEPS.map(step => step.id)).size, 12)
  for (const step of SETUP_STEPS) {
    assert.ok(step.prompt.length > 0)
    assert.ok(step.defaultAnswer.length > 0)
  }
})

test('空答案的 12 步计划全部采用默认值、无错误', () => {
  const plan = buildSetupPlan({})
  assert.equal(plan.steps.length, 12)
  assert.equal(plan.errors.length, 0)
  assert.equal(plan.answers['serviceName'], 'dsh-superagent')
  assert.equal(plan.answers['feishuEnabled'], 'no')
})

test('非法答案记进 errors 且不进入可执行步骤', () => {
  const plan = buildSetupPlan({ serviceName: 'BAD NAME', stateDir: '../escape', watchIntervalMinutes: '0' })
  const ids = plan.errors.map(error => error.id)
  assert.ok(ids.includes('serviceName'))
  assert.ok(ids.includes('stateDir'))
  assert.ok(ids.includes('watchIntervalMinutes'))
  assert.equal(plan.steps.length, 9)
  assert.ok(plan.errors.every(error => error.reason.length > 0))
})

test('executeSetupPlan 只应用合法步骤并把跳过原因写进日志', () => {
  const h = harness()
  const plan = buildSetupPlan({ serviceName: 'BAD NAME' })
  const result = executeSetupPlan(plan, h.executor, h.setupIO)
  assert.equal(result.applied, 11)
  assert.equal(result.skipped, 1)
  assert.equal(h.applied.length, 11)
  assert.ok(h.logs.some(line => line.includes('跳过 serviceName')))
})

test('runSetup 全默认跑完 12 步：问 12 次、应用 12 步', async () => {
  const h = harness()
  const result = await runSetup(h.setupIO, h.executor)
  assert.equal(h.asked.length, 12)
  assert.equal(result.applied, 12)
  assert.equal(result.skipped, 0)
  assert.deepEqual(h.applied.map(step => step.id), SETUP_STEPS.map(step => step.id))
})

test('runSetup 遇到一个非法答案跳过该步并说明', async () => {
  const h = harness({ watchIntervalMinutes: '9999' })
  const result = await runSetup(h.setupIO, h.executor)
  assert.equal(result.applied, 11)
  assert.equal(result.skipped, 1)
  assert.equal(result.errors[0]?.id, 'watchIntervalMinutes')
})

test('自检全绿退出码 0', () => {
  const result = runSelfCheck(good)
  assert.equal(result.ok, true)
  assert.equal(result.exitCode, EXIT_OK)
  assert.equal(result.checks.length, 8)
  assert.match(result.summary, /配置完整/)
})

test('缺状态目录退出码 1 且原因点名 stateDir', () => {
  const result = runSelfCheck({ ...good, stateDirReady: false })
  assert.equal(result.exitCode, EXIT_INCOMPLETE)
  assert.match(result.summary, /stateDir/)
  assert.match(result.summary, /状态目录未就绪/)
})

test('密钥缺项退出码 1：GitHub 未配、飞书启用未配都点名环境变量', () => {
  const gh = runSelfCheck({ ...good, env: {} })
  assert.equal(gh.exitCode, EXIT_INCOMPLETE)
  assert.match(gh.summary, /GH_WEBHOOK_SECRET/)
  const feishu = runSelfCheck({ ...good, env: { GH_WEBHOOK_SECRET: 'x', DSH_FEISHU_ENABLED: 'yes' } })
  assert.equal(feishu.exitCode, EXIT_INCOMPLETE)
  assert.match(feishu.summary, /FEISHU_WEBHOOK_SECRET/)
})

test('自建 /orchestrator 路由触发安全红线退出码 2', () => {
  const result = runSelfCheck({ ...good, selfBuiltRoutes: ['src/bad-route.ts'] })
  assert.equal(result.exitCode, EXIT_SECURITY)
  assert.match(result.summary, /bad-route\.ts/)
  assert.equal(result.checks.find(item => item.id === 'orchestratorRoute')?.severity, 'security')
})

test('parseArgs 识别四个命令，未知落到 help', () => {
  assert.equal(parseArgs(['start']), 'start')
  assert.equal(parseArgs(['stop']), 'stop')
  assert.equal(parseArgs(['status']), 'status')
  assert.equal(parseArgs(['restart']), 'restart')
  assert.equal(parseArgs([]), 'help')
  assert.equal(parseArgs(['nope']), 'help')
})

test('status 子命令把自检退出码 0 / 1 / 2 原样透传', () => {
  const io = { log: () => {} }
  const status = (result: ReturnType<typeof runSelfCheck>) => runService('status', {
    executor: { start: () => {}, stop: () => {}, isRunning: () => false, selfCheck: () => result },
    io,
  })
  assert.equal(status(runSelfCheck(good)), EXIT_OK)
  assert.equal(status(runSelfCheck({ ...good, stateDirReady: false })), EXIT_INCOMPLETE)
  assert.equal(status(runSelfCheck({ ...good, selfBuiltRoutes: ['bad.ts'] })), EXIT_SECURITY)
})
