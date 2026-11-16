/**
 * @dsh-ghost/model-manager 的公共出口（C3-01/02/03/05）。
 * 纯逻辑零网络零 DOM：能力标注、角色路由、route 生成、凭据校验、连通性自测、
 * 可注入 store。界面与验收脚本只从这个入口取，避免各自实现一套判定。
 */
export type {
  ProviderApi, ModelRole, ModelCapabilities, ModelSpec, ProviderSpec,
  RoleBinding, CatalogState, CatalogStore,
} from './core.ts'
export { PROVIDER_APIS, EMPTY_STATE, createMemoryStore, validateCapabilities } from './core.ts'

export { ENV_REF_NAME, looksLikePlaintextKey, validateCredentialRef, findPlaintextCredentials } from './credentials.ts'
export type { CredentialCheck } from './credentials.ts'

export { LOCAL_PRESETS, isLocalPreset, generateLocalRoute } from './presets.ts'
export type { LocalPreset, LocalRouteOptions } from './presets.ts'

export { MODEL_ROLES, parseRole, resolveRole, validateRoleBindings, defaultModelForRole } from './roles.ts'
export type { ResolvedRole } from './roles.ts'

export { validateProviderSpec, createCatalog } from './catalog.ts'
export type { CatalogApi, CatalogModel } from './catalog.ts'

export { normalizeProbeResult, describeProbe, runConnectivityProbe } from './probe.ts'
export type { ProbeOutcome, ProbeFn, ConnectivityReport } from './probe.ts'

export {
  discoveryUrl, discoveryHeaders, parseDiscoveredModels,
  DEFAULT_DISCOVERED_CONTEXT, DEFAULT_DISCOVERED_MAX_TOKENS,
} from './discovery.ts'
export type { DiscoveredModel } from './discovery.ts'

export { BALANCE_STRATEGIES, isBalanceStrategy, selectBalanceTarget } from './balancing.ts'
export type { BalanceStrategy, BalanceCandidate, BalanceSelection } from './balancing.ts'
