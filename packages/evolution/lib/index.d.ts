/**
 * 进化与配置：C10-05/06/07（记忆/剧本/技能进化 + 度量）、C11-03（压缩配置）、C11-07（GHOST.md 草案）。
 * 全部零 DOM、零网络、可注入依赖；宿主 Remote 只做薄封装。
 */
export { memoryFileIo, nodeFileIo } from './io.ts';
export type { FileIo, MemoryFileIo } from './io.ts';
export { appendRun, compareMetrics, dashboard, encodeRun, parseRun, readRuns, summarize, } from './metrics.ts';
export type { Dashboard, MetricComparison, MetricsSummary, RunRecord, } from './metrics.ts';
export { applyProposal, approve, canRollback, createProposalStore, proposeFlowChange, proposeMemoryConstraint, proposeScriptPromotion, reject, rollback, textDiff, } from './proposals.ts';
export type { ApplySinks, ConstraintDraft, Occurrence, Proposal, ProposalDeps, ProposalKind, ProposalStatus, ProposalStore, } from './proposals.ts';
export { DEFAULT_COMPACTION, compactInvocation, deserializeCompaction, normalizeCompaction, serializeCompaction, toSettingsJson, validateCompaction, } from './compaction.ts';
export type { CompactInvocation, CompactionConfig, KeepPolicy, SettingsShape, ValidationResult, } from './compaction.ts';
export { draftGhostMd, scanRepo, writeGhostDraft } from './init.ts';
export type { GhostDraft, RepoScan, WriteDraftResult } from './init.ts';
export { createEvolutionService } from './service.ts';
export type { DecideInput, DecideResult, EvolutionDeps, EvolutionService, MetricsInput, MetricsResult, ProposeInput, ProposeResult, } from './service.ts';
