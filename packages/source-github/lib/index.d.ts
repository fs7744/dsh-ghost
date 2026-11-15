import type { Trigger } from '@dsh-ghost/superagent';
/** 一个来源的配置。 */
export interface GithubSourceOptions {
    /** webhook 密钥；为空时默认拒绝（fail-closed）。 */
    secret?: string;
    /** 显式允许无签名（仅本地调试）；不设就绝不接受无密钥投递。 */
    allowUnsigned?: boolean;
    /** agent 在 GitHub 上的登录名，用于判断是否被 @。 */
    botLogin?: string;
    /** 额外要监听的 @ 名字（含 @ 前缀与否都行）。 */
    mentionAliases?: string[];
}
/** 校验结果。 */
export type SignatureResult = {
    ok: true;
} | {
    ok: false;
    reason: string;
};
/**
 * 校验 GitHub webhook 签名。
 * @param options - 含密钥的来源配置
 * @param rawBody - **原始字节**（不能是重新序列化的 JSON，否则签名必然不匹配）
 * @param header - `x-hub-signature-256` 头的值，形如 `sha256=…`
 */
export declare function verifySignature(options: GithubSourceOptions, rawBody: string, header: string | undefined): SignatureResult;
/** GitHub webhook 的最小结构（只取用得到的字段）。 */
interface Payload {
    action?: string;
    issue?: {
        number: number;
        title?: string;
        body?: string;
        html_url?: string;
        pull_request?: unknown;
    };
    pull_request?: {
        number: number;
        title?: string;
        body?: string;
        html_url?: string;
        merged?: boolean;
    };
    comment?: {
        body?: string;
        html_url?: string;
        user?: {
            login?: string;
            type?: string;
        };
    };
    sender?: {
        login?: string;
        type?: string;
    };
    repository?: {
        full_name?: string;
        owner?: {
            login?: string;
        };
        name?: string;
    };
    review?: {
        state?: string;
        body?: string;
        html_url?: string;
    };
    installation?: {
        id?: number;
    };
}
/**
 * 一段文本是否点名了 agent。
 * @param text - 待检查的正文
 * @param options - 含 botLogin / mentionAliases 的配置
 */
export declare function mentionsAgent(text: string, options: GithubSourceOptions): boolean;
/**
 * webhook → Trigger。未知事件返回空数组。
 * @param event - `x-github-event` 头的值（issue_comment / issues / pull_request / pull_request_review）
 * @param payload - 解析后的 JSON
 * @param options - 来源配置
 * @param now - 时间源（测试可注入）
 */
export declare function toTriggers(event: string, payload: Payload, options?: GithubSourceOptions, now?: () => string): Trigger[];
export {};
