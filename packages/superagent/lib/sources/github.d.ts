/**
 * B2-02 / B5-01 GitHub 触发源入口。
 *
 * 不把 GitHub 逻辑写死在插件里：
 *  - 签名校验直接复用 @dsh-ghost/source-github 的 verifySignature（HMAC-SHA256 + 恒定时间比较）；
 *  - @ 提及判定复用同包的 mentionsAgent；
 *  - 事件归一化交给 @dsh-ghost/source-hub 的 github 内置适配器（见 registry.ts）。
 * 这里只产出一份声明式 SourceSpec 与几个便利函数。
 */
import type { SignatureResult } from '@dsh-ghost/source-github';
import type { WatchOptions, WatchSpec } from './types.ts';
/** GitHub 触发源的可配置项。 */
export interface GithubWatchOptions extends WatchOptions {
    /** agent 在 GitHub 上的登录名，用于判断是否被 @。 */
    botLogin?: string;
    /** 额外要监听的 @ 名字。 */
    mentionAliases?: string[];
}
/** 产出一份可直接放进 sources 配置的 GitHub spec（默认启用）。 */
export declare function githubWatchSpec(options?: GithubWatchOptions): WatchSpec;
/**
 * 直接复用 source-github 的签名校验：rawBody 必须是原始字节，
 * 头名固定为 GitHub 的 x-hub-signature-256；secret 从环境变量读出来后传入。
 */
export declare function verifyGithubDelivery(rawBody: string, headers: Record<string, string>, secret: string | undefined): SignatureResult;
/** 复用 source-github 的 @ 提及判定，供触发源入口与测试核对。 */
export declare function githubMentions(body: string, options?: GithubWatchOptions): boolean;
