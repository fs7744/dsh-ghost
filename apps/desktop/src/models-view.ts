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

export type BalanceStrategy = 'off' | 'round-robin' | 'random' | 'weighted' | 'failover'

export interface ProviderView {
  id: string
  displayName: string
  api: string
  baseURL: string
  /** 只允许环境变量引用名，不落明文。 */
  apiKeyEnv: string
  models: readonly ModelView[]
  /** 是否参与负载均衡；缺省视为 true。 */
  enabled?: boolean
  /** weighted 策略的权重；缺省 1。 */
  weight?: number
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
  /** 多服务负载均衡策略；缺省 off。 */
  balance?: { strategy: BalanceStrategy }
  /** true 表示展示的是内置示例数据，没有连到后端。 */
  demo: boolean
}

/** 无后端时的内置示例数据（标 demo）。不含任何明文凭据。 */
export const DEMO_STATE: ModelsState = {
  demo: true,
  balance: { strategy: 'off' },
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

/** 负载均衡策略的可选项（与 model-manager 的 BALANCE_STRATEGIES 同口径）。 */
export interface BalanceOption { value: BalanceStrategy; label: string; hint: string }
export const BALANCE_OPTIONS: readonly BalanceOption[] = [
  { value: 'off', label: '单服务直连', hint: '不做分发，所有请求走同一个服务' },
  { value: 'round-robin', label: '轮询', hint: '按顺序轮流使用每个启用的服务' },
  { value: 'random', label: '随机', hint: '每次随机挑一个启用的服务' },
  { value: 'weighted', label: '加权', hint: '按每个服务设置的权重比例分配请求' },
  { value: 'failover', label: '故障转移', hint: '优先用第一个，失败时才切到下一个' },
]

export function balanceLabel(strategy: string | undefined): string {
  return BALANCE_OPTIONS.find(option => option.value === strategy)?.label ?? strategy ?? 'off'
}

/** 状态栏摘要。 */
export function summary(state: ModelsState): string {
  const active = state.providers.filter(provider => provider.enabled !== false).length
  return `${state.providers.length} 个服务（${active} 启用） · ${flattenModels(state).length} 个模型 · ${state.bindings.length} 条职责绑定 · 负载均衡 ${balanceLabel(state.balance?.strategy)}${state.demo ? ' · demo' : ''}`
}

/**
 * 把自动拉取到的模型合并进草稿：按 id 去重，已存在的行保留用户的编辑，
 * 只追加新模型——这正是「自动获取 + 允许修改」的关键语义。
 */
/** 自动拉取结果的视图形状（与 model-manager 的 DiscoveredModel 对齐）。 */
export interface DiscoveredView {
  id: string
  name: string
  capabilities: {
    contextWindow: number
    maxTokens: number
    reasoningEfforts: readonly string[]
  }
}

export function mergeDiscoveredModels(drafts: readonly ModelDraft[], discovered: readonly DiscoveredView[]): ModelDraft[] {
  const existing = new Set(drafts.map(model => model.id.trim()).filter(id => id !== ''))
  const merged = [...drafts]
  for (const model of discovered) {
    if (existing.has(model.id)) continue
    existing.add(model.id)
    merged.push({
      id: model.id,
      name: model.name,
      contextWindow: String(model.capabilities.contextWindow),
      maxTokens: String(model.capabilities.maxTokens),
      reasoningEfforts: model.capabilities.reasoningEfforts.join(','),
    })
  }
  return merged
}

/* ==================== 可编辑服务表单（C3 界面改造） ==================== */
/* 协议标识沿用 harness 的 4 种线协议名，标签用业界通用叫法，方便对号入座。 */

export interface ApiOption { value: string; label: string; hint: string }

export const API_OPTIONS: readonly ApiOption[] = [
  { value: 'openai-completions', label: 'OpenAI 兼容 · Chat Completions', hint: '最通用：OpenAI / DeepSeek / 通义 / 本地 Ollama·vLLM 都走这个' },
  { value: 'openai-responses', label: 'OpenAI · Responses', hint: 'OpenAI 新一代 Responses API' },
  { value: 'anthropic-messages', label: 'Anthropic · Messages', hint: 'Claude 系列 Messages API' },
  { value: 'google-generative-ai', label: 'Google · Gemini', hint: 'Gemini Generative AI API' },
]

export function apiLabel(api: string): string {
  return API_OPTIONS.find(item => item.value === api)?.label ?? api
}

/** 职责（角色）的中文标签与选模建议。职责不同 → 适合的模型不同。 */
export const MODEL_ROLE_INFO: Record<ModelRole, { label: string; hint: string }> = {
  router: { label: '规划 / 路由', hint: '拆解任务、决定用哪个工具。建议推理强、上下文大的模型。' },
  worker: { label: '执行 / 干活', hint: '实际读写文件与产出结果。建议速度快、上下文够用的模型。' },
}

/** 一条待编辑模型（表单里数字用字符串，便于原样回填与校验）。 */
export interface ModelDraft {
  id: string
  name: string
  contextWindow: string
  maxTokens: string
  reasoningEfforts: string
}

/** 一条待编辑服务；apiKey 是明文且只存在于表单内存，绝不写进 ModelsState。 */
export interface ProviderDraft {
  editingId: string
  id: string
  displayName: string
  api: string
  baseURL: string
  apiKey: string
  enabled: boolean
  weight: string
  models: ModelDraft[]
}

export function emptyProviderDraft(): ProviderDraft {
  return {
    editingId: '',
    id: '',
    displayName: '',
    api: 'openai-completions',
    baseURL: '',
    apiKey: '',
    enabled: true,
    weight: '1',
    models: [{ id: '', name: '', contextWindow: '128000', maxTokens: '8192', reasoningEfforts: '' }],
  }
}

export function providerToDraft(provider: ProviderView): ProviderDraft {
  return {
    editingId: provider.id,
    id: provider.id,
    displayName: provider.displayName,
    api: provider.api,
    baseURL: provider.baseURL,
    apiKey: '', // 已有密钥不回显；留空表示不改
    enabled: provider.enabled !== false,
    weight: String(provider.weight ?? 1),
    models: provider.models.map(model => ({
      id: model.id,
      name: model.name,
      contextWindow: String(model.capabilities.contextWindow),
      maxTokens: String(model.capabilities.maxTokens),
      reasoningEfforts: model.capabilities.reasoningEfforts.join(','),
    })),
  }
}

/** 由服务 id 派生合法 env 引用名（形如 MY_LLM_KEY）；明文 key 另走安全存储。 */
export function keyRefFor(id: string): string {
  const slug = id.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return `${slug || 'MODEL'}_KEY`
}

/** 草稿 → ProviderView。明文 key 不进返回值，由调用方单独写安全存储。 */
export function draftToProvider(draft: ProviderDraft): ProviderView {
  return {
    id: draft.id.trim(),
    displayName: draft.displayName.trim(),
    api: draft.api,
    baseURL: draft.baseURL.trim(),
    apiKeyEnv: keyRefFor(draft.id.trim()),
    enabled: draft.enabled,
    weight: Number(draft.weight),
    models: draft.models.map(model => ({
      id: model.id.trim(),
      name: model.name.trim() || model.id.trim(),
      capabilities: {
        contextWindow: Number(model.contextWindow),
        maxTokens: Number(model.maxTokens),
        reasoningEfforts: model.reasoningEfforts.split(',').map(item => item.trim()).filter(item => item !== ''),
      },
    })),
  }
}

/** 校验草稿；返回错误列表，空数组即合法。与 model-manager 的 validateProviderSpec 同口径。 */
export function validateDraft(draft: ProviderDraft): string[] {
  const errors: string[] = []
  const id = draft.id.trim()
  if (!/^[a-z][a-z0-9-]*$/.test(id)) errors.push('服务 id 须为小写字母开头的 kebab-case')
  if (draft.displayName.trim() === '') errors.push('显示名不能为空')
  if (!API_OPTIONS.some(option => option.value === draft.api)) errors.push('请选择合法协议')
  if (!/^https?:\/\/[^\s]+$/.test(draft.baseURL.trim())) errors.push('地址须为 http(s) 地址')
  if (draft.apiKey.trim() !== '' && ENV_REF.test(draft.apiKey.trim())) {
    errors.push('密钥请粘贴原文，不要填环境变量名')
  }
  const weight = Number(draft.weight)
  if (!Number.isInteger(weight) || weight < 1 || weight > 100) errors.push('权重须为 1~100 的整数')
  if (draft.models.length === 0) errors.push('至少填一个模型')
  for (const model of draft.models) {
    if (model.id.trim() === '') { errors.push('模型 id 不能为空'); continue }
    const ctx = Number(model.contextWindow)
    const out = Number(model.maxTokens)
    if (!Number.isInteger(ctx) || ctx <= 0) errors.push(`${model.id}: 上下文须为正整数`)
    if (!Number.isInteger(out) || out <= 0) errors.push(`${model.id}: 输出上限须为正整数`)
    if (out > ctx) errors.push(`${model.id}: 输出上限不能大于上下文`)
  }
  return errors
}

/** 纯函数地新增或替换一条服务（同 id 覆盖）。 */
export function upsertProviderView(state: ModelsState, provider: ProviderView): ModelsState {
  return {
    ...state,
    providers: [...state.providers.filter(item => item.id !== provider.id), provider],
  }
}

/** 删除服务并清理指向它的职责绑定。 */
export function removeProviderView(state: ModelsState, id: string): ModelsState {
  return {
    ...state,
    providers: state.providers.filter(item => item.id !== id),
    bindings: state.bindings.filter(item => item.providerId !== id),
  }
}

const modelScore = (model: ModelView): number =>
  model.capabilities.contextWindow + model.capabilities.reasoningEfforts.length * 1_000_000

/**
 * 按能力给两个职责自动推荐模型：规划职优先推理档位多 / 上下文大的，
 * 执行职选剩下的里上下文最大的；只有一个模型时两个职责共用。
 */
export function autoBindRoles(state: ModelsState): ModelsState {
  const flat = flattenModels(state)
  if (flat.length === 0) return state
  const ranked = [...flat].sort((a, b) => modelScore(b.model) - modelScore(a.model))
  const router = ranked.find(item => item.model.capabilities.reasoningEfforts.length > 0) ?? ranked[0]!
  const worker = ranked.find(item => item !== router) ?? router
  return {
    ...state,
    bindings: [
      { role: 'router', providerId: router.providerId, modelId: router.model.id },
      { role: 'worker', providerId: worker.providerId, modelId: worker.model.id },
    ],
  }
}
