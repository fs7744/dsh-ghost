import type { Context } from '@deepseek-ai/cordis';
import { type JsonSchema } from '@dsh-ghost/memory';
/** 插件名，cordis 用它做去重与诊断。 */
export declare const name = "ghost-memory";
/** 依赖的工具注册表。 */
export declare const inject: string[];
/** 插件配置。 */
export interface Config {
    /** 记忆根目录：`indexed` 用 `<root>/MEMORY.md`，`block` 用 `<root>/user-memory.md`。 */
    root: string;
    /** 存储形态，默认 `indexed`（项目记忆）。 */
    mode?: 'indexed' | 'block';
    /** 常驻预算（字节），默认 2048。 */
    maxResidentBytes?: number;
}
/**
 * 挂载插件。
 * @param ctx - cordis 上下文（必须已注入 `tools`）
 * @param config - 记忆根目录与形态
 */
export declare function apply(ctx: Context, config: Config): void;
export type { JsonSchema };
