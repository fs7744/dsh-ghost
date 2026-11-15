/**
 * B2-03 / B5-02 飞书触发源入口（默认关闭）。
 *
 * 完全声明式：kind=generic，字段走 GenericMapping 的 {{路径}} 模板，
 * 签名走 source-hub 的通用 HMAC（头名 / 算法 / 前缀 / 密钥来源全部可配）。
 * 不硬编码任何 token；要启用必须显式 enabled: true 并配好 FEISHU_WEBHOOK_SECRET。
 */
import type { WatchOptions, WatchSpec } from './types.ts';
/** 飞书触发源的可配置项。 */
export interface FeishuWatchOptions extends WatchOptions {
    /** 点名 agent 的别名，正文含它即算 addressed。 */
    mention?: string;
    /** 只处理的事件名。 */
    eventName?: string;
}
/** 产出一份声明式飞书 spec；默认 enabled=false，即「默认关闭」。 */
export declare function feishuWatchSpec(options?: FeishuWatchOptions): WatchSpec;
