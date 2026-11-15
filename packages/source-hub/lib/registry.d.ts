import type { AdapterContext, NormalizeResult, SourceRequest, SourceSpec, SourceSummary } from './types.ts';
export interface SourceRegistry {
    /** 对外可见的来源清单（不含任何密钥）。 */
    list(): SourceSummary[];
    /** 校验签名 → 选适配器 → 归一化；失败时 events 为空并给 reason。 */
    normalize(sourceId: string, request: SourceRequest, env?: NodeJS.ProcessEnv): Promise<NormalizeResult>;
}
/**
 * 从配置构建注册表。
 * @param specs - 用户配置的来源列表（顺序即 list() 的顺序）
 * @param context - 适配器运行期能力，主要是加载自定义 mapper
 */
export declare function createRegistry(specs: SourceSpec[], context: AdapterContext): SourceRegistry;
