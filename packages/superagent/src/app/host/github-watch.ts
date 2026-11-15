/**
 * B2-02 / B5-01：dsh-superagent/github-watch 触发源入口。
 *
 * 只产出一份声明式 SourceSpec，交给 ghostSources/ingest 归一化：
 * 签名复用 source-github 的 verifySignature，事件映射复用 source-hub 的 github 适配器。
 * GitHub 逻辑不写死在插件里，也不碰 Engine。
 */

import { githubWatchSpec } from '../../sources/github.ts'
import type { GithubWatchOptions } from '../../sources/github.ts'
import type { HostContext, WatchAssembly } from './assembly.ts'

/** cordis 插件 id。 */
export const name = 'dsh-superagent/github-watch'
/** 触发源入口声明的依赖。 */
export const inject: readonly string[] = ['typert', 'logger', 'ghostSources']

/** 纯函数：产出 GitHub 触发源的装配清单。 */
export function createGithubWatchAssembly(options: GithubWatchOptions = {}): WatchAssembly {
  const watch = githubWatchSpec(options)
  return {
    plugin: name,
    inject: [...inject],
    spec: watch.spec,
    enabled: watch.enabled,
    remotes: ['ghostSources/ingest'],
    division: [
      '签名校验复用 @dsh-ghost/source-github 的 verifySignature（HMAC-SHA256 + 恒定时间比较）；',
      '事件归一化复用 @dsh-ghost/source-hub 的 github 内置适配器；',
      '本入口只产出 SourceSpec，经 ghostSources/ingest 收单，不 new Engine、不重复注册 Remote。',
    ].join(''),
  }
}

/** 挂载：把启用中的 spec 交给 ghostSources 注册表。 */
export function apply(ctx: HostContext, options: GithubWatchOptions = {}): WatchAssembly {
  const assembly = createGithubWatchAssembly(options)
  if (assembly.enabled && ctx.registerSource !== undefined) ctx.registerSource(assembly.spec)
  ctx.logger?.info('%s: spec=%s enabled=%s，归一化走 ghostSources/ingest', name, assembly.spec.id, assembly.enabled)
  return assembly
}

export type { GithubWatchOptions }
