/**
 * 模型管理页的本机 API（C3-01/02/03/05 与壳的接线）。
 *
 * 纯模块：不发请求、不读文件、不依赖 electron。store 与 probe 都从外部注入，
 * 所以 electron-static.ts 能给真实现，测试能给内存假实现。
 *
 * 为什么要有这一层：渲染层的 models.html 走同源 `/api/models/*`，而 harness 宿主
 * 没有这些端点。桌面壳的静态服务把这一小段路径**留在本机处理**，其余 `/api/*`
 * 照旧反代给宿主——模型配置不经过模型、也不落明文凭据。
 */
import {
  createMemoryStore, generateLocalRoute, isLocalPreset, runConnectivityProbe,
  validateProviderSpec, findPlaintextCredentials, parseDiscoveredModels, isBalanceStrategy,
  type CatalogState, type CatalogStore, type ModelSpec, type ProviderSpec, type RoleBinding,
  type BalanceStrategy,
} from '@dsh-ghost/model-manager'
import { isLocalModelsApi } from './static-server.ts'

export { isLocalModelsApi }

/** 与 apps/desktop/src/models-view.ts 的视图形状对齐（刻意不 import 渲染层）。 */
export interface ModelViewShape {
  id: string
  name: string
  capabilities: { contextWindow: number; maxTokens: number; reasoningEfforts: readonly string[] }
}
export interface ProviderViewShape {
  id: string
  displayName: string
  api: string
  baseURL: string
  apiKeyEnv: string
  models: readonly ModelViewShape[]
}
export interface BindingViewShape { role: 'router' | 'worker'; providerId: string; modelId: string }
export interface ModelsStateShape {
  providers: readonly ProviderViewShape[]
  bindings: readonly BindingViewShape[]
  balance?: { strategy: BalanceStrategy }
  demo: false
}

export interface ModelsApiResponse { status: number; body: unknown }
export type ProbeFn = (provider: ProviderSpec) => Promise<unknown> | unknown
/** 模型发现：返回 provider 的 /models 原始响应，解析交给 parseDiscoveredModels。 */
export type DiscoverFn = (provider: ProviderSpec) => Promise<unknown>

export interface ModelsApiDeps {
  store?: CatalogStore
  probe?: ProbeFn
  discover?: DiscoverFn
  /** 保存后同步写 harness 真正读取的 providers.json，让配置进入 cordis patch。 */
  syncProviders?: (providers: readonly ProviderSpec[]) => void
  /** models.json 为空时从旧配置源（providers.json）导入，兼容设置面板的历史数据。 */
  loadLegacyProviders?: () => readonly ProviderSpec[]
}

/** Catalog → 渲染层视图；可选字段在这里补成渲染层要的确定形状。 */
export function toView(state: CatalogState): ModelsStateShape {
  return {
    demo: false,
    providers: state.providers.map(provider => ({
      id: provider.id,
      displayName: provider.displayName,
      api: provider.api,
      baseURL: provider.baseURL ?? '',
      apiKeyEnv: provider.apiKeyEnv,
      models: (Array.isArray(provider.models) ? provider.models : []).map(model => ({
        id: model.id,
        name: model.name ?? model.id,
        capabilities: model.capabilities,
      })),
    })),
    bindings: state.bindings
      .filter(binding => binding.role === 'router' || binding.role === 'worker')
      .map(binding => ({ role: binding.role as 'router' | 'worker', providerId: binding.providerId, modelId: binding.modelId })),
    ...(state.balance === undefined ? {} : { balance: state.balance }),
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** 渲染层视图 → Catalog；非法配置在这里被拒，绝不写进宿主 patch。 */
export function fromView(value: unknown): CatalogState {
  if (!isRecord(value) || !Array.isArray(value.providers) || !Array.isArray(value.bindings)) {
    throw new Error('state 必须含 providers[] 与 bindings[]')
  }
  const providers: ProviderSpec[] = value.providers.map(raw => {
    if (!isRecord(raw)) throw new Error('provider 必须是对象')
    const plaintext = findPlaintextCredentials(raw)
    if (plaintext.length > 0) throw new Error(`疑似明文凭据字段：${plaintext.join(', ')}`)
    const models: ModelSpec[] = (Array.isArray(raw.models) ? raw.models : []).map(item => {
      if (!isRecord(item)) throw new Error('model 必须是对象')
      return {
        id: String(item.id ?? ''),
        ...(typeof item.name === 'string' && item.name !== '' ? { name: item.name } : {}),
        capabilities: item.capabilities as ModelSpec['capabilities'],
      }
    })
    const spec: ProviderSpec = {
      id: String(raw.id ?? ''),
      displayName: String(raw.displayName ?? ''),
      api: String(raw.api ?? '') as ProviderSpec['api'],
      ...(typeof raw.baseURL === 'string' && raw.baseURL !== '' ? { baseURL: raw.baseURL } : {}),
      apiKeyEnv: String(raw.apiKeyEnv ?? ''),
      models,
      ...(typeof raw.enabled === 'boolean' ? { enabled: raw.enabled } : {}),
      ...(typeof raw.weight === 'number' && Number.isFinite(raw.weight) ? { weight: raw.weight } : {}),
    }
    const problems = validateProviderSpec(spec)
    if (problems.length > 0) throw new Error(`provider ${spec.id} 不合法：${problems.join('; ')}`)
    return spec
  })
  const bindings: RoleBinding[] = value.bindings.map(raw => {
    if (!isRecord(raw)) throw new Error('binding 必须是对象')
    return { role: String(raw.role ?? '') as RoleBinding['role'], providerId: String(raw.providerId ?? ''), modelId: String(raw.modelId ?? '') }
  })
  let balance: CatalogState['balance']
  if (isRecord(value.balance)) {
    const strategy = String(value.balance.strategy ?? 'off')
    if (!isBalanceStrategy(strategy)) throw new Error(`负载均衡策略非法：${strategy}`)
    balance = { strategy }
  }
  return { providers, bindings, ...(balance === undefined ? {} : { balance }) }
}

/** 建一个本机模型 API；缺省内存 store，重启即清空（持久化由外层注入）。 */
export function createModelsApi(deps: ModelsApiDeps = {}) {
  const store = deps.store ?? createMemoryStore()
  const probe: ProbeFn = deps.probe ?? (() => ({ ok: false, error: '未配置连通性探测' }))
  const discover: DiscoverFn = deps.discover ?? (async () => { throw new Error('未配置模型发现') })

  let legacyImported = false
  const read = async (): Promise<CatalogState> => {
    const state = await store.read()
    // 一次性迁移：模型库页是新建的，历史服务在设置面板写的 providers.json 里。
    if (!legacyImported && state.providers.length === 0 && deps.loadLegacyProviders !== undefined) {
      legacyImported = true
      const legacy = deps.loadLegacyProviders()
      if (legacy.length > 0) {
        const merged: CatalogState = { ...state, providers: legacy }
        await store.write(merged)
        return merged
      }
    }
    return state
  }
  /** 统一写口：models.json 与 harness 的 providers.json 必须一起更新，配置才真正生效。 */
  const write = async (state: CatalogState): Promise<void> => {
    await store.write(state)
    deps.syncProviders?.(state.providers)
  }
  const view = async (): Promise<ModelsStateShape> => toView(await read())

  return {
    async handle(method: string, pathname: string, body: unknown = {}): Promise<ModelsApiResponse> {
      const path = pathname.split('?')[0] ?? ''
      try {
        if (path === '/api/models/state' && method === 'GET') return { status: 200, body: await view() }
        if (path === '/api/models/state' && method === 'POST') {
          const next = fromView(body)
          await write(next)
          return { status: 200, body: await view() }
        }
        if (path === '/api/models/probe' && method === 'POST') {
          const id = isRecord(body) ? String(body.providerId ?? '') : ''
          const provider = (await read()).providers.find(item => item.id === id)
          if (provider === undefined) return { status: 404, body: { ok: false, label: '未找到该 provider' } }
          const result = await runConnectivityProbe(provider, probe)
          const detail = result.status === undefined ? result.error : `HTTP ${String(result.status)}${result.error === undefined ? '' : ` ${result.error}`}`
          return {
            status: 200,
            body: { ok: result.ok, label: result.label, ...(detail === undefined ? {} : { detail }) },
          }
        }
        if (path === '/api/models/discover' && method === 'POST') {
          const raw = isRecord(body) ? body : {}
          const providerId = typeof raw['providerId'] === 'string' ? raw['providerId'] : ''
          const saved = providerId === '' ? undefined : (await read()).providers.find(item => item.id === providerId)
          if (providerId !== '' && saved === undefined) {
            return { status: 404, body: { ok: false, label: '未找到该服务，请先保存' } }
          }
          // 以已保存配置为底，表单字段优先覆盖：这样「改了地址还没保存」也能先拉取验证。
          // 密钥始终按 apiKeyEnv 从安全存储取，明文不经过这个 API。
          const id = String(raw['id'] ?? saved?.id ?? '')
          const pick = (key: string, fallback: string): string => {
            const value = raw[key]
            return typeof value === 'string' && value !== '' ? value : fallback
          }
          const target: ProviderSpec = {
            id,
            displayName: pick('displayName', saved?.displayName ?? id),
            api: pick('api', saved?.api ?? 'openai-completions') as ProviderSpec['api'],
            baseURL: pick('baseURL', saved?.baseURL ?? ''),
            apiKeyEnv: pick('apiKeyEnv', saved?.apiKeyEnv ?? ''),
            models: saved?.models ?? [],
          }
          if (!/^https?:\/\//.test(target.baseURL ?? '')) {
            return { status: 400, body: { ok: false, label: '请先填写合法的接口地址' } }
          }
          const models = parseDiscoveredModels(target.api, await discover(target))
          return { status: 200, body: { ok: true, models } }
        }
        if (path === '/api/models/preset' && method === 'POST') {
          const preset = isRecord(body) ? String(body.preset ?? '') : ''
          if (!isLocalPreset(preset)) return { status: 400, body: { ok: false, label: `未知预设 ${preset}` } }
          const state = await read()
          const generated = generateLocalRoute(preset)
          await write({ ...state, providers: [...state.providers.filter(item => item.id !== generated.id), generated] })
          return { status: 200, body: await view() }
        }
        return { status: 404, body: { ok: false, label: '未知模型 API 路径' } }
      } catch (error) {
        return { status: 400, body: { ok: false, label: '请求被拒', detail: String(error).slice(0, 200) } }
      }
    },
  }
}
