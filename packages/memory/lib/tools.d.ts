/**
 * 记忆工具：模型可见的三个动作。
 *
 * 设计原则（省 token + 防误用）：
 *  - **描述即说明书**：每个工具的 description 就是模型看到的全部，不额外写文档；
 *  - **只回文本**：工具结果是给人话，不是 JSON 堆——模型不需要解析结构化字段；
 *  - **错误可自愈**：写入被拒时，把"为什么被拒"原文返回，模型下一轮就能改。
 *
 * 这里只定义与 harness 无关的描述符；把它挂进 `agent.ctx.tools.register` 是适配层的事。
 */
import type { MemoryStore } from './store.ts';
/** 极简 JSON Schema（够 harness 的 zod 适配器转换）。 */
export interface JsonSchema {
    type: 'object';
    properties: Record<string, {
        type: string;
        description?: string;
    }>;
    required?: string[];
    additionalProperties?: boolean;
}
/** 一个工具的描述与执行体。 */
export interface ToolDescriptor {
    name: string;
    description: string;
    parameters: JsonSchema;
    execute: (args: Record<string, unknown>) => Promise<string>;
}
/**
 * 构建三个记忆工具。
 * @param store - 记忆库
 */
export declare function memoryTools(store: MemoryStore): ToolDescriptor[];
