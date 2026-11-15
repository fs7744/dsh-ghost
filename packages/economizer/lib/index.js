/**
 * TokenEconomizer 经验的本项目实现（纯逻辑、零 IO、零宿主依赖）。
 *
 * 现在只剩**宿主没有、我们独有**的部分：
 *  - tool-prune：按启动轮次 + 实际调用证据，剪掉长期未用的可选工具（宿主只裁结果，不裁定义）；
 *  - session-brief：把常驻记忆索引压成一小段，任务开始时前置，减少重复发现；
 *  - harness-usage / cost：读宿主真实 token（含缓存读写）并按给定单价换算成本；
 *  - redact：配置拒写明文密钥、显示前统一脱敏。
 *
 * 已删除的重复实现（改用宿主）：工具结果截断（dsh-compaction-tool-result-pruner）、
 * 重复调用提醒（dsh-repeat-tool-reminder）、token 估算（dsh-token-meter）。
 */
export { beginBoot, DEFAULT_OPTIONAL_TOOLS, emptyLedger, estimateToolChars, pruneUnusedTools, recordToolCall, restoreTool, } from './tool-prune.js';
export { buildMemoryBlock, buildSessionBrief, countMemoryEntries, } from './brief.js';
export { findPlainSecret, isEnvRefKey, isSecretKey, redactPreview, redactText, } from './redact.js';
export { EMPTY_PRICING, estimateCost, } from './cost.js';
export { readHarnessUsage, shouldSuggestCompaction, } from './compaction.js';
