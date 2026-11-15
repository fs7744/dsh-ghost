/**
 * B2-02 / B5-01 GitHub 触发源入口。
 *
 * 不把 GitHub 逻辑写死在插件里：
 *  - 签名校验直接复用 @dsh-ghost/source-github 的 verifySignature（HMAC-SHA256 + 恒定时间比较）；
 *  - @ 提及判定复用同包的 mentionsAgent；
 *  - 事件归一化交给 @dsh-ghost/source-hub 的 github 内置适配器（见 registry.ts）。
 * 这里只产出一份声明式 SourceSpec 与几个便利函数。
 */
import { mentionsAgent, verifySignature } from '@dsh-ghost/source-github';
/** 产出一份可直接放进 sources 配置的 GitHub spec（默认启用）。 */
export function githubWatchSpec(options = {}) {
    const enabled = options.enabled ?? true;
    const spec = {
        id: 'github',
        kind: 'github',
        description: 'GitHub webhook（issue / PR / 评论 / review，@ 提及才建票）',
        auth: {
            type: 'hmac',
            header: options.signatureHeader ?? 'x-hub-signature-256',
            prefix: options.signaturePrefix ?? 'sha256=',
            algorithm: options.signatureAlgorithm ?? 'sha256',
            secretEnv: options.secretEnv ?? 'GH_WEBHOOK_SECRET',
        },
        options: {
            botLogin: options.botLogin ?? '',
            mentionAliases: options.mentionAliases ?? [],
            enabled,
        },
    };
    return { spec, enabled };
}
/**
 * 直接复用 source-github 的签名校验：rawBody 必须是原始字节，
 * 头名固定为 GitHub 的 x-hub-signature-256；secret 从环境变量读出来后传入。
 */
export function verifyGithubDelivery(rawBody, headers, secret) {
    const options = secret === undefined ? {} : { secret };
    return verifySignature(options, rawBody, headers['x-hub-signature-256']);
}
/** 复用 source-github 的 @ 提及判定，供触发源入口与测试核对。 */
export function githubMentions(body, options = {}) {
    return mentionsAgent(body, { botLogin: options.botLogin ?? '', mentionAliases: options.mentionAliases ?? [] });
}
