/**
 * 连通性自测（C3-02）：探测函数由调用方注入，结果统一归一化。
 *
 * 纯逻辑本身不发任何请求；probe 可以是真 fetch、假端点、或测试里的同步 stub。
 * 归一化会丢掉耗时 / 时间 / id 等易变字段，只留结构信号，便于断言与回放。
 */
import type { ProviderSpec } from './core.ts';
export interface ProbeOutcome {
    ok: boolean;
    status?: number;
    error?: string;
    models?: readonly string[];
}
export type ProbeFn = (provider: ProviderSpec) => Promise<unknown> | unknown;
/** 把各种形状的探测结果归一化成统一结构；易变字段一律丢弃。 */
export declare function normalizeProbeResult(raw: unknown): ProbeOutcome;
/** 归一化结果的可读标签（界面与 CLI 共用一份文案口径）。 */
export declare function describeProbe(outcome: ProbeOutcome): string;
export interface ConnectivityReport extends ProbeOutcome {
    label: string;
}
/** 调一次可注入 probe，捕获异常并归一化；绝不把原始异常直接抛给界面。 */
export declare function runConnectivityProbe(provider: ProviderSpec, probe: ProbeFn): Promise<ConnectivityReport>;
