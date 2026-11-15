/**
 * 浏览器扩展的**配对码**（纯逻辑，可单测）。
 *
 * 为什么用设备码而不是「localhost 就能信」：扩展里输入一个 6 位码，
 * 说明用户确实在跟这个应用对话；本地任何进程都不能凭空配上。
 * 码是一次性的、5 分钟过期。
 */

/** 一张配对票据。 */
export interface PairingTicket {
  /** 6 位数字码。 */
  code: string
  /** 过期时间戳（毫秒）。 */
  expiresAt: number
}

export interface PairingStore {
  /** 出一张新票（旧的作废）。 */
  issue(): PairingTicket
  /** 校验并作废；成功返回 true。 */
  verify(code: string): boolean
  /** 看当前票（不消费）。 */
  peek(): PairingTicket | undefined
}

const DEFAULT_TTL_MS = 5 * 60_000

/**
 * 造一个配对码存储。
 * @param options - ttl / 时钟 / 随机源（测试可注入）
 */
export function createPairingStore(options: {
  ttlMs?: number
  now?: () => number
  random?: () => number
} = {}): PairingStore {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  const now = options.now ?? (() => Date.now())
  const random = options.random ?? (() => Math.random())
  let ticket: PairingTicket | undefined

  return {
    issue(): PairingTicket {
      // 6 位数字；前导 0 也可能出现，用户输入时保留（我们去掉空格即可）。
      const code = String(Math.floor(random() * 1_000_000)).padStart(6, '0')
      ticket = { code, expiresAt: now() + ttlMs }
      return ticket
    },
    verify(code: string): boolean {
      if (ticket === undefined) return false
      const normalized = code.replace(/\s+/g, '')
      if (normalized !== ticket.code) return false
      if (now() > ticket.expiresAt) {
        ticket = undefined
        return false
      }
      ticket = undefined
      return true
    },
    peek(): PairingTicket | undefined {
      if (ticket === undefined) return undefined
      if (now() > ticket.expiresAt) return undefined
      return ticket
    },
  }
}
