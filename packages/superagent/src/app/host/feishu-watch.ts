/**
 * B2-03 / B5-02：dsh-superagent/feishu-watch 触发源入口（默认关闭）。
 *
 * 完全声明式：kind=generic 的字段映射 + 通用 HMAC 签名（头名 / 算法 / 前缀 / 密钥来源可配）。
 * 不硬编码任何 token；不显式 enabled:true 就只产出清单、不注册 spec。
 */

import { feishuWatchSpec } from '../../sources/feishu.ts'
import type { FeishuWatchOptions } from '../../sources/feishu.ts'
import type { HostContext, WatchAssembly } from './assembly.ts'

/** cordis 插件 id。 */
export const name = 'dsh-superagent/feishu-watch'
/** 触发源入口声明的依赖。 */
export const inject: readonly string[] = ['typert', 'logger', 'ghostSources']

/** 纯函数：产出飞书触发源的装配清单；默认 enabled=false。 */
export function createFeishuWatchAssembly(options: FeishuWatchOptions = {}): WatchAssembly {
  const watch = feishuWatchSpec(options)
  return {
    plugin: name,
    inject: [...inject],
    spec: watch.spec,
    enabled: watch.enabled,
    remotes: ['ghostSources/ingest'],
    division: [
      '用 @dsh-ghost/source-hub 的 generic 声明式映射与通用 HMAC 签名，头名 / 算法 / 前缀 / 密钥来源全部可配；',
      '默认关闭（enabled=false），不硬编码任何 token；',
      '启用后 spec 经 ghostSources/ingest 收单，不 new Engine。',
    ].join(''),
  }
}

/** 挂载：默认关闭，只有显式 enabled:true 才把 spec 交给注册表。 */
export function apply(ctx: HostContext, options: FeishuWatchOptions = {}): WatchAssembly {
  const assembly = createFeishuWatchAssembly(options)
  if (!assembly.enabled) {
    ctx.logger?.info('%s: 飞书源默认关闭，需显式配置 enabled=true 并配好密钥才注册', name)
    return assembly
  }
  if (ctx.registerSource !== undefined) ctx.registerSource(assembly.spec)
  ctx.logger?.info('%s: 飞书源已启用，spec=%s 交给 ghostSources/ingest', name, assembly.spec.id)
  return assembly
}

export type { FeishuWatchOptions }
