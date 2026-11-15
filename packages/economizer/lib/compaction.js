/**
 * 上下文预算与用量读取（纯逻辑）。
 *
 * 范围说明（重要）：**用量与就地压缩都由宿主提供**，我们不重复造：
 *  - 宿主 `dsh-token-meter` 已经在 `session/projections` 里给出真实 token
 *    （`tokenUsage` 含缓存读写、`contextPressure` 含压力、`contextBreakdown` 拆系统/工具/消息）；
 *  - 宿主 `dsh-compaction-basic` 已在 80% 压力自动压缩，`dsh-command-compact` 提供 `/compact`；
 *  - 宿主 `dsh-compaction-tool-result-pruner` 已裁剪超长工具结果。
 *
 * 我们负责的是「产品层」的那部分：
 *  - 读懂宿主的真实用量（而不是自己瞎估）；
 *  - 在该提醒的时候提醒（界面提示，而不是重复触发一次要花钱的压缩）；
 *  - 兜底：拿不到投影时，用启发式估算给个粗略值。
 */
/**
 * 估算 token：CJK 约 1 字 1 token，其余约 4 字符 1 token。
 * 只是量级判断，不追求与真实分词器一致。
 */
export function estimateTokens(text) {
    let cjk = 0;
    let other = 0;
    for (const char of text) {
        const code = char.codePointAt(0) ?? 0;
        if (code > 0x2e80)
            cjk += 1;
        else
            other += 1;
    }
    return Math.ceil(cjk + other / 4);
}
/**
 * 判断当前上下文是否该压缩。
 */
export function planCompaction(messages, options = {}) {
    const maxTokens = options.maxTokens ?? 12_000;
    const minMessages = options.minMessages ?? 8;
    const estimatedTokens = messages.reduce((sum, message) => sum + estimateTokens(message.text), 0);
    const messageCount = messages.length;
    const overflowTokens = Math.max(0, estimatedTokens - maxTokens);
    return {
        compress: estimatedTokens > maxTokens && messageCount >= minMessages,
        estimatedTokens,
        messageCount,
        overflowTokens,
    };
}
function num(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
function obj(value) {
    return typeof value === 'object' && value !== null ? value : {};
}
/**
 * 从 `session/projections` 的返回值里读真实用量。
 * 拿不到就返回全 0（调用方自行决定是否退回估算）。
 */
export function readHarnessUsage(projections) {
    const values = obj(obj(projections).values);
    const usage = obj(values.tokenUsage);
    const pressure = obj(values.contextPressure);
    const breakdown = obj(values.contextBreakdown);
    const projectedTokens = num(pressure.projectedTokens);
    const contextWindow = num(pressure.contextWindow);
    const uncachedInputTokens = num(usage.uncachedInputTokens);
    const cacheReadTokens = num(usage.cacheReadTokens);
    const cacheWriteTokens = num(usage.cacheWriteTokens);
    return {
        uncachedInputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        outputTokens: num(usage.outputTokens),
        totalInputTokens: uncachedInputTokens + cacheReadTokens,
        systemTokens: num(breakdown.systemTokens),
        toolsTokens: num(breakdown.toolsTokens),
        messageTokens: num(breakdown.messageTokens),
        projectedTokens,
        contextWindow,
        ratio: contextWindow > 0 ? Math.min(1, projectedTokens / contextWindow) : 0,
    };
}
/**
 * 该不该提醒用户压缩。
 * 宿主在 80% 会自己压，所以我们只在**明显更高**（默认 90%）时提醒，
 * 免得在宿主刚压完又去多花一次模型调用。
 */
export function shouldSuggestCompaction(usage, options = {}) {
    const thresholdRatio = options.thresholdRatio ?? 0.9;
    const minProjectedTokens = options.minProjectedTokens ?? 0;
    if (usage.contextWindow <= 0)
        return false;
    if (usage.projectedTokens < minProjectedTokens)
        return false;
    return usage.ratio >= thresholdRatio;
}
