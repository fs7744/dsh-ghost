/**
 * 工具剪枝账本（对标 TokenEconomizer 的 tool pruning，但更保守）：
 * 只有「连续 N 次启动都没被调用」的可选工具才会被剪；核心工具永不剪；
 * 恢复过的工具会打上 restored，之后不再自动剪。
 */
export interface ToolUseStat {
    /** 本账本生命周期内的调用次数。 */
    calls: number;
    /** 失败次数，只用于诊断，不参与剪枝。 */
    failures: number;
    /** 经历过多少次宿主启动。 */
    seenBoots: number;
    /** 最后一次调用发生在第几次启动；从未调用为 0。 */
    lastUsedBoot: number;
    /** 第一次见到这个工具的时间（ISO）。 */
    firstSeenAt?: string;
    /** 人工恢复过：永久保留。 */
    restored?: boolean;
}
export interface ToolLedger {
    version: 1;
    /** 宿主启动次数；每次 apply 加一。 */
    boots: number;
    tools: Record<string, ToolUseStat>;
    /** 人工/CLI 明确停用的工具：下次宿主启动不再注册，restore 可移除。 */
    disabled?: string[];
    updatedAt?: string;
}
/**
 * 默认允许被剪的可选工具：票据/报告/读取等核心能力不在其中。
 * 与 TOOL_DESCRIPTORS 解耦，CLI 与插件共用同一份名单。
 */
export declare const DEFAULT_OPTIONAL_TOOLS: readonly ['orchestrator_settings_save', 'orchestrator_policy_sync', 'orchestrator_prompts_save', 'orchestrator_eval', 'orchestrator_eval_read', 'orchestrator_eval_decide', 'orchestrator_thread_unsubscribe', 'orchestrator_ticket_note'];
export interface ToolPruneOptions {
    /** 至少经历多少次启动才允许剪；默认 5（对标 s=5 sessions）。 */
    minBoots?: number;
    /** 这些工具永不剪（核心工具）。 */
    keep?: readonly string[];
    /** 至少观察多少天；默认 7 天，避免几次短启动就误剪。 */
    minAgeDays?: number;
    /** 当前时间（毫秒），测试可注入。 */
    now?: number;
}
/** 空账本。 */
export declare function emptyLedger(): ToolLedger;
/** 开始一轮启动：boots+1，并为当前注册的工具补账。 */
export declare function beginBoot(ledger: ToolLedger, toolNames: readonly string[], now?: string): ToolLedger;
/** 记一次调用；失败也记，因为失败说明模型仍在用它。 */
export declare function recordToolCall(ledger: ToolLedger, name: string, ok: boolean, now?: string): ToolLedger;
/** 人工恢复：永久保留，不再进入自动剪枝。 */
export declare function restoreTool(ledger: ToolLedger, name: string, now?: string): ToolLedger;
/**
 * 计算本次启动应剪掉的可选工具。
 * @param ledger - 当前账本
 * @param optionalNames - 允许被剪的工具名
 * @param options - 门槛 / 核心保留名单
 */
export declare function pruneUnusedTools(ledger: ToolLedger, optionalNames: readonly string[], options?: ToolPruneOptions): string[];
/**
 * 估算剪掉这些工具能省下的定义体积（字符数，不是 token）。
 * 只用于日志/看板，不参与决策。
 */
export declare function estimateToolChars(descriptors: ReadonlyArray<{
    name: string;
    description: string;
    parameters: unknown;
}>, pruned: readonly string[]): number;
