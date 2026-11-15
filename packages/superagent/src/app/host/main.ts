/**
 * B2-01 主入口：dsh-superagent。
 *
 * 装配层，不是第二个引擎宿主。Engine 由 orchestrator-plugin 常驻并注入，
 * 本入口只把 19 个工具、7 个视图、Remote 与触发源接成完整清单。
 */

import { INJECT_SERVICES, createAssembly, install } from './assembly.ts'
import type { AssemblyDeps, AssemblyManifest, HostContext, MainConfig } from './assembly.ts'

/** cordis 插件 id。 */
export const name = 'dsh-superagent'
/** 声明的逻辑服务依赖（11 个），真实 ctx 键映射由 harness-port 收口。 */
export const inject: readonly string[] = INJECT_SERVICES

/**
 * 挂载装配层。
 * @param ctx - 可注入的宿主上下文（不 import cordis）
 * @param deps - 领域依赖；engine 必须来自 orchestrator-plugin 的常驻实例
 * @param config - 触发源与视图的注入配置
 */
export function apply(ctx: HostContext, deps: AssemblyDeps, config: MainConfig = {}): AssemblyManifest {
  return install(ctx, deps, config)
}

export { createAssembly }
export type { AssemblyDeps, AssemblyManifest, HostContext, MainConfig } from './assembly.ts'
