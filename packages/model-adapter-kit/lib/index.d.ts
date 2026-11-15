/**
 * 对外稳定的 ModelAdapter 契约（C3-04，Apache-2.0）。
 *
 * 为什么不直接用 harness 的 LlmAdapter：它是 pre-stable 的公开抽象类，
 * 一次 harness 升级就可能改签名，把全部第三方插件一起打翻。我们在 harness-port
 * 之上再收一层，只暴露 3 个方法；用户插件只依赖本包，永远不 import 任何
 * @deepseek-ai/* 包。宿主侧负责把这层适配到最新的 harness。
 *
 * 本包是纯类型 + 纯函数：零网络、零 DOM、零文件系统，依赖全部可注入、可单测。
 * 版权与授权见包内 LICENSE（Apache License 2.0）。
 */
/** 契约版本。major 变化表示不兼容；宿主用 isCompatible 判断是否接受插件。 */
export declare const MODEL_ADAPTER_CONTRACT_VERSION = "1.0.0";
/** 一个模型的能力声明；能力由插件/路由给出，宿主不做自动爬取。 */
export interface ModelInfo {
    id: string;
    name?: string;
    contextWindow?: number;
    maxTokens?: number;
    reasoningEfforts?: readonly string[];
}
export interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
}
export interface ToolCall {
    name: string;
    arguments: string;
}
export interface ChatRequest {
    model: string;
    messages: readonly ChatMessage[];
}
export interface ChatResponse {
    content: string;
    toolCalls?: readonly ToolCall[];
    finishReason?: 'stop' | 'tool_calls' | 'length' | 'error';
}
/**
 * 稳定契约：只有 3 个方法。方法可同步可异步，宿主一律用 await 消费。
 * 不暴露任何 harness 类型、不暴露 provider 注册细节，升级时这层不动。
 */
export interface ModelAdapter {
    listModels(): Promise<readonly ModelInfo[]> | readonly ModelInfo[];
    chat(request: ChatRequest): Promise<ChatResponse> | ChatResponse;
    close(): Promise<void> | void;
}
/** 插件清单里必须声明的字段，供宿主做兼容校验。 */
export interface PluginContract {
    contractVersion: string;
}
/**
 * 兼容规则：major 必须相同；插件声明的 minor 不得高于宿主（宿主向后兼容旧插件）；
 * patch 与预发布后缀不影响判断。任一侧格式非法即不兼容。
 */
export declare function isCompatible(pluginVersion: string, hostVersion?: string): boolean;
export interface CompatibilityResult {
    ok: boolean;
    reason: string;
    pluginVersion: string;
    hostVersion: string;
}
/** 结构化兼容校验：插件启动自检用，返回原因而不是抛异常。 */
export declare function checkContract(plugin: PluginContract, hostVersion?: string): CompatibilityResult;
/** 参考实现：静态模型列表 + 回显，零网络零 DOM，可直接用于单测或本地演示。 */
export declare const DEFAULT_MODELS: readonly ModelInfo[];
/** 工厂：用户插件可照此实现 3 个方法；examples/echo-adapter.ts 是可复制的完整示例。 */
export declare function createEchoAdapter(models?: readonly ModelInfo[]): ModelAdapter;
export interface ScaffoldOptions {
    /** kebab-case 适配器名，用作工厂函数名的一部分。 */
    name: string;
    modelIds?: readonly string[];
}
/**
 * 生成一份可复制的用户插件脚手架源码（纯函数，返回文本，不写盘）。
 * 生成的代码只 import 本契约包，不含任何 @deepseek-ai/* 依赖。
 */
export declare function generateAdapterScaffold(options: ScaffoldOptions): string;
