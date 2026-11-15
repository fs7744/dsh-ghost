import type { Context } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { createRegistry, type SourceSpec, type SourceSummary } from '@dsh-ghost/source-hub';
/** 插件名。 */
export declare const name = "ghost-orchestrator";
/**
 * 依赖：工具注册表必需；会话与 agent 是执行器要用的宿主服务。
 * 用 `inject` 声明（而不是可选依赖）是为了让 cordis 等它们就绪后再 apply，
 * 否则惰性 getter 会在开票那一刻才发现服务还没挂上，票就永远排队。
 */
export declare const inject: string[];
/** GitHub 评论出口配置。缺省时不外发，票照常跑完。 */
export interface GithubOutboxConfig {
    /** 有 `repo` 权限的令牌。 */
    token: string;
    /** 目标仓库，形如 `owner/name`。 */
    repo: string;
    /** API 基址，默认公有云；自建/假服务器可覆盖。 */
    apiBase?: string;
}
/** 插件配置。 */
export interface Config {
    /** 票状态落地文件；相对路径按进程 cwd 解析。 */
    stateFile?: string;
    /** 本地触发源名，出现在票的来源里。 */
    source?: string;
    /**
     * 用哪个会话跑票。缺省时取"最新创建的活动会话"——单用户桌面端的合理默认；
     * 多会话场景应显式配置。
     */
    driveSession?: string;
    /** 等一个回合的最长时间（毫秒），默认 120s；真模型偶发变慢，别太短。 */
    turnTimeoutMs?: number;
    /** 配置后才启用 GitHub 评论出口；不配则 Outbox 只排队不外发。 */
    github?: GithubOutboxConfig;
    /** Outbox 兜底投递间隔（毫秒），默认 10s；报告完成时也会立即 flush。 */
    flushIntervalMs?: number;
    /**
     * 信息源配置。缺省只挂一个 passthrough；用户可任意组合内置适配器、
     * 声明式映射或自己的 .mjs mapper，见 docs/SOURCES.md。
     */
    sources?: SourceSpec[];
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
/** 来源会话地址；`address.number` 是 issue/PR 编号，出口据此决定评论发到哪。 */
export interface AcceptChannel {
    source: string;
    thread: string;
    address: Record<string, string>;
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
    /** 来源会话地址。带上它，票跑完才能把结果回写到同一条会话。 */
    channel?: AcceptChannel;
}
/** 一次原始投递。`rawBody` 必须传原始字节字符串，HMAC 签名才校验得过。 */
export interface IngestInput {
    sourceId: string;
    headers?: Record<string, string>;
    rawBody?: string;
    body?: unknown;
    event?: string;
}
/** 信息源的 Remote 面：列出来源、把原始投递归一化后开票。 */
export declare class GhostSources extends TypertRemoteService {
    constructor(ctx: Context, registry: ReturnType<typeof createRegistry>);
    /**
     * 列出当前启用的来源（不含任何密钥）。
     * @returns 来源摘要
     */
    listSources(): {
        items: SourceSummary[];
    };
    /**
     * 收下一次原始投递：校验签名 → 适配器归一化 → 逐条开票。
     * @param input - 来源 id 与原始请求材料
     * @returns 开出的票号；拒绝时带 reason
     */
    ingestSource(input: IngestInput): Promise<{
        accepted: number;
        ticketIds: string[];
        reason?: string;
    }>;
}
/**
 * 挂载插件。
 * @param ctx - cordis 上下文（已注入 tools / sessions / agents）
 * @param config - 状态文件、来源名与可选的 GitHub 出口
 */
export declare function apply(ctx: Context, config?: Config): void;
export type { Config as OrchestratorConfig };
