/** B7 部署与自检入口：自检 / SETUP / 看护 / 服务脚本。 */
export { runSelfCheck, containsSelfBuiltOrchestratorRoute, findSelfBuiltRoutes, EXIT_OK, EXIT_INCOMPLETE, EXIT_SECURITY, } from './selfcheck.js';
export { SETUP_STEPS, buildSetupPlan, executeSetupPlan, runSetup, } from './setup.js';
export { DEFAULT_WATCHDOG_INTERVAL_MS, initialWatchdogState, nextBackoffMs, watchdogTick, runWatchdog, startWatchdog, } from './watchdog.js';
export { parseArgs, runService, checkAssets, scanRepositoryForRoutes, createFileExecutor, defaultIO, USAGE, } from './service.js';
