/**
 * model-manager 的核心类型与可注入存储（C3-01/02/03/05）。
 *
 * 纯逻辑：零网络、零 DOM、零文件系统。所有配置读写都走调用方注入的
 * CatalogStore，缺省是内存实现；界面与验收脚本各自注入自己的 store。
 * 凭据只允许 env 引用名（apiKeyEnv），绝不接受明文 key。
 */
import type { BalanceStrategy } from './balancing.ts';
export type ProviderApi = 'openai-completions' | 'openai-responses' | 'anthropic-messages' | 'google-generative-ai';
export declare const PROVIDER_APIS: readonly ProviderApi[];
export type ModelRole = 'router' | 'worker';
/** 能力标注：上下文窗口、输出上限、思考档位。由路由声明，用户可覆盖，不做自动爬取。 */
export interface ModelCapabilities {
    contextWindow: number;
    maxTokens: number;
    reasoningEfforts: readonly string[];
}
export interface ModelSpec {
    id: string;
    name?: string;
    capabilities: ModelCapabilities;
}
/** 一条 provider / route，形状对齐 scripts/cordis.patch.template.yml 的 providers 段。 */
export interface ProviderSpec {
    id: string;
    displayName: string;
    api: ProviderApi;
    baseURL?: string;
    apiKeyEnv: string;
    models: readonly ModelSpec[];
    /** 是否参与负载均衡；缺省 true。只影响本地聚合代理，不写进 harness patch。 */
    enabled?: boolean;
    /** 负载均衡权重（weighted 策略用）；缺省 1。 */
    weight?: number;
}
/** 把某个角色绑定到默认模型。 */
export interface RoleBinding {
    role: ModelRole;
    providerId: string;
    modelId: string;
}
export interface CatalogState {
    providers: readonly ProviderSpec[];
    bindings: readonly RoleBinding[];
    /** 多服务负载均衡配置；缺省 off（单服务直连）。 */
    balance?: {
        strategy: BalanceStrategy;
    };
}
export declare const EMPTY_STATE: CatalogState;
/** 配置读写的唯一入口；可注入文件实现、Remote 实现，或测试用的内存实现。 */
export interface CatalogStore {
    read(): Promise<CatalogState> | CatalogState;
    write(state: CatalogState): Promise<void> | void;
}
/** 默认内存实现：不落盘、不碰文件系统，测试与无后端 UI 直接用。 */
export declare function createMemoryStore(initial?: CatalogState): CatalogStore;
/** 能力标注校验；返回错误列表，空数组即合法。参数用 unknown 以容纳运行时脏数据。 */
export declare function validateCapabilities(caps: unknown): string[];
