/**
 * 编译器：图模型 → 完整 skill 包（`SKILL.md` 等文本件）。
 *
 * 三条硬规则（对应 docs/PLAYBOOK.md §8）：
 *  1. 校验不过就不产出——不允许"写着玩的剧本"上线
 *  2. 常驻的描述必须短（description 是每轮都要付的钱）
 *  3. 模型只看流程图正文；脚本只跑不看
 */
import { type Flow } from './parse.ts';
/** 编译选项。 */
export interface CompileOptions {
    /** 判断 `@script` 指向的文件是否存在；不传则跳过该检查。 */
    scriptExists?: (path: string) => boolean;
    /**
     * 节点详情：节点名 → Markdown 正文。
     * 有详情的节点在正文行尾加一个指针（`→ references/nodes/x.md`），
     * 模型只在需要时去读——这就是"二次按需"的落点。
     */
    nodeDetails?: Record<string, string>;
}
/** 一次编译的结果。 */
export interface CompiledPlaybook {
    flow: Flow;
    errors: string[];
    /** 相对路径 → 文本内容。 */
    files: Record<string, string>;
    /** 常驻成本（description）与按需成本（正文）的估算。 */
    tokens: {
        description: number;
        body: number;
    };
}
/** 粗略 token 估算：CJK 按 1 字 1 token，其余按 3.6 字符 1 token。 */
export declare function estimateTokens(text: string): number;
/**
 * 校验图模型。
 * @param flow - 解析结果
 * @param options - 脚本存在性检查
 * @returns 错误清单（空表示通过）
 */
export declare function validate(flow: Flow, options?: CompileOptions): string[];
/**
 * 把流程渲染成 SKILL.md 的正文（一行一节点，模型读的就是它）。
 * @param flow - 剧本
 * @param details - 有详情的节点名集合；只影响行尾指针，不影响语义
 */
export declare function renderBody(flow: Flow, details?: ReadonlySet<string>): string;
/** 生成 SKILL.md：常驻 description 必须短，正文才是流程图。 */
export declare function renderSkill(flow: Flow, details?: ReadonlySet<string>): {
    description: string;
    content: string;
};
/**
 * 一次编译：解析 → 校验 → 产出文本件。
 * @param text - `.flow` 内容
 * @param options - 编译选项
 */
export declare function compilePlaybook(text: string, options?: CompileOptions): CompiledPlaybook;
