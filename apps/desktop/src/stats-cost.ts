/**
 * 统计页的成本换算（纯逻辑，零 DOM）。
 *
 * 原则：**不编数字**。
 *  - token 构成与缓存命中率来自宿主真实用量，永远能显示；
 *  - 金额需要单价，单价由用户填（宿主不提供价格表），没填就写「未配置单价」。
 */
import { estimateCost, type HarnessUsage, type Pricing } from '@dsh-ghost/economizer'

/** 单价在本地存储里的键（JSON）。 */
export const PRICING_KEY = 'dsh-ghost.pricing'

/** 解析单价 JSON；非法或缺项一律当作「没配」。 */
export function parsePricing(raw: string | null | undefined): Pricing | undefined {
  if (raw === null || raw === undefined || raw.trim() === '') return undefined
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    const pick = (key: string): number | undefined => {
      const number = value[key]
      return typeof number === 'number' && Number.isFinite(number) && number >= 0 ? number : undefined
    }
    const input = pick('inputPerMillion')
    const output = pick('outputPerMillion')
    if (input === undefined || output === undefined) return undefined
    return {
      inputPerMillion: input,
      outputPerMillion: output,
      cacheReadPerMillion: pick('cacheReadPerMillion') ?? input * 0.1,
      cacheWritePerMillion: pick('cacheWritePerMillion') ?? input * 1.25,
    }
  } catch {
    return undefined
  }
}

/** 单价存回本地存储（JSON）。 */
export function serializePricing(pricing: Pricing): string {
  return JSON.stringify(pricing)
}

/** 金额格式化：小于 1 分钱显示「< $0.01」，否则 4 位小数。 */
export function formatCost(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '$0'
  if (value < 0.01) return '< $0.01'
  return `$${value.toFixed(4)}`
}

/** 千分位 token。 */
export function formatTokenCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  return Math.round(value).toLocaleString('en-US')
}

export interface CostRow {
  /** i18n key。 */
  key: string
  /** 显示文本。 */
  value: string
}

/**
 * 成本看板的行：先是 token 构成（一定有），再是金额（配了单价才有）。
 */
export function costRows(usage: HarnessUsage, pricing?: Pricing): CostRow[] {
  const rows: CostRow[] = [
    { key: 'stats.uncached', value: formatTokenCount(usage.uncachedInputTokens) },
    { key: 'stats.cacheRead', value: formatTokenCount(usage.cacheReadTokens) },
    { key: 'stats.cacheWrite', value: formatTokenCount(usage.cacheWriteTokens) },
    { key: 'stats.output', value: formatTokenCount(usage.outputTokens) },
    { key: 'stats.cacheHit', value: `${(usage.totalInputTokens > 0 ? (usage.cacheReadTokens / usage.totalInputTokens) * 100 : 0).toFixed(1)}%` },
  ]
  if (pricing === undefined) {
    rows.push({ key: 'stats.cost.unset', value: '—' })
    return rows
  }
  const cost = estimateCost(usage, pricing)
  rows.push({ key: 'stats.cost', value: formatCost(cost.total) })
  rows.push({ key: 'stats.cost.detail', value: `${formatCost(cost.input + cost.cacheWrite)} + ${formatCost(cost.cacheRead)} + ${formatCost(cost.output)}` })
  return rows
}
