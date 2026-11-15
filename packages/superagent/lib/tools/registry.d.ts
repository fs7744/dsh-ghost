/**
 * 19 个会话工具：描述符 + 处理器，统一注册、统一拒绝语义。
 *
 * 三条约定：
 *  1. 描述符的 description 是给模型看的说明书，每条不超过 120 字符；
 *  2. handler 只调 ctx 里可注入的 Repositories / Engine / ConfigStore / ViewReader，零 harness 依赖；
 *  3. 返回值一律是人话文本；领域拒绝（UserError）由 invokeTool 把原因原样返回，让模型据此自愈。
 *
 * 这里只产出描述符，不调用 harness 的 tools.register，也不改 contracts.ts。
 */
import type { ToolArgs, ToolContext, ToolDescriptor } from './types.ts';
/** 19 个工具的完整注册表，顺序即账本 §B3 的顺序。 */
export declare const TOOL_DESCRIPTORS: readonly ToolDescriptor[];
/** 19 个工具名，与 docs/FEATURES.md §B3 账本一一对应。 */
export declare const TOOL_NAMES: readonly string[];
/** 按名字取一个工具描述符。 */
export declare function getTool(name: string): ToolDescriptor | undefined;
/**
 * 统一调用入口：找不到工具回人话；领域拒绝（UserError）把原因原样返回让模型自愈；
 * 其它异常也不吞，转成一行人话。
 */
export declare function invokeTool(name: string, args: ToolArgs, ctx: ToolContext): string;
