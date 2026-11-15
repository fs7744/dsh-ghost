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
  validateProviderSpec, findPlaintextCredentials,
  type CatalogState, type CatalogStore, type ModelSpec, type ProviderSpec, type RoleBinding,
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
export interface ModelsStateShape { providers: readonly ProviderViewShape[]; bindings: readonly BindingViewShape[]; demo: false }

export interface ModelsApiResponse { status: number; body: unknown }
export type ProbeFn = (provider: ProviderSpec) => Promise<unknown> | unknown

export interface ModelsApiDeps {
  store?: CatalogStore
  probe?: ProbeFn
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
      models: provider.models.map(model => ({
        id: model.id,
        name: model.name ?? model.id,
        capabilities: model.capabilities,
      })),
    })),
    bindings: state.bindings
      .filter(binding => binding.role === 'router' || binding.role === 'worker')
      .map(binding => ({ role: binding.role as 'router' | 'worker', providerId: binding.providerId, modelId: binding.modelId })),
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
    }
    const problems = validateProviderSpec(spec)
    if (problems.length > 0) throw new Error(`provider ${spec.id} 不合法：${problems.join('; ')}`)
    return spec
  })
  const bindings: RoleBinding[] = value.bindings.map(raw => {
    if (!isRecord(raw)) throw new Error('binding 必须是对象')
    return { role: String(raw.role ?? '') as RoleBinding['role'], providerId: String(raw.providerId ?? ''), modelId: String(raw.modelId ?? '') }
  })
  return { providers, bindings }
}

/** 建一个本机模型 API；缺省内存 store，重启即清空（持久化由外层注入）。 */
export function createModelsApi(deps: ModelsApiDeps = {}) {
  const store = deps.store ?? createMemoryStore()
  const probe: ProbeFn = deps.probe ?? (() => ({ ok: false, error: '未配置连通性探测' }))

  const read = async (): Promise<CatalogState> => await store.read()
  const view = async (): Promise<ModelsStateShape> => toView(await read())

  return {
    async handle(method: string, pathname: string, body: unknown = {}): Promise<ModelsApiResponse> {
      const path = pathname.split('?')[0] ?? ''
      try {
        if (path === '/api/models/state' && method === 'GET') return { status: 200, body: await view() }
        if (path === '/api/models/state' && method === 'POST') {
          const next = fromView(body)
          await store.write(next)
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
        if (path === '/api/models/preset' && method === 'POST') {
          const preset = isRecord(body) ? String(body.preset ?? '') : ''
          if (!isLocalPreset(preset)) return { status: 400, body: { ok: false, label: `未知预设 ${preset}` } }
          const state = await read()
          const generated = generateLocalRoute(preset)
          await store.write({ ...state, providers: [...state.providers.filter(item => item.id !== generated.id), generated] })
          return { status: 200, body: await view() }
        }
        return { status: 404, body: { ok: false, label: '未知模型 API 路径' } }
      } catch (error) {
        return { status: 400, body: { ok: false, label: '请求被拒', detail: String(error).slice(0, 200) } }
      }
    },
  }
}
