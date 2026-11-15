/**
 * 工具剪枝账本（对标 TokenEconomizer 的 tool pruning，但更保守）：
 * 只有「连续 N 次启动都没被调用」的可选工具才会被剪；核心工具永不剪；
 * 恢复过的工具会打上 restored，之后不再自动剪。
 */
/**
 * 默认允许被剪的可选工具：票据/报告/读取等核心能力不在其中。
 * 与 TOOL_DESCRIPTORS 解耦，CLI 与插件共用同一份名单。
 */
export const DEFAULT_OPTIONAL_TOOLS = [
    'orchestrator_settings_save', 'orchestrator_policy_sync', 'orchestrator_prompts_save',
    'orchestrator_eval', 'orchestrator_eval_read', 'orchestrator_eval_decide',
    'orchestrator_thread_unsubscribe', 'orchestrator_ticket_note',
];
/** 空账本。 */
export function emptyLedger() {
    return { version: 1, boots: 0, tools: {} };
}
/** 开始一轮启动：boots+1，并为当前注册的工具补账。 */
export function beginBoot(ledger, toolNames, now = new Date().toISOString()) {
    const tools = { ...ledger.tools };
    for (const name of toolNames) {
        const previous = tools[name];
        tools[name] = {
            calls: previous?.calls ?? 0,
            failures: previous?.failures ?? 0,
            seenBoots: (previous?.seenBoots ?? 0) + 1,
            lastUsedBoot: previous?.lastUsedBoot ?? 0,
            firstSeenAt: previous?.firstSeenAt ?? now,
            ...(previous?.restored === true ? { restored: true } : {}),
        };
    }
    return {
        version: 1,
        boots: ledger.boots + 1,
        tools,
        ...(ledger.disabled === undefined ? {} : { disabled: ledger.disabled }),
        updatedAt: now,
    };
}
/** 记一次调用；失败也记，因为失败说明模型仍在用它。 */
export function recordToolCall(ledger, name, ok, now = new Date().toISOString()) {
    const previous = ledger.tools[name] ?? { calls: 0, failures: 0, seenBoots: 1, lastUsedBoot: 0 };
    return {
        ...ledger,
        tools: {
            ...ledger.tools,
            [name]: {
                ...previous,
                calls: previous.calls + 1,
                failures: previous.failures + (ok ? 0 : 1),
                lastUsedBoot: ledger.boots,
            },
        },
        updatedAt: now,
    };
}
/** 人工恢复：永久保留，不再进入自动剪枝。 */
export function restoreTool(ledger, name, now = new Date().toISOString()) {
    const previous = ledger.tools[name] ?? { calls: 0, failures: 0, seenBoots: 1, lastUsedBoot: 0 };
    return {
        ...ledger,
        tools: { ...ledger.tools, [name]: { ...previous, restored: true } },
        updatedAt: now,
    };
}
/**
 * 计算本次启动应剪掉的可选工具。
 * @param ledger - 当前账本
 * @param optionalNames - 允许被剪的工具名
 * @param options - 门槛 / 核心保留名单
 */
export function pruneUnusedTools(ledger, optionalNames, options = {}) {
    const minBoots = options.minBoots ?? 5;
    const minAgeDays = options.minAgeDays ?? 7;
    const now = options.now ?? Date.now();
    const keep = new Set(options.keep ?? []);
    if (ledger.boots < minBoots)
        return [];
    return optionalNames.filter(name => {
        if (keep.has(name))
            return false;
        const stat = ledger.tools[name];
        if (stat === undefined)
            return false;
        if (stat.restored === true)
            return false;
        if (stat.calls !== 0 || stat.seenBoots < minBoots)
            return false;
        // 没有时间戳的旧账本按“刚见到”处理，宁可晚剪也不误剪。
        const first = stat.firstSeenAt === undefined ? now : Date.parse(stat.firstSeenAt);
        return Number.isFinite(first) && now - first >= minAgeDays * 86_400_000;
    });
}
/**
 * 估算剪掉这些工具能省下的定义体积（字符数，不是 token）。
 * 只用于日志/看板，不参与决策。
 */
export function estimateToolChars(descriptors, pruned) {
    const names = new Set(pruned);
    return descriptors
        .filter(descriptor => names.has(descriptor.name))
        .reduce((sum, descriptor) => sum + descriptor.name.length + descriptor.description.length + JSON.stringify(descriptor.parameters).length, 0);
}
