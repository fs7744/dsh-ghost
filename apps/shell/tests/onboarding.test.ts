/**
 * 首启向导单测（C5-11）：步骤模型、校验、产出可落盘配置。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  answerStep, backStep, buildInitialConfig, createOnboarding, currentStep,
  isComplete, ONBOARDING_STEPS, validateAnswer,
} from '../src/onboarding.ts'

function answerAll() {
  let s = createOnboarding()
  s = answerStep(s, 'welcome', null)
  s = answerStep(s, 'modelSource', 'byok')
  s = answerStep(s, 'workspace', 'D:/work')
  s = answerStep(s, 'approval', 'workspace-write')
  s = answerStep(s, 'infoSources', { github: true, webhook: false, local: true })
  return s
}

test('初始状态停在 welcome 步骤', () => {
  const s = createOnboarding()
  assert.equal(currentStep(s), 'welcome')
  assert.equal(isComplete(s), false)
  assert.deepEqual(s.errors, [])
})

test('合法走完全部步骤后 isComplete 为真', () => {
  const s = answerAll()
  assert.equal(currentStep(s), 'done')
  assert.equal(isComplete(s), true)
  assert.deepEqual(s.errors, [])
})

test('非法 modelSource 被拒绝且不推进', () => {
  let s = createOnboarding()
  s = answerStep(s, 'welcome', null)
  const bad = answerStep(s, 'modelSource', 'unknown-provider')
  assert.equal(currentStep(bad), 'modelSource')
  assert.ok(bad.errors.includes('invalid:modelSource'))
})

test('空工作目录被拒绝', () => {
  let s = createOnboarding()
  s = answerStep(s, 'welcome', null)
  s = answerStep(s, 'modelSource', 'byok')
  const bad = answerStep(s, 'workspace', '   ')
  assert.equal(currentStep(bad), 'workspace')
  assert.ok(bad.errors.includes('invalid:workspaceDir'))
})

test('跳步作答被拒绝（不能越过当前步骤）', () => {
  const s = answerStep(createOnboarding(), 'approval', 'workspace-write')
  assert.ok(s.errors.some(e => e.startsWith('out-of-order:')))
  assert.equal(currentStep(s), 'welcome')
})

test('infoSources 拒绝未知键与非布尔值', () => {
  const a = validateAnswer('infoSources', { github: true, unknown: true })
  const b = validateAnswer('infoSources', { github: 'yes' })
  assert.ok(a.some(e => e.includes('unknown')))
  assert.ok(b.some(e => e.includes('github')))
})

test('welcome 与 done 步骤无需输入校验', () => {
  assert.deepEqual(validateAnswer('welcome', null), [])
  assert.deepEqual(validateAnswer('done', 42), [])
})

test('backStep 回退到上一步并清空错误', () => {
  let s = createOnboarding()
  s = answerStep(s, 'welcome', null)
  s = answerStep(s, 'modelSource', 'byok')
  const back = backStep(s)
  assert.equal(currentStep(back), 'modelSource')
  assert.deepEqual(back.errors, [])
})

test('buildInitialConfig 产出可落盘的初始配置与完成标记', () => {
  const cfg = buildInitialConfig(answerAll())
  assert.equal(cfg.modelSource, 'byok')
  assert.equal(cfg.workspaceDir, 'D:/work')
  assert.equal(cfg.approvalPreset, 'workspace-write')
  assert.deepEqual(cfg.infoSources, { github: true, webhook: false, local: true })
  assert.equal(cfg.onboardingCompleted, true)
})

test('向导未完成时不产出配置，直接拒绝', () => {
  assert.throws(() => buildInitialConfig(createOnboarding()))
})

test('步骤顺序固定为六步', () => {
  assert.deepEqual([...ONBOARDING_STEPS], ['welcome', 'modelSource', 'workspace', 'approval', 'infoSources', 'done'])
})

test('回退后重新作答会覆盖旧答案', () => {
  let s = createOnboarding()
  s = answerStep(s, 'welcome', null)
  s = answerStep(s, 'modelSource', 'byok')
  s = backStep(s)
  assert.equal(currentStep(s), 'modelSource')
  s = answerStep(s, 'modelSource', 'local')
  assert.equal(s.answers.modelSource, 'local')
})
