import { type FileIo } from './io.ts';
/** 提案类型。 */
export type ProposalKind = 'memory' | 'flow' | 'script';
/** 提案状态：人闸前 pending，人确认 approved，驳回 rejected，回滚 rolled-back。 */
export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'rolled-back';
/** 一次错误/返工记录。 */
export interface Occurrence {
    at: string;
    note?: string;
}
/** 要升为 L2 项目记忆的约束。 */
export interface ConstraintDraft {
    name: string;
    title: string;
    text: string;
    source: string;
}
/** 一次提案。全部是数据，落盘即 JSON 文件。 */
export interface Proposal {
    id: string;
    kind: ProposalKind;
    status: ProposalStatus;
    title: string;
    reason: string;
    createdAt: string;
    /** 触发证据（人话，逐条）。 */
    evidence: string[];
    decidedAt?: string;
    decidedBy?: string;
    /** kind=memory：要写入 L2 的约束。 */
    constraint?: ConstraintDraft;
    /** kind=flow：.flow 的改动与度量。 */
    flowChange?: {
        nodeName: string;
        before: string;
        after: string;
        diff: string[];
        beforeMetrics: Record<string, number>;
        afterMetrics: Record<string, number>;
    };
    /** kind=script：要沉淀的脚本。 */
    scriptChange?: {
        path: string;
        content: string;
        passCount: number;
    };
}
/** 生成提案时的可注入依赖（时间源 / id 源），测试可固定。 */
export interface ProposalDeps {
    now?: () => Date;
    makeId?: () => string;
}
/**
 * 行级 LCS diff，输出统一 diff 风格的 `-/+/空` 行数组。
 * 零跨包依赖：本包不 import playbook，避免宿主运行时多一层解析。
 */
export declare function textDiff(before: string, after: string): string[];
/** C10-05：同一错误/返工出现 3 次才生成「升为约束」提案；不足 3 次返回 undefined。 */
export declare function proposeMemoryConstraint(input: {
    key: string;
    occurrences: readonly Occurrence[];
    constraint: ConstraintDraft;
    title?: string;
    reason?: string;
} & ProposalDeps): Proposal | undefined;
/** C10-06：返工归因到具体 `.flow` 节点 → 产出 `.flow` 修改提案（diff + before/after 度量）。 */
export declare function proposeFlowChange(input: {
    nodeName: string;
    before: string;
    after: string;
    reworks: readonly Occurrence[];
    beforeMetrics: Record<string, number>;
    afterMetrics: Record<string, number>;
} & ProposalDeps): Proposal;
/** C10-06：脚本**连续** 2 次跑通 → 产出沉淀进 scripts/ 的提案；否则 undefined。 */
export declare function proposeScriptPromotion(input: {
    path: string;
    content: string;
    runs: ReadonlyArray<{
        ok: boolean;
    }>;
} & ProposalDeps): Proposal | undefined;
/** 纯状态迁移：批准。 */
export declare function approve(proposal: Proposal, by?: string, deps?: ProposalDeps): Proposal;
/** 纯状态迁移：驳回。 */
export declare function reject(proposal: Proposal, by?: string, deps?: ProposalDeps): Proposal;
/** 只有已批准的提案能回滚。 */
export declare function canRollback(proposal: Proposal): boolean;
/** 纯状态迁移：回滚（撤销一次已批准的进化）。 */
export declare function rollback(proposal: Proposal, by?: string, deps?: ProposalDeps): Proposal;
/** 应用提案的注入口：只有外部显式提供写入器才会真的落盘。 */
export interface ApplySinks {
    /** 写 L2 项目记忆（memory 提案批准时调用）。 */
    writeMemory?: (constraint: ConstraintDraft) => Promise<void> | void;
}
/**
 * 应用一份提案——**显式调用、绝不静默**。
 * 只有 memory 且已批准才写 L2；flow / script 提案一律只作为文件待人工合入（git/PR），
 * 运行时不自动改仓库里的 `.flow` 或 `scripts/`。
 */
export declare function applyProposal(proposal: Proposal, sinks?: ApplySinks): Promise<{
    applied: boolean;
    reason: string;
}>;
/** 提案仓库：每个提案一个 JSON 文件，可查看、可评审、可 git 回滚。 */
export interface ProposalStore {
    list(): Promise<Proposal[]>;
    get(id: string): Promise<Proposal | undefined>;
    put(proposal: Proposal): Promise<void>;
}
/** 构造提案仓库；io 可注入（测试用内存实现）。 */
export declare function createProposalStore(root: string, io?: FileIo): ProposalStore;
