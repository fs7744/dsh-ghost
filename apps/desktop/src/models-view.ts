/**
 * 模型管理页的纯逻辑（C3-01/02/03/05 的界面侧视图模型）。
 *
 * 零 DOM、零网络：数据由 ModelsHost（fetch /api/...）注入，无后端时降级到
 * 内置 DEMO_STATE 并标 demo。类型形状与 packages/model-manager 对齐，
 * 但刻意不 import 该包，保持独立页面可以被 check:ui 单独检查。
 * 凭据只渲染 env 引用名，任何非 env 名（包括明文）都隐藏，绝不显示明文。
 */

export interface ModelCapabilitiesView {
  contextWindow: number
  maxTokens: number
  reasoningEfforts: readonly string[]
}

export interface ModelView {
  id: string
  name: string
  capabilities: ModelCapabilitiesView
}

export interface ProviderView {
  id: string
  displayName: string
  api: string
  baseURL: string
  /** 只允许环境变量引用名，不落明文。 */
  apiKeyEnv: string
  models: readonly ModelView[]
}

export type ModelRole = 'router' | 'worker'

export interface RoleBindingView {
  role: ModelRole
  providerId: string
  modelId: string
}

export interface ModelsState {
  providers: readonly ProviderView[]
  bindings: readonly RoleBindingView[]
  /** true 表示展示的是内置示例数据，没有连到后端。 */
  demo: boolean
}

/** 无后端时的内置示例数据（标 demo）。不含任何明文凭据。 */
export const DEMO_STATE: ModelsState = {
  demo: true,
  providers: [
    {
      id: 'wb',
      displayName: 'WorkBuddy Gateway',
      api: 'openai-completions',
      baseURL: 'http://127.0.0.1:7864/v1',
      apiKeyEnv: 'WB_KEY',
      models: [
        { id: 'hy3', name: 'hy3', capabilities: { contextWindow: 192000, maxTokens: 8192, reasoningEfforts: [] } },
        { id: 'reasoner', name: 'DeepSeek Reasoner', capabilities: { contextWindow: 128000, maxTokens: 8192, reasoningEfforts: ['low', 'medium', 'high'] } },
      ],
    },
    {
      id: 'ollama',
      displayName: 'Ollama (local)',
      api: 'openai-completions',
      baseURL: 'http://127.0.0.1:11434/v1',
      apiKeyEnv: 'OLLAMA_API_KEY',
      models: [
        { id: 'llama3.1', name: 'Llama 3.1', capabilities: { contextWindow: 128000, maxTokens: 8192, reasoningEfforts: [] } },
      ],
    },
  ],
  bindings: [
    { role: 'router', providerId: 'wb', modelId: 'hy3' },
    { role: 'worker', providerId: 'wb', modelId: 'reasoner' },
  ],
}

export const MODEL_ROLES: readonly ModelRole[] = ['router', 'worker']

export function parseModelRole(value: string): ModelRole | undefined {
  return value === 'router' || value === 'worker' ? value : undefined
}

export interface FlatModel {
  providerId: string
  providerName: string
  model: ModelView
}

/** 展开成一行一模型的列表，供模型库与角色下拉共用。 */
export function flattenModels(state: ModelsState): FlatModel[] {
  return state.providers.flatMap(provider =>
    provider.models.map(model => ({ providerId: provider.id, providerName: provider.displayName, model })))
}

export interface ResolvedRoleView {
  provider: ProviderView
  model: ModelView
}

/** 解析某角色当前绑定的具体模型；绑定失效返回 undefined。 */
export function resolveRoleView(state: ModelsState, role: ModelRole): ResolvedRoleView | undefined {
  const binding = state.bindings.find(item => item.role === role)
  if (binding === undefined) return undefined
  const provider = state.providers.find(item => item.id === binding.providerId)
  if (provider === undefined) return undefined
  const model = provider.models.find(item => item.id === binding.modelId)
  if (model === undefined) return undefined
  return { provider, model }
}

/** 校验一条角色绑定；返回错误列表，空数组即合法。 */
export function validateBindingView(state: ModelsState, binding: RoleBindingView): string[] {
  const errors: string[] = []
  if (parseModelRole(binding.role) === undefined) errors.push('非法角色')
  const provider = state.providers.find(item => item.id === binding.providerId)
  if (provider === undefined) errors.push('provider 不存在')
  else if (!provider.models.some(model => model.id === binding.modelId)) errors.push('模型不存在')
  return errors
}

/** 纯函数地替换 / 新增一条角色绑定（同角色只留最新一条）。 */
export function updateBindingView(state: ModelsState, binding: RoleBindingView): ModelsState {
  return { ...state, bindings: [...state.bindings.filter(item => item.role !== binding.role), binding] }
}

const short = (value: number): string => (value >= 1024 ? `${Math.round(value / 1024)}K` : String(value))

/** 能力标注的可读文本：上下文 / 输出上限 / 思考档位。 */
export function formatCapabilities(caps: ModelCapabilitiesView): string {
  const effort = caps.reasoningEfforts.length > 0 ? ` / 思考 ${caps.reasoningEfforts.join(',')}` : ''
  return `${short(caps.contextWindow)} 上下文 / ${short(caps.maxTokens)} 输出${effort}`
}

export const ENV_REF = /^[A-Z][A-Z0-9_]{1,63}$/

/** 只把 env 引用名渲染出来；任何非 env 名（含明文）统一隐藏。 */
export function credentialRefLabel(value: string): string {
  return ENV_REF.test(value) ? `env:${value}` : '[凭据引用无效]'
}

export type LocalPreset = 'ollama' | 'vllm'
export const LOCAL_PRESETS: readonly LocalPreset[] = ['ollama', 'vllm']

export interface PresetOverrides {
  host?: string
  port?: number
  modelId?: string
}

/** 本地预设一键生成的预览（纯逻辑，形状与 model-manager 的 route 对齐）。 */
export function buildLocalPresetView(preset: LocalPreset, overrides: PresetOverrides = {}): ProviderView {
  const isOllama = preset === 'ollama'
  const host = overrides.host ?? '127.0.0.1'
  const port = overrides.port ?? (isOllama ? 11434 : 8000)
  const modelId = overrides.modelId ?? (isOllama ? 'llama3.1' : 'local-model')
  return {
    id: preset,
    displayName: isOllama ? 'Ollama (local)' : 'vLLM (local)',
    api: 'openai-completions',
    baseURL: `http://${host}:${port}/v1`,
    apiKeyEnv: isOllama ? 'OLLAMA_API_KEY' : 'VLLM_API_KEY',
    models: [{
      id: modelId,
      name: modelId,
      capabilities: {
        contextWindow: isOllama ? 128000 : 32768,
        maxTokens: isOllama ? 8192 : 4096,
        reasoningEfforts: [],
      },
    }],
  }
}

/** 状态栏摘要。 */
export function summary(state: ModelsState): string {
  return `${state.providers.length} 个 provider · ${flattenModels(state).length} 个模型 · ${state.bindings.length} 条角色绑定${state.demo ? ' · demo' : ''}`
}
