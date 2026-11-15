/** 触发源层入口（B2-02 / B2-03 / B5）：配置、归一化、建票判定、样例。 */
export { githubWatchSpec, verifyGithubDelivery, githubMentions } from './github.js';
export { feishuWatchSpec } from './feishu.js';
export { buildRegistry, toRequest, verifySourceAuth, normalizeSource } from './registry.js';
export { shouldOpenTicket, toTicketTriggers } from './triggers.js';
export { ingestAndOpenTickets } from './pipeline.js';
export { sampleWatchSpecs, SAMPLE_PATCH_YAML } from './config-sample.js';
