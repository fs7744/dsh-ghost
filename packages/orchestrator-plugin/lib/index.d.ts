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
    /**
     * 收下一条外部事件并开票（来源适配器用：GitHub / IM / 脚本）。
     * @param input - 已校验并归一化的事件
     * @returns 新票的 id
     */
    acceptTicket(input: AcceptInput): {
        ticketId: string;
    };
    /**
     * 取一张票的详情。
     * @param input - 票号
     * @returns 详情，找不到返回 undefined
     */
    getTicket(input: {
        id: string;
    }): {
        ticket?: TicketDetail;
    };
}
/** 票详情（含派活历史），给界面的详情页用。 */
export interface TicketDetail extends TicketView {
    inputs: number;
    assignments: Array<{
        id: string;
        state: string;
        report: {
            state: string;
            summary: string;
        } | null;
    }>;
}
/** 外部事件归一化后的输入。 */
export interface AcceptInput {
    /** 来源名，如 `github`。 */
    source: string;
    /** 线程标识，如 `fs7744/dsh-ghost#12`；同线程事件会聚到一起。 */
    threadId: string;
    /** 事件正文。 */
    text: string;
    /** 是否人写的。 */
    human?: boolean;
    /** 是否点名了 agent。 */
    addressed?: boolean;
    /** 原始链接。 */
    url?: string;
    /** 发起者。 */
    actor?: string;
}
/**
 * 挂载插件。
 * @param ctx - cordis 上下文（已注入 tools）
 * @param config - 状态文件与来源名
 */
export declare function apply(ctx: Context, config?: Config): void;
export type { Config as OrchestratorConfig };
