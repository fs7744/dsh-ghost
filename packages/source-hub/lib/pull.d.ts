import type { SourceRequest } from './types.ts';
/** 拉取配置。 */
export interface ApiPullConfig {
    /** 拉取地址。 */
    url: string;
    /** 请求方法，默认 GET。 */
    method?: 'GET' | 'POST';
    /** 请求头；值写 `env:NAME` 指向环境变量（不写明文密钥）。 */
    headers?: Record<string, string>;
    /** 请求体（POST 时使用）。 */
    body?: string;
    /** 列表在响应里的路径，如 `data.items`；省略表示整个响应就是一条。 */
    listPath?: string;
    /** 轮询间隔（分钟），最小 1。 */
    intervalMinutes?: number;
    /** 轮询间隔（秒），给测试与高频场景用；给了就优先用它。 */
    intervalSeconds?: number;
}
export interface PullResult {
    ok: boolean;
    /** 失败原因（人话）。 */
    reason?: string;
    /** 包好的原始投递，逐条走归一化。 */
    requests: SourceRequest[];
}
/** 解析请求头值：`env:NAME` 取环境变量，其余按字面量。 */
export declare function resolveHeaderValue(value: string, env?: NodeJS.ProcessEnv): string;
/**
 * 拉一次并包装成若干条 `SourceRequest`。
 * @param config - 拉取配置
 * @param options - 可注入 fetch / env（测试用）
 */
export declare function pullFromApi(config: ApiPullConfig, options?: {
    fetchImpl?: typeof fetch;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
}): Promise<PullResult>;
