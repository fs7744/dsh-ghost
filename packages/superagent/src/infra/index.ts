/** B7 部署与自检入口：自检 / SETUP / 看护 / 服务脚本。 */
export {
  runSelfCheck, containsSelfBuiltOrchestratorRoute, findSelfBuiltRoutes,
  EXIT_OK, EXIT_INCOMPLETE, EXIT_SECURITY,
} from './selfcheck.ts'
export type { CheckItem, SelfCheckInput, SelfCheckResult } from './selfcheck.ts'
export {
  SETUP_STEPS, buildSetupPlan, executeSetupPlan, runSetup,
} from './setup.ts'
export type {
  SetupQuestion, SetupStep, SetupPlan, SetupIO, SetupExecutor, SetupResult,
} from './setup.ts'
export {
  DEFAULT_WATCHDOG_INTERVAL_MS, initialWatchdogState, nextBackoffMs,
  watchdogTick, runWatchdog, startWatchdog,
} from './watchdog.ts'
export type { WatchdogOptions, WatchdogState, WatchdogDeps, WatchdogTick } from './watchdog.ts'
export {
  parseArgs, runService, checkAssets, scanRepositoryForRoutes,
  createFileExecutor, defaultIO, USAGE,
} from './service.ts'
export type {
  ServiceCommand, ServiceExecutor, ServiceIO, ServiceDeps, FileExecutorOptions,
} from './service.ts'
