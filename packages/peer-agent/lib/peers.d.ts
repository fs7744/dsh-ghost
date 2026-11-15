import type { PeerAgent, PeerKind, PeerResult } from './types.ts';
export type { PeerAgent, PeerKind, PeerResult } from './types.ts';
/** 允许的 peer 类型。 */
export declare const PEER_KINDS: readonly PeerKind[];
/** 配置校验：返回错误列表，空数组即合法。 */
export declare function validatePeer(raw: unknown): string[];
/** 归一化一批 peer 配置（丢弃非法项、去重）。 */
export declare function normalizePeers(raws: readonly unknown[]): {
    peers: PeerAgent[];
    errors: Array<{
        id: string;
        errors: string[];
    }>;
};
/**
 * 拼 CLI 参数：`{prompt}` 占位替换；没有占位时按 promptVia 追加或走 stdin。
 */
export declare function buildCliArgs(peer: PeerAgent, prompt: string): {
    args: string[];
    stdin?: string;
};
/** 从普通 HTTP 响应里取文本（认几种常见字段名）。 */
export declare function parseHttpOutput(raw: unknown): string;
/** 从 A2A 响应里取文本（artifacts / status.message / parts）。 */
export declare function parseA2AOutput(raw: unknown): string;
/** A2A 请求体（message/send）。 */
export declare function buildA2ARequest(prompt: string, context?: string): Record<string, unknown>;
/**
 * 把任务交给一个 peer。
 * @param peer - peer 配置
 * @param prompt - 任务说明
 * @param options - 超时、附加上下文
 */
export declare function runPeer(peer: PeerAgent, prompt: string, options?: {
    timeoutMs?: number;
    context?: string;
}): Promise<PeerResult>;
/**
 * 拉取 A2A agent card（看对方会什么）。
 */
export declare function fetchAgentCard(url: string, timeoutMs?: number): Promise<Record<string, unknown> | undefined>;
