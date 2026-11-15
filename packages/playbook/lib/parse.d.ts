/**
 * `.flow` 解析器：紧凑文本 → 图模型。
 *
 * 语法（设计目标：人可读、git diff 友好、模型省 token）：
 *
 *   # @ticket-flow v2                ← 剧本 id 与版本
 *   # when 触发条件（一行）
 *   # goal 验收目标（一行）
 *   # budget 可选配额（一行）
 *
 *   admit      : deny -> quiet       ← 条件跳转
 *   open-ticket                      ← 顺序步骤
 *   work       : blocked -> escalate (max 3)   ← 回退上限
 *   ?merge                           ← 人闸（需要人确认）
 *   call sub-flow                    ← 子剧本
 *   verify     @scripts/verify.mjs   ← 挂脚本
 *
 * 规则：顺序即边；一行一节点；名字即 id；`#` 开头是头/注释；空行忽略。
 */
/** 一条条件边。 */
export interface FlowEdge {
    /** 触发条件，如 `deny`；省略表示顺序边。 */
    on?: string;
    /** 目标节点名。 */
    to: string;
    /** 回边最多走几次；未写表示不限制（校验会要求回边必须写）。 */
    max?: number;
}
/** 一个节点。 */
export interface FlowNode {
    name: string;
    /** `step` 普通步骤；`gate` 需要人确认；`call` 子剧本。 */
    kind: 'step' | 'gate' | 'call';
    /** 子剧本 id（kind === 'call'）。 */
    call?: string;
    /** 挂载的脚本相对路径（kind 无关）。 */
    script?: string;
    /** 条件边与非顺序边。 */
    edges: FlowEdge[];
    /** 源码行号，供 UI 定位。 */
    line: number;
}
/** 一张完整的剧本图。 */
export interface Flow {
    id: string;
    version?: string;
    when?: string;
    goal?: string;
    budget?: string;
    nodes: FlowNode[];
}
/** 解析结果。 */
export interface ParseResult {
    flow: Flow;
    errors: string[];
}
/**
 * 解析一段 `.flow` 文本。
 * @param text - 文件内容
 * @returns 图模型与错误清单（有错误时 flow 仍尽量返回，便于 UI 部分渲染）
 */
export declare function parseFlow(text: string): ParseResult;
/** 顺序边：节点 i → 节点 i+1（最后一个是终点）。 */
export declare function sequenceEdges(flow: Flow): Map<string, string>;
