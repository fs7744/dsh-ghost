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

/** 宿主给出的真实用量（`session/projections` → `values`）。 */
export interface HarnessUsage {
  /** 未命中缓存的输入 token。 */
  uncachedInputTokens: number
  /** 命中缓存读到的 token（便宜得多）。 */
  cacheReadTokens: number
  /** 写入缓存的 token。 */
  cacheWriteTokens: number
  /** 输出 token。 */
  outputTokens: number
  /** 本轮总输入（未缓存 + 缓存读）。 */
  totalInputTokens: number
  /** 系统提示占用的 token。 */
  systemTokens: number
  /** 工具定义占用的 token。 */
  toolsTokens: number
  /** 对话消息占用的 token。 */
  messageTokens: number
  /** 宿主估算的上下文占用。 */
  projectedTokens: number
  /** 模型上下文窗口。 */
  contextWindow: number
  /** 占用比例（0..1）。 */
  ratio: number
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function obj(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

/**
 * 从 `session/projections` 的返回值里读真实用量。
 * 拿不到就返回全 0（调用方自行决定是否退回估算）。
 */
export function readHarnessUsage(projections: unknown): HarnessUsage {
  const values = obj(obj(projections).values)
  const usage = obj(values.tokenUsage)
  const pressure = obj(values.contextPressure)
  const breakdown = obj(values.contextBreakdown)
  const projectedTokens = num(pressure.projectedTokens)
  const contextWindow = num(pressure.contextWindow)
  const uncachedInputTokens = num(usage.uncachedInputTokens)
  const cacheReadTokens = num(usage.cacheReadTokens)
  const cacheWriteTokens = num(usage.cacheWriteTokens)
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
  }
}

/**
 * 该不该提醒用户压缩。
 * 宿主在 80% 会自己压，所以我们只在**明显更高**（默认 90%）时提醒，
 * 免得在宿主刚压完又去多花一次模型调用。
 */
export function shouldSuggestCompaction(
  usage: HarnessUsage,
  options: { thresholdRatio?: number; minProjectedTokens?: number } = {},
): boolean {
  const thresholdRatio = options.thresholdRatio ?? 0.9
  const minProjectedTokens = options.minProjectedTokens ?? 0
  if (usage.contextWindow <= 0) return false
  if (usage.projectedTokens < minProjectedTokens) return false
  return usage.ratio >= thresholdRatio
}
