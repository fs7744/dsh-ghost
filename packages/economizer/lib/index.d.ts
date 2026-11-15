/**
 * TokenEconomizer 经验的本项目实现（纯逻辑、零 IO、零宿主依赖）。
 *
 * 三条主线：
 *  - tool-prune：按启动轮次 + 实际调用证据，剪掉长期未用的可选工具；
 *  - session-brief：把常驻记忆索引压成一小段，任务开始时前置，减少重复发现；
 *  - loop-guard：同一工具同一错误重复出现时，只加一行重定向，不重复烧回合。
 *
 * 另带工具结果截断：大输出只保留头部，避免把整棵树塞回上下文。
 */
export { beginBoot, DEFAULT_OPTIONAL_TOOLS, emptyLedger, estimateToolChars, pruneUnusedTools, recordToolCall, restoreTool, type ToolLedger, type ToolPruneOptions, type ToolUseStat, } from './tool-prune.ts';
export { buildMemoryBlock, buildSessionBrief, countMemoryEntries, type SessionBriefOptions, } from './brief.ts';
export { EMPTY_PRICING, estimateCost, type CostBreakdown, type Pricing, } from './cost.ts';
export { estimateTokens, planCompaction, readHarnessUsage, shouldSuggestCompaction, type ChatMessage, type CompactionPlan, type CompactionPlanOptions, type HarnessUsage, } from './compaction.ts';
export { LoopGuard, normalizeFailure, truncateToolResult, type LoopGuardOptions, } from './loop-guard.ts';
