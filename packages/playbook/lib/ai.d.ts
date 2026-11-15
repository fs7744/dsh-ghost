/**
 * C9-06 / C9-07：AI 生成流程图 与 AI 局部重写。
 *
 * 两条硬要求：
 *  1. **可注入的生成器接口**：默认实现是确定性的模板/规则生成（无需模型、无需 key），
 *     真模型实现只要实现同一个接口即可替换；
 *  2. **产物过同一道校验**：生成/重写的结果一律走 `parseFlow` + `validate`，
 *     非法即抛错，绝不落盘（对应 docs/PLAYBOOK.md §6.3）。
 *
 * 全部纯函数：零 DOM、零网络、零文件读写。
 */
import { type Flow } from './parse.ts';
/** 生成请求：一句自然语言 + 目标。 */
export interface GenerateRequest {
    /** 用户那句话，如「收到 issue 后走一遍验证再回复」。 */
    prompt: string;
    /** 剧本 id；缺省用确定性的 ai-flow。 */
    id?: string;
    /** 验收目标，写进 `# goal`；缺省用 prompt。 */
    goal?: string;
    /** 触发条件，写进 `# when`。 */
    when?: string;
}
/** 可注入的生成器：输入请求，输出一段 `.flow` 文本（不负责校验）。 */
export interface FlowGenerator {
    generate(request: GenerateRequest): string;
}
/** 选中的局部：节点名，或某节点上的一条条件边。 */
export interface RewriteSelection {
    node?: string;
    on?: string;
}
/** 局部重写请求：当前文本 + 一句指令 + 选中范围。 */
export interface RewriteRequest {
    text: string;
    instruction: string;
    selection: RewriteSelection;
}
/** 可注入的局部重写器：输入请求，输出改写后的整段 `.flow` 文本。 */
export interface FlowRewriter {
    rewrite(request: RewriteRequest): string;
}
/** 生成/重写的合法产物。 */
export interface Generated {
    text: string;
    flow: Flow;
    /** 恒为空数组：非法产物直接抛错，不会带着错误返回。 */
    errors: string[];
}
/**
 * 确定性模板生成：不需要模型、不需要 key。
 * 结构固定（顺序链 + 两条带 max 的回边 + 一个人闸），因此**必定**通过校验；
 * 关键词只决定中间插入哪些步骤，不影响合法性。
 */
export declare const templateGenerator: FlowGenerator;
/**
 * 确定性局部重写：只改选中节点自身的属性或出边，不增删/改名任何节点。
 * 因此「其它节点 id / 顺序 / 坐标语义」天然保留（坐标由 toGraph 现算，从不落盘）。
 */
export declare const templateRewriter: FlowRewriter;
/**
 * C9-06：一句话生成一张合法流程图。
 * @param request - 自然语言与目标
 * @param generator - 可注入生成器；缺省为确定性模板实现
 * @throws 产物未通过 `parseFlow` + `validate` 时抛错
 */
export declare function generateFlow(request: GenerateRequest, generator?: FlowGenerator): Generated;
/**
 * C9-07：只重写局部，并强制守住「其它节点 id / 顺序不变」。
 * @param request - 当前文本 + 指令 + 选中节点
 * @param rewriter - 可注入重写器；缺省为确定性模板实现
 * @throws 产物非法，或改动蔓延到选中节点之外时抛错
 */
export declare function rewriteFlow(request: RewriteRequest, rewriter?: FlowRewriter): Generated;
