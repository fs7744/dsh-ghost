/**
 * 本地模型预设的 route 生成（C3-05）：Ollama / vLLM。
 *
 * 生成的形状对齐 scripts/cordis.patch.template.yml 的 providers 段，
 * 直接可写进宿主 patch。所有非法值在生成阶段就拒绝，不把脏配置带进宿主。
 */
import type { ProviderSpec } from './core.ts';
export type LocalPreset = 'ollama' | 'vllm';
export declare const LOCAL_PRESETS: readonly LocalPreset[];
export interface LocalRouteOptions {
    host?: string;
    port?: number;
    modelId?: string;
    contextWindow?: number;
    maxTokens?: number;
    reasoningEfforts?: readonly string[];
    apiKeyEnv?: string;
}
/** 类型守卫，让 generateLocalRoute 能接受任意字符串并给出明确拒绝。 */
export declare function isLocalPreset(value: string): value is LocalPreset;
/** 生成一条本地模型 route；非法值直接抛，绝不静默回退到默认值。 */
export declare function generateLocalRoute(preset: string, options?: LocalRouteOptions): ProviderSpec;
