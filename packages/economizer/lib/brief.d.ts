/**
 * 会话前置简报（对标 micro-skills 的「跨会话事实注入」）。
 *
 * 只注入**索引**（每行一条：名字 + 标题），正文仍按需 memory_read。
 * 这样做的好处：
 *  - 模型开局就知道「以前定过什么」，不用先 memory_list 再逐条读；
 *  - 常驻体积有硬上限，不会把记忆全文塞进每次请求；
 *  - 少于 3 条时不注入，避免为两条笔记白付一段 header。
 */
export interface SessionBriefOptions {
    /** 最多注入多少字符（默认 1200，约 300 token）。 */
    maxChars?: number;
    /** 少于多少条记忆就不注入，默认 3。 */
    minEntries?: number;
    /** 最多列多少条，默认 24。 */
    maxEntries?: number;
}
/** 从 MEMORY.md 里数出索引条目（只认 `- ` 开头的行）。 */
export declare function countMemoryEntries(index: string): number;
/**
 * 只拼记忆块（不带任务）：普通聊天与开票共用同一段文本。
 * 条目不足时返回空串，调用方原样发消息，零额外 token。
 */
export declare function buildMemoryBlock(index: string, options?: SessionBriefOptions): string;
/**
 * 拼任务 + 记忆索引。没有足够条目时原样返回任务，一个字符都不多花。
 * @param task - 票标题 / 用户任务
 * @param index - MEMORY.md 文本
 */
export declare function buildSessionBrief(task: string, index: string, options?: SessionBriefOptions): string;
