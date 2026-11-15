/** 触发源层入口（B2-02 / B2-03 / B5）：配置、归一化、建票判定、样例。 */
export { githubWatchSpec, verifyGithubDelivery, githubMentions } from './github.ts';
export type { GithubWatchOptions } from './github.ts';
export { feishuWatchSpec } from './feishu.ts';
export type { FeishuWatchOptions } from './feishu.ts';
export { buildRegistry, toRequest, verifySourceAuth, normalizeSource } from './registry.ts';
export { shouldOpenTicket, toTicketTriggers } from './triggers.ts';
export { ingestAndOpenTickets } from './pipeline.ts';
export type { IngestOutcome } from './pipeline.ts';
export { sampleWatchSpecs, SAMPLE_PATCH_YAML } from './config-sample.ts';
export type { WatchOptions, WatchSpec, NormalizeInput, TicketTriggerOptions, IngestSummary, } from './types.ts';
