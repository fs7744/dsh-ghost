/**
 * 多服务负载均衡的纯选路逻辑（零网络、零时钟、零随机源）。
 *
 * 「off / round-robin / random / weighted / failover」五种策略统一走一个纯函数：
 * 候选列表、游标、随机源都由调用方注入，因此同一份逻辑既能跑在 shell 的本地
 * 聚合代理里，也能在单测里用固定随机数做确定性断言。
 *
 * 注意：这里只选「哪个服务」，不负责实际请求与失败重试——失败时调用方把游标
 * 推进后再次调用 selectBalanceTarget 即可换到下一个候选（failover）。
 */
export const BALANCE_STRATEGIES = ['off', 'round-robin', 'random', 'weighted', 'failover'] as const
export type BalanceStrategy = typeof BALANCE_STRATEGIES[number]

export function isBalanceStrategy(value: string): value is BalanceStrategy {
  return (BALANCE_STRATEGIES as readonly string[]).includes(value)
}

/** 一个可参与分发的候选服务。enabled 为 false 的候选永远不会被选中。 */
export interface BalanceCandidate {
  id: string
  enabled?: boolean
  weight?: number
}

export interface BalanceSelection {
  target?: BalanceCandidate
  /** 下一次调用应带回的游标；调用方负责保存。 */
  cursor: number
}

const active = (candidates: readonly BalanceCandidate[]): BalanceCandidate[] =>
  candidates.filter(item => item.enabled !== false && Number.isFinite(item.weight) && (item.weight ?? 1) > 0)

/**
 * 按策略选一个候选；无可用候选时返回 cursor 原值、target 缺省。
 * - off: 恒定第一个
 * - round-robin: cursor 取模，选完 cursor+1
 * - random: 用注入的 rand() 取模
 * - weighted: 按 weight 加权随机（同样用注入的 rand()）
 * - failover: 把 cursor 当序号，调用方在失败时 +1；这里做完边界回绕，不自动推进
 */
export function selectBalanceTarget(
  candidates: readonly BalanceCandidate[],
  strategy: BalanceStrategy,
  cursor: number,
  rand: () => number = Math.random,
): BalanceSelection {
  const pool = active(candidates)
  if (pool.length === 0) return { cursor }
  const safeCursor = Number.isInteger(cursor) && cursor >= 0 ? cursor : 0

  switch (strategy) {
    case 'random': {
      const roll = Math.min(Math.max(rand(), 0), 0.999999)
      return { target: pool[Math.floor(roll * pool.length)]!, cursor: safeCursor }
    }
    case 'weighted': {
      const total = pool.reduce((sum, item) => sum + (item.weight ?? 1), 0)
      let roll = Math.min(Math.max(rand(), 0), 0.999999) * total
      for (const item of pool) {
        roll -= item.weight ?? 1
        if (roll < 0) return { target: item, cursor: safeCursor }
      }
      return { target: pool[pool.length - 1]!, cursor: safeCursor }
    }
    case 'failover': {
      return { target: pool[safeCursor % pool.length]!, cursor: safeCursor }
    }
    case 'round-robin': {
      return { target: pool[safeCursor % pool.length]!, cursor: safeCursor + 1 }
    }
    case 'off':
    default:
      return { target: pool[0]!, cursor: safeCursor }
  }
}
