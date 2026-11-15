/** 空价格：调用方没给价格时返回全 0，而不是编一个。 */
export const EMPTY_PRICING = {
    inputPerMillion: 0,
    outputPerMillion: 0,
    cacheReadPerMillion: 0,
    cacheWritePerMillion: 0,
};
const perMillion = (tokens, price) => (tokens / 1_000_000) * price;
/**
 * 用真实用量 + 价格算成本。
 */
export function estimateCost(usage, pricing = EMPTY_PRICING) {
    const input = perMillion(usage.uncachedInputTokens, pricing.inputPerMillion);
    const cacheRead = perMillion(usage.cacheReadTokens, pricing.cacheReadPerMillion);
    const cacheWrite = perMillion(usage.cacheWriteTokens, pricing.cacheWritePerMillion);
    const output = perMillion(usage.outputTokens, pricing.outputPerMillion);
    const totalInput = usage.uncachedInputTokens + usage.cacheReadTokens;
    return {
        input,
        cacheRead,
        cacheWrite,
        output,
        total: input + cacheRead + cacheWrite + output,
        cacheHitRate: totalInput > 0 ? usage.cacheReadTokens / totalInput : 0,
    };
}
