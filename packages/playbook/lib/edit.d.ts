import { type Flow, type FlowNode } from './parse.ts';
/** 节点名约束：也要能被「条件 -> 目标」的解析器认出来。 */
export declare const NODE_NAME: RegExp;
/**
 * Flow → `.flow` 文本（parseFlow 的逆运算）。
 * @param flow - 剧本
 * @returns 可直接写回文件的紧凑文本
 */
export declare function stringifyFlow(flow: Flow): string;
/** 一次可撤销的编辑操作（都是数据，方便记录与回放）。 */
export type FlowEdit = {
    type: 'node.add';
    name: string;
    kind?: FlowNode['kind'];
    at?: number;
    script?: string;
} | {
    type: 'node.remove';
    name: string;
} | {
    type: 'node.rename';
    name: string;
    to: string;
} | {
    type: 'node.setKind';
    name: string;
    kind: FlowNode['kind'];
} | {
    type: 'node.setScript';
    name: string;
    script?: string;
} | {
    type: 'node.move';
    name: string;
    delta: number;
} | {
    type: 'edge.add';
    from: string;
    on: string;
    to: string;
    max?: number;
} | {
    type: 'edge.remove';
    from: string;
    on: string;
} | {
    type: 'edge.set';
    from: string;
    on: string;
    newOn?: string;
    to?: string;
    max?: number;
    clearMax?: boolean;
};
/** 编辑结果。`errors` 非空时 flow 保持原样；`notes` 是提示（如连带删除的边）。 */
export interface EditResult {
    flow: Flow;
    errors: string[];
    notes: string[];
}
/** 一次编辑 + 文本往返的完整结果。 */
export interface TextEditResult extends EditResult {
    text: string;
}
/**
 * 对剧本应用一次编辑。
 * @param source - 原剧本（不会被修改）
 * @param edit - 编辑操作
 * @returns 新剧本与错误/提示
 */
export declare function applyEdit(source: Flow, edit: FlowEdit): EditResult;
/**
 * 按顺序应用多步编辑；某步失败不会中断后面几步，错误会累积返回。
 * @param flow - 原剧本
 * @param edits - 编辑序列
 */
export declare function applyEdits(flow: Flow, edits: readonly FlowEdit[]): EditResult;
/**
 * UI 用的完整一步：从文本出发，编辑，再回写成新文本并重新解析校验。
 * 只有新文本能被解析且没有编辑错误时才返回新文本；否则原文不变。
 * @param text - 当前 `.flow` 文本（唯一真相源）
 * @param edit - 编辑操作
 */
export declare function editText(text: string, edit: FlowEdit): TextEditResult;
/** 同上，但一次走完多步编辑。 */
export declare function editTextAll(text: string, edits: readonly FlowEdit[]): TextEditResult;
