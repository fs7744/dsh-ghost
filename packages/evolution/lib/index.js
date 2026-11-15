/**
 * 进化与配置：C10-05/06/07（记忆/剧本/技能进化 + 度量）、C11-03（压缩配置）、C11-07（GHOST.md 草案）。
 * 全部零 DOM、零网络、可注入依赖；宿主 Remote 只做薄封装。
 */
export { memoryFileIo, nodeFileIo } from './io.js';
export { appendRun, compareMetrics, dashboard, encodeRun, parseRun, readRuns, summarize, } from './metrics.js';
export { applyProposal, approve, canRollback, createProposalStore, proposeFlowChange, proposeMemoryConstraint, proposeScriptPromotion, reject, rollback, textDiff, } from './proposals.js';
export { DEFAULT_COMPACTION, compactInvocation, deserializeCompaction, normalizeCompaction, serializeCompaction, toSettingsJson, validateCompaction, } from './compaction.js';
export { draftGhostMd, scanRepo, writeGhostDraft } from './init.js';
export { createEvolutionService } from './service.js';
