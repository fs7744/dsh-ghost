/**
 * 剧本运行时：脚本执行（C9-10）、输出协议（C9-11）、references 分层加载（C9-12）。
 * 全部零 DOM、零网络、可注入依赖，供 node:test 与宿主插件共用。
 */
export {
  CODES, coerceOutput, failure, formatOutput, helpLine, isHelp, parseOutput, success,
} from './protocol.ts'
export type { ScriptOutput } from './protocol.ts'
export { createRuntime, nodeRunner, runScript } from './runtime.ts'
export type {
  RunOutcome, RunRequest, Runner, RunnerCommand, RunnerResult, Runtime, RuntimeOptions,
} from './runtime.ts'
export { createReferences } from './references.ts'
export type { LayeredReferences, LoadedReference, ReferenceMeta, ReferencesOptions } from './references.ts'
