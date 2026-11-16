/**
 * 模型列表自动拉取（业界标准 /models 端点）。
 *
 * 纯逻辑：只负责「按协议构造 URL / 请求头」与「把各家响应解析成统一模型列表」，
 * 不发起任何网络请求。真实 fetch 由 apps/shell 注入，测试用固定 JSON 断言解析口径。
 *
 * 拉取到的模型能力标注是保守默认值——能力标注无法从 /models 可靠推断，
 * 用户仍可在界面里逐项修改（这正是「自动获取 + 允许修改」的意思）。
 */
import type { ProviderApi } from './core.ts';
/** 拉取到的单条模型；capabilities 是可编辑的默认标注，不是真值。 */
export interface DiscoveredModel {
    id: string;
    name: string;
    capabilities: {
        contextWindow: number;
        maxTokens: number;
        reasoningEfforts: string[];
    };
}
export declare const DEFAULT_DISCOVERED_CONTEXT = 128000;
export declare const DEFAULT_DISCOVERED_MAX_TOKENS = 8192;
/**
 * 各协议的模型列表端点。baseURL 已经是带版本前缀的表单值时不去重加。
 * - OpenAI Chat Completions / Responses: GET {base}/models
 * - Anthropic Messages:                 GET {base}/v1/models?limit=100
 * - Google Generative AI (Gemini):      GET {base}/v1beta/models?pageSize=100
 */
export declare function discoveryUrl(baseURL: string, api: ProviderApi | string): string;
/** 鉴权头：OpenAI 用 Bearer，Anthropic 用 x-api-key，Gemini 用 x-goog-api-key。 */
export declare function discoveryHeaders(api: ProviderApi | string, key: string | undefined): Record<string, string>;
/**
 * 把 /models 响应解析成统一列表；认识 3 种常见形状：
 * - OpenAI / Anthropic: { data: [{ id, name? }] }
 * - Gemini:             { models: [{ name: "models/xxx", displayName? }] }
 * - 裸数组:             [{ id, name? }]
 * 无法识别的形状返回空数组，绝不猜、不抛。
 */
export declare function parseDiscoveredModels(api: ProviderApi | string, raw: unknown): DiscoveredModel[];
