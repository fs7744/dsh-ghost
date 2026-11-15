/**
 * 首启向导（C5-11）：把 SETUP 问答变成 GUI 的步骤模型与纯逻辑。
 * 产出可落盘的初始配置（由 config.mergeConfig 写入）；渲染部分在 onboarding.html。
 * 零 DOM、零 electron；步骤状态机与校验都是纯函数，便于单测。
 */
import type { ApprovalPreset, ModelSource, ShellConfig } from './config.ts'

export type OnboardingStepId =
  | 'welcome' | 'modelSource' | 'credential' | 'workspace' | 'approval' | 'infoSources' | 'done'

export const ONBOARDING_STEPS: readonly OnboardingStepId[] = [
  'welcome', 'modelSource', 'credential', 'workspace', 'approval', 'infoSources', 'done',
]

export const INFO_SOURCE_KEYS = ['github', 'webhook', 'local'] as const

const APPROVALS: readonly string[] = ['workspace-write', 'danger-full-access', 'read-only']
const MODEL_SOURCES: readonly string[] = ['byok', 'local', 'deepseek-account']

export interface OnboardingAnswers {
  modelSource?: ModelSource
  /**
   * BYOK 的 API key。**不写进 settings.json**：main 的 IPC 收到后直接交给
   * CredentialVault（safeStorage / DPAPI），配置里只留 modelSource。
   */
  apiKey?: string
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
  const needsKey = a.modelSource === 'byok'
  return a.modelSource !== undefined && a.workspaceDir !== undefined &&
    a.approvalPreset !== undefined && a.infoSources !== undefined &&
    (!needsKey || (a.apiKey !== undefined && a.apiKey !== ''))
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
    case 'credential': {
      // 传 null / 空对象 = 跳过（本地模型或稍后在设置里填）。
      if (value === null || value === undefined) break
      if (typeof value !== 'object' || Array.isArray(value)) { errors.push('invalid:credential'); break }
      const key = (value as { apiKey?: unknown }).apiKey
      if (key === undefined || key === '') break
      if (typeof key !== 'string' || key.includes('\0') || key.length > 4096) {
        errors.push('invalid:credential')
      }
      break
    }
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
  // BYOK 没有 key 进到 done 也没用：在凭据步骤就挡住，而不是 finish 时抛错。
  if (step === 'credential' && state.answers.modelSource === 'byok') {
    const key = (value as { apiKey?: unknown } | null)?.apiKey
    if (typeof key !== 'string' || key.trim() === '') return { ...state, errors: ['credential-required'] }
  }
  const answers: OnboardingAnswers = { ...state.answers }
  switch (step) {
    case 'modelSource':
      answers.modelSource = value as ModelSource
      break
    case 'credential': {
      const key = (value as { apiKey?: unknown } | null)?.apiKey
      if (typeof key === 'string' && key.trim() !== '') answers.apiKey = key.trim()
      break
    }
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
