/**
 * 触发源层（B5）的公共类型。
 *
 * 原始投递 → 签名校验 → 适配器归一化 → 判定是否建票 → 领域 Trigger。
 * 归一化与签名复用 @dsh-ghost/source-hub / @dsh-ghost/source-github，
 * 这里只做「来源配置」与「是否值得建票」的策略，不把任何一家服务的逻辑写死。
 */
import type { NormalizedEvent, SourceSpec } from '@dsh-ghost/source-hub';
/** 两个触发源共用的可配置签名项；密钥一律走 *Env，绝不写进配置。 */
export interface WatchOptions {
    /** 是否启用；飞书默认 false。 */
    enabled?: boolean;
    /** 签名密钥从哪个环境变量读。 */
    secretEnv?: string;
    /** 签名头名，可配。 */
    signatureHeader?: string;
    /** HMAC 算法，可配。 */
    signatureAlgorithm?: string;
    /** 签名值前缀，可配（如 GitHub 的 sha256=）。 */
    signaturePrefix?: string;
}
/** 一个触发源入口：source-hub 的声明式 spec + 本层的开关。 */
export interface WatchSpec {
    spec: SourceSpec;
    enabled: boolean;
}
/** 一次原始投递的输入；rawBody 必须是原始字节，签名才校验得过。 */
export interface NormalizeInput {
    headers?: Record<string, string>;
    rawBody?: string;
    body?: unknown;
    event?: string;
}
/** 归一化事件转领域 Trigger 的策略。 */
export interface TicketTriggerOptions {
    /** 只给 addressed 的事件建票，默认 true：主动引擎只接点名它的请求。 */
    requireAddressed?: boolean;
    /** 时间源，可注入以便测试确定性。 */
    now?: () => string;
    /** id 生成器，可注入以便测试确定性。 */
    makeId?: (event: NormalizedEvent, index: number) => string;
}
/** 归一化结果的极简摘要，供触发源入口与测试使用。 */
export interface IngestSummary {
    ok: boolean;
    reason?: string;
    events: NormalizedEvent[];
    tickets: number;
}
