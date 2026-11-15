/**
 * 写入闸门：不是所有对话都能进记忆。
 *
 * 三问（docs/MEMORY.md §2）：
 *  1. 是稳定事实，还是一次性上下文？
 *  2. 下次真的会用到吗？
 *  3. 来源是哪次任务？（没来源 = 无法追溯 = 谣言）
 *
 * 这里只做**可判定的部分**：一次性措辞、缺来源、空内容、超长。
 * "下次会不会用到"是判断，交给模型或人，代码不假装能算。
 */
/** 一次写入请求（UI 与模型都走它）。 */
export interface MemoryWrite {
    /** 条目名，kebab-case，用作文件名。 */
    name: string;
    /** 一行标题，进索引。 */
    title?: string;
    /** 正文（Markdown）。 */
    text: string;
    /** 来源：哪次任务/哪个文件/哪次对话。必填。 */
    source: string;
}
/** 判定结果。 */
export interface GateResult {
    ok: boolean;
    /** 拒绝原因；ok 为 true 时为空。 */
    reasons: string[];
    /** 命中"一次性"措辞时给出提示，供 UI 展示。 */
    oneShot?: boolean;
}
/**
 * 校验一次写入。
 * @param write - 写入请求
 */
export declare function gate(write: MemoryWrite): GateResult;
/**
 * 从一段对话里挑出**候选**记忆（不做最终判断，只给 UI/模型看）。
 * @param text - 一段对话或任务结论
 * @returns 候选句子（含"以后/总是/约定/不要"等信号词）
 */
export declare function candidates(text: string): string[];
