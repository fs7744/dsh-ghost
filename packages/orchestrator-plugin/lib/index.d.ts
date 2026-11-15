import type { Context } from '@deepseek-ai/cordis';
/** 插件名。 */
export declare const name = "ghost-orchestrator";
/** 依赖工具注册表。 */
export declare const inject: string[];
/** 插件配置。 */
export interface Config {
    /** 票状态落地文件；相对路径按进程 cwd 解析。 */
    stateFile?: string;
    /** 本地触发源名，出现在票的来源里。 */
    source?: string;
}
/**
 * 挂载插件。
 * @param ctx - cordis 上下文（已注入 tools）
 * @param config - 状态文件与来源名
 */
export declare function apply(ctx: Context, config?: Config): void;
export type { Config as OrchestratorConfig };
