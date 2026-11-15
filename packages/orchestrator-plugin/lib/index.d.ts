import type { Context } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
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
/** 给 UI / 其它客户端看的票视图（不含领域内部字段）。 */
export interface TicketView {
    id: string;
    title: string;
    stage: {
        stage: string;
        action?: string;
    };
    createdAt: string;
    report: string | null;
}
export declare class GhostTickets extends TypertRemoteService {
    constructor(ctx: Context, view: () => TicketView[]);
    /**
     * 列出全部票。
     * @returns 票视图，新的在前
     */
    listTickets(): {
        items: TicketView[];
    };
}
/**
 * 挂载插件。
 * @param ctx - cordis 上下文（已注入 tools）
 * @param config - 状态文件与来源名
 */
export declare function apply(ctx: Context, config?: Config): void;
export type { Config as OrchestratorConfig };
