/**
 * B2-02 / B5-01：dsh-superagent/github-watch 触发源入口。
 *
 * 只产出一份声明式 SourceSpec，交给 ghostSources/ingest 归一化：
 * 签名复用 source-github 的 verifySignature，事件映射复用 source-hub 的 github 适配器。
 * GitHub 逻辑不写死在插件里，也不碰 Engine。
 */
import type { GithubWatchOptions } from '../../sources/github.ts';
import type { HostContext, WatchAssembly } from './assembly.ts';
/** cordis 插件 id。 */
export declare const name = "dsh-superagent/github-watch";
/** 触发源入口声明的依赖。 */
export declare const inject: readonly string[];
/** 纯函数：产出 GitHub 触发源的装配清单。 */
export declare function createGithubWatchAssembly(options?: GithubWatchOptions): WatchAssembly;
/** 挂载：把启用中的 spec 交给 ghostSources 注册表。 */
export declare function apply(ctx: HostContext, options?: GithubWatchOptions): WatchAssembly;
export type { GithubWatchOptions };
