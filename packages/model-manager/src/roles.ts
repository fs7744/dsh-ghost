/**
 * 角色路由（C3-03）：router / worker 各绑定一个默认模型，并解析到具体能力。
 * 纯逻辑，可注入 provider 列表；解析不到就返回 undefined，不抛、不猜。
 */
import type { CatalogState, ModelRole, ModelSpec, ProviderSpec, RoleBinding } from './core.ts'

export const MODEL_ROLES: readonly ModelRole[] = ['router', 'worker']

/** 解析角色字面量；其它值一律 undefined。 */
export function parseRole(value: string): ModelRole | undefined {
  return value === 'router' || value === 'worker' ? value : undefined
}

export interface ResolvedRole {
  role: ModelRole
  providerId: string
  modelId: string
  provider: ProviderSpec
  model: ModelSpec
}

/** 把一条绑定解析成 provider + model；缺任一或角色非法都返回 undefined。 */
export function resolveRole(binding: RoleBinding, providers: readonly ProviderSpec[]): ResolvedRole | undefined {
  if (parseRole(binding.role) === undefined) return undefined
  const provider = providers.find(item => item.id === binding.providerId)
  if (provider === undefined) return undefined
  const model = provider.models.find(item => item.id === binding.modelId)
  if (model === undefined) return undefined
  return { role: binding.role, providerId: binding.providerId, modelId: binding.modelId, provider, model }
}

/** 批量校验角色绑定：返回错误列表，空数组即全部合法。 */
export function validateRoleBindings(bindings: readonly RoleBinding[], providers: readonly ProviderSpec[]): string[] {
  const errors: string[] = []
  const seen = new Set<string>()
  for (const binding of bindings) {
    if (parseRole(binding.role) === undefined) {
      errors.push(`非法角色: ${String(binding.role)}`)
      continue
    }
    if (seen.has(binding.role)) errors.push(`角色 ${binding.role} 重复绑定`)
    seen.add(binding.role)
    if (resolveRole(binding, providers) === undefined) {
      errors.push(`角色 ${binding.role} 指向不存在的模型 ${binding.providerId}/${binding.modelId}`)
    }
  }
  return errors
}

/** 取某角色的默认模型；没有绑定或绑定失效都返回 undefined。 */
export function defaultModelForRole(role: ModelRole, state: CatalogState): ResolvedRole | undefined {
  const binding = state.bindings.find(item => item.role === role)
  if (binding === undefined) return undefined
  return resolveRole(binding, state.providers)
}
