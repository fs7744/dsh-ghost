/**
 * GitHub 评论出口：把领域里的 Outbox 端口落到 GitHub API 上。
 *
 * 三条要求：
 *  1. **幂等**：同一条消息（同一个 id）最多发一次；重试不会刷屏。
 *  2. **状态可查**：pending → sent，失败回到 pending 并记下原因。
 *  3. **可测**：HTTP 通过注入的 `post` 走，测试不需要真网络。
 *
 * 这里不做重试调度——重试属于调用方（定时器或下一次事务），
 * 出口只保证"发出去就记账、没发出去不改状态"。
 */
import type { Outbox, OutboundMessage, ReplyStatus } from '@dsh-ghost/superagent';
/** 一次评论投递的结果。 */
export interface PostResult {
    ok: boolean;
    /** 失败原因（ok 为 false 时）。 */
    error?: string;
    /** GitHub 返回的评论 id。 */
    commentId?: string;
    /** 429 时服务端要求的等待毫秒数（来自 Retry-After）。 */
    retryAfterMs?: number;
}
/** 出口配置。 */
export interface GithubSinkOptions {
    /** GitHub API 基址，默认公有云；自建/假服务器可覆盖。 */
    apiBase?: string;
    /** 有 `repo` 权限的令牌。 */
    token: string;
    /** 目标仓库，形如 `owner/name`。 */
    repo: string;
    /** 投递函数；默认用 fetch。测试与假服务器可注入。 */
    post?: (url: string, body: unknown, headers: Record<string, string>) => Promise<PostResult>;
    /**
     * 同一条消息最多尝试几次，默认 5。
     * 定时 flush 会一直重试 pending；没有上限时，永久失败（404 / 422 超长正文）
     * 会变成每 10 秒一次的无限重试，既刷日志也打 API。
     */
    maxAttempts?: number;
    /** 单条评论正文上限，默认 60_000 字符（GitHub 上限 65536；留出截断说明的余量）。 */
    maxBodyChars?: number;
    /** 时钟，测试可注入；用于 429 Retry-After。 */
    now?: () => number;
}
/** 一条消息的去向。 */
interface Entry {
    message: OutboundMessage;
    status: ReplyStatus;
    error?: string;
    commentId?: string;
    attempts: number;
    /** 429 后到这个时间点才允许再试。 */
    retryAt?: number;
}
/**
 * 创建 GitHub 评论出口。
 * @param options - 令牌、仓库与投递函数
 */
export declare function createGithubSink(options: GithubSinkOptions): Outbox & {
    /** 真的把 pending 发出去；返回本次成功条数。 */
    flush: () => Promise<{
        sent: number;
        failed: number;
    }>;
    /** 全部记录（排障用）。 */
    entries: () => Entry[];
};
export {};
