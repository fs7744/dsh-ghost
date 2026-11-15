/**
 * 失败循环短提示 + 工具结果截断。
 *
 * 不做 judge、不调模型：只认「同一工具 + 同一错误」在时间窗内重复出现。
 * 第二次重复才加一行提示，第一次失败保持原样，避免正常纠错被唠叨。
 */

export interface LoopGuardOptions {
  /** 多久内重复算同一轮，默认 10 分钟。 */
  windowMs?: number
  /** 第几次重复开始提示，默认 2。 */
  threshold?: number
  /** 时间源，测试可注入。 */
  now?: () => number
}

/** 把错误里的随机 id / 数字抹平，避免同一种失败因 id 不同而漏判。 */
export function normalizeFailure(error: string): string {
  return error
    // 路径与文件名先抹平：同名错误常因 a.txt / b.txt 不同而漏判。
    .replace(/[A-Za-z]:[\\/][^\s:]+/g, '<path>')
    .replace(/[\w.-]+\.(?:[a-z0-9]{1,8})\b/gi, '<file>')
    .replace(/"[^"]*"|'[^']*'/g, '<str>')
    .replace(/[0-9a-f]{8,}/gi, '#')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
}

interface FailureState {
  count: number
  lastAt: number
}

export class LoopGuard {
  readonly #windowMs: number
  readonly #threshold: number
  readonly #now: () => number
  readonly #failures = new Map<string, FailureState>()

  constructor(options: LoopGuardOptions = {}) {
    this.#windowMs = options.windowMs ?? 10 * 60_000
    this.#threshold = options.threshold ?? 2
    this.#now = options.now ?? (() => Date.now())
  }

  /** 记一次失败；达到阈值时返回一行重定向，否则 undefined。 */
  failure(tool: string, error: string): string | undefined {
    const at = this.#now()
    const key = `${tool}\u0000${normalizeFailure(error)}`
    const previous = this.#failures.get(key)
    const count = previous === undefined || at - previous.lastAt > this.#windowMs ? 1 : previous.count + 1
    this.#failures.set(key, { count, lastAt: at })
    if (count < this.#threshold) return undefined
    return `提示：同一工具同样的失败已连续出现 ${count} 次。换参数、先读相关文件，或直接报告卡点，不要重复调用。`
  }

  /** 工具成功一次，清掉它的失败计数。 */
  success(tool: string): void {
    for (const key of this.#failures.keys()) {
      if (key.startsWith(`${tool}\u0000`)) this.#failures.delete(key)
    }
  }
}

/**
 * 截断工具结果：保留头部，附一行说明。
 * 默认 12000 字符（约 3k token），足够覆盖大多数视图/文件读取。
 */
export function truncateToolResult(text: string, maxChars = 12_000): string {
  if (text.length <= maxChars) return text
  const suffix = `\n…（已截断，原文 ${text.length} 字；请用更精确的查询或参数）`
  // 上限小到连说明都放不下时，宁可只留正文，也不返回超长字符串。
  if (suffix.length >= maxChars) return text.slice(0, Math.max(0, maxChars))
  return `${text.slice(0, maxChars - suffix.length)}${suffix}`
}
