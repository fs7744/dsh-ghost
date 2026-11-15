/**
 * 角色路由（C3-03）：router / worker 各绑定一个默认模型，并解析到具体能力。
 * 纯逻辑，可注入 provider 列表；解析不到就返回 undefined，不抛、不猜。
 */
import type { CatalogState, ModelRole, ModelSpec, ProviderSpec, RoleBinding } from './core.ts';
export declare const MODEL_ROLES: readonly ModelRole[];
/** 解析角色字面量；其它值一律 undefined。 */
export declare function parseRole(value: string): ModelRole | undefined;
export interface ResolvedRole {
    role: ModelRole;
    providerId: string;
    modelId: string;
    provider: ProviderSpec;
    model: ModelSpec;
}
/** 把一条绑定解析成 provider + model；缺任一或角色非法都返回 undefined。 */
export declare function resolveRole(binding: RoleBinding, providers: readonly ProviderSpec[]): ResolvedRole | undefined;
/** 批量校验角色绑定：返回错误列表，空数组即全部合法。 */
export declare function validateRoleBindings(bindings: readonly RoleBinding[], providers: readonly ProviderSpec[]): string[];
/** 取某角色的默认模型；没有绑定或绑定失效都返回 undefined。 */
export declare function defaultModelForRole(role: ModelRole, state: CatalogState): ResolvedRole | undefined;
