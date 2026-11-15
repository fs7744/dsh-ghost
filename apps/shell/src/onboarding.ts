/**
 * 首启向导（C5-11）：把 SETUP 问答变成 GUI 的步骤模型与纯逻辑。
 * 产出可落盘的初始配置（由 config.mergeConfig 写入）；渲染部分在 onboarding.html。
 * 零 DOM、零 electron；步骤状态机与校验都是纯函数，便于单测。
 */
import type { ApprovalPreset, ModelSource, ShellConfig } from './config.ts'

export type OnboardingStepId =
  | 'welcome' | 'modelSource' | 'workspace' | 'approval' | 'infoSources' | 'done'

export const ONBOARDING_STEPS: readonly OnboardingStepId[] = [
  'welcome', 'modelSource', 'workspace', 'approval', 'infoSources', 'done',
]

export const INFO_SOURCE_KEYS = ['github', 'webhook', 'local'] as const

const APPROVALS: readonly string[] = ['workspace-write', 'danger-full-access', 'read-only']
const MODEL_SOURCES: readonly string[] = ['byok', 'local', 'deepseek-account']

export interface OnboardingAnswers {
  modelSource?: ModelSource
  workspaceDir?: string
  approvalPreset?: ApprovalPreset
  infoSources?: Record<string, boolean>
}

export interface OnboardingState {
  index: number
  answers: OnboardingAnswers
  errors: string[]
}

export function createOnboarding(): OnboardingState {
  return { index: 0, answers: {}, errors: [] }
}

export function currentStep(state: OnboardingState): OnboardingStepId {
  return ONBOARDING_STEPS[state.index] ?? 'done'
}

function requiredAnswersPresent(a: OnboardingAnswers): boolean {
  return a.modelSource !== undefined && a.workspaceDir !== undefined &&
    a.approvalPreset !== undefined && a.infoSources !== undefined
}

export function isComplete(state: OnboardingState): boolean {
  return currentStep(state) === 'done' && requiredAnswersPresent(state.answers)
}

/** 单步校验：返回错误码列表；welcome / done 无需输入。 */
export function validateAnswer(step: OnboardingStepId, value: unknown): string[] {
  const errors: string[] = []
  switch (step) {
    case 'welcome':
    case 'done':
      return errors
    case 'modelSource':
      if (typeof value !== 'string' || !MODEL_SOURCES.includes(value)) errors.push('invalid:modelSource')
      break
    case 'workspace':
      if (typeof value !== 'string' || value.trim() === '' || value.includes('\0')) {
        errors.push('invalid:workspaceDir')
      }
      break
    case 'approval':
      if (typeof value !== 'string' || !APPROVALS.includes(value)) errors.push('invalid:approvalPreset')
      break
    case 'infoSources': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        errors.push('invalid:infoSources')
        break
      }
      const obj = value as Record<string, unknown>
      for (const [key, val] of Object.entries(obj)) {
        if (!(INFO_SOURCE_KEYS as readonly string[]).includes(key) || typeof val !== 'boolean') {
          errors.push(`invalid:infoSources:${key}`)
        }
      }
      break
    }
  }
  return errors
}

/** 只接受当前步骤：跳步拒绝；校验失败不推进；成功记录答案并前进一步。 */
export function answerStep(
  state: OnboardingState,
  step: OnboardingStepId,
  value: unknown,
): OnboardingState {
  if (currentStep(state) !== step) return { ...state, errors: [`out-of-order:${step}`] }
  const errors = validateAnswer(step, value)
  if (errors.length > 0) return { ...state, errors }
  const answers: OnboardingAnswers = { ...state.answers }
  switch (step) {
    case 'modelSource':
      answers.modelSource = value as ModelSource
      break
    case 'workspace':
      answers.workspaceDir = value as string
      break
    case 'approval':
      answers.approvalPreset = value as ApprovalPreset
      break
    case 'infoSources':
      answers.infoSources = value as Record<string, boolean>
      break
    default:
      break
  }
  return { index: state.index + 1, answers, errors: [] }
}

export function backStep(state: OnboardingState): OnboardingState {
  return { ...state, index: Math.max(0, state.index - 1), errors: [] }
}

/** 仅在向导完成后产出初始配置片段；未完成直接拒绝产出。 */
export function buildInitialConfig(state: OnboardingState): Partial<ShellConfig> {
  if (!isComplete(state)) throw new Error('onboarding incomplete')
  const a = state.answers
  if (a.modelSource === undefined || a.workspaceDir === undefined ||
      a.approvalPreset === undefined || a.infoSources === undefined) {
    throw new Error('onboarding incomplete')
  }
  return {
    modelSource: a.modelSource,
    workspaceDir: a.workspaceDir,
    approvalPreset: a.approvalPreset,
    infoSources: a.infoSources,
    onboardingCompleted: true,
  }
}
