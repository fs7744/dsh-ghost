/**
 * 缓存感知的成本换算（对标 TokenEconomizer 的「按缓存计价算成本」）。
 *
 * 宿主 `dsh-token-meter` 已经给出真实用量：未缓存输入、缓存读、缓存写、输出。
 * 我们只负责把 token 换算成钱——价格随模型与渠道变，所以价格由调用方给，
 * 这里不做任何默认猜测（宁可显示 token，也不显示拍脑袋的钱）。
 */
import type { HarnessUsage } from './compaction.ts'

/** 每百万 token 的价格。 */
export interface Pricing {
  /** 未缓存输入。 */
  inputPerMillion: number
  /** 输出。 */
  outputPerMillion: number
  /** 缓存读（通常远低于输入）。 */
  cacheReadPerMillion: number
  /** 缓存写（通常略高于输入）。 */
  cacheWritePerMillion: number
}

export interface CostBreakdown {
  /** 未缓存输入花费。 */
  input: number
  /** 缓存读花费。 */
  cacheRead: number
  /** 缓存写花费。 */
  cacheWrite: number
  /** 输出花费。 */
  output: number
  /** 合计。 */
  total: number
  /** 缓存命中率（0..1），越高越省。 */
  cacheHitRate: number
}

/** 空价格：调用方没给价格时返回全 0，而不是编一个。 */
export const EMPTY_PRICING: Pricing = {
  inputPerMillion: 0,
  outputPerMillion: 0,
  cacheReadPerMillion: 0,
  cacheWritePerMillion: 0,
}

const perMillion = (tokens: number, price: number): number => (tokens / 1_000_000) * price

/**
 * 用真实用量 + 价格算成本。
 */
export function estimateCost(usage: HarnessUsage, pricing: Pricing = EMPTY_PRICING): CostBreakdown {
  const input = perMillion(usage.uncachedInputTokens, pricing.inputPerMillion)
  const cacheRead = perMillion(usage.cacheReadTokens, pricing.cacheReadPerMillion)
  const cacheWrite = perMillion(usage.cacheWriteTokens, pricing.cacheWritePerMillion)
  const output = perMillion(usage.outputTokens, pricing.outputPerMillion)
  const totalInput = usage.uncachedInputTokens + usage.cacheReadTokens
  return {
    input,
    cacheRead,
    cacheWrite,
    output,
    total: input + cacheRead + cacheWrite + output,
    cacheHitRate: totalInput > 0 ? usage.cacheReadTokens / totalInput : 0,
  }
}
