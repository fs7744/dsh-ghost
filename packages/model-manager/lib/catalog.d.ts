/**
 * provider / 模型目录（C3-01）：能力标注、增删、角色绑定。
 * 所有读写走可注入 CatalogStore，缺省内存；零网络、零 DOM。
 */
import type { CatalogState, CatalogStore, ModelRole, ModelSpec, ProviderSpec, RoleBinding } from './core.ts';
import { type ResolvedRole } from './roles.ts';
/** 校验一条 provider 配置；返回错误列表，空数组即合法。 */
export declare function validateProviderSpec(spec: ProviderSpec): string[];
export interface CatalogModel {
    providerId: string;
    model: ModelSpec;
}
export interface CatalogApi {
    list(): Promise<CatalogState>;
    addProvider(spec: ProviderSpec): Promise<CatalogState>;
    removeProvider(id: string): Promise<CatalogState>;
    bindRole(binding: RoleBinding): Promise<CatalogState>;
    listModels(): Promise<readonly CatalogModel[]>;
    resolve(role: ModelRole): Promise<ResolvedRole | undefined>;
}
/** 用给定 store 建一个目录；store 是唯一 I/O 口，测试可完全替换。 */
export declare function createCatalog(store: CatalogStore): CatalogApi;
