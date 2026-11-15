/**
 * 失败循环短提示 + 工具结果截断。
 *
 * 不做 judge、不调模型：只认「同一工具 + 同一错误」在时间窗内重复出现。
 * 第二次重复才加一行提示，第一次失败保持原样，避免正常纠错被唠叨。
 */
export interface LoopGuardOptions {
    /** 多久内重复算同一轮，默认 10 分钟。 */
    windowMs?: number;
    /** 第几次重复开始提示，默认 2。 */
    threshold?: number;
    /** 时间源，测试可注入。 */
    now?: () => number;
}
/** 把错误里的随机 id / 数字抹平，避免同一种失败因 id 不同而漏判。 */
export declare function normalizeFailure(error: string): string;
export declare class LoopGuard {
    #private;
    constructor(options?: LoopGuardOptions);
    /** 记一次失败；达到阈值时返回一行重定向，否则 undefined。 */
    failure(tool: string, error: string): string | undefined;
    /** 工具成功一次，清掉它的失败计数。 */
    success(tool: string): void;
}
/**
 * 截断工具结果：保留头部，附一行说明。
 * 默认 12000 字符（约 3k token），足够覆盖大多数视图/文件读取。
 */
export declare function truncateToolResult(text: string, maxChars?: number): string;
