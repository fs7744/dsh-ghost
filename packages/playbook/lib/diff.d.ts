/**
 * C9-05：两版 `.flow` 的结构化 diff 与校验提示。
 *
 * 设计取舍：**文本 diff 为主**（人 review 的是文本，git diff 友好），
 * 结构化 diff 为辅（给 UI 高亮到具体节点/边/条件）。两者都返回条目数组，
 * 前端不必自己再解析一遍文本。
 *
 * 这里是纯函数：零 DOM、零网络、不读写文件，输入两段文本即可。
 */
import { type Flow } from './parse.ts';
/** 一条文本 diff 行。`sign` 沿用统一 diff 的 -/+/空格约定。 */
export interface DiffLine {
    sign: '-' | '+' | ' ';
    text: string;
    oldLine?: number;
    newLine?: number;
}
/** 结构化改动的类型。 */
export type DiffChange = 'added' | 'removed' | 'changed';
/** 一条可给 UI 直接展示的结构化改动。 */
export interface DiffEntry {
    category: 'node' | 'edge' | 'meta';
    change: DiffChange;
    /** 人话描述，如「新增节点 verify」。 */
    text: string;
    /** 定位用：节点名、条件名、meta 字段名。 */
    node?: string;
    on?: string;
    field?: string;
    before?: string;
    after?: string;
}
/** 一次 diff 的完整结果。 */
export interface FlowDiff {
    entries: DiffEntry[];
    lines: DiffLine[];
    summary: {
        added: number;
        removed: number;
        changed: number;
    };
}
/**
 * 比较两版 `.flow` 文本。
 * @param beforeText - 旧版文本
 * @param afterText - 新版文本
 * @returns 结构化条目 + 文本 diff 行 + 汇总计数
 */
export declare function diffFlows(beforeText: string, afterText: string): FlowDiff;
/** 只取文本 diff 的可打印形式（`git diff` 风格的一行一条）。 */
export declare function formatDiff(diff: FlowDiff): string[];
/** 便捷封装：直接比较 parse 后的 Flow（UI 内存里已有图对象时用）。 */
export declare function diffFlowTexts(before: Flow, after: Flow): FlowDiff;
