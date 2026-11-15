/**
 * 聊天上下文的两件事：
 *
 *  1. **前置记忆索引**：从 `ghostMemory/brief` 取一小段项目记忆，附在用户消息后面；
 *  2. **上下文提醒**：宿主 `dsh-compaction-basic` 在 80% 压力时**已经自动压缩**，
 *     `/compact` 也由 `dsh-command-compact` 提供。所以我们**不再重复触发**（那会多花一次
 *     模型调用），改成读宿主的**真实用量**（`session/projections`），
 *     在明显更高（默认 90%）时**提醒**用户，并提供一键 `/compact`。
 */
import type { RemoteTransport } from '@dsh-ghost/harness-port'
import {
  readHarnessUsage, shouldSuggestCompaction, type HarnessUsage,
} from '@dsh-ghost/economizer'

/** 提醒阈值（本地覆盖键）；默认 0.9，宿主在 0.8 已经自动压。 */
const THRESHOLD_KEY = 'dsh-ghost.compactHintRatio'

/** 读提醒阈值比例。 */
export function compactHintRatio(): number {
  try {
    const raw = globalThis.localStorage?.getItem(THRESHOLD_KEY)
    if (raw === null || raw === undefined || raw.trim() === '') return 0.9
    const value = Number.parseFloat(raw)
    return Number.isFinite(value) && value > 0 ? value : 0.9
  } catch {
    return 0.9
  }
}

/** 用户原话在前，记忆块在后（模型先看诉求，再看背景）。 */
export function composeChatMessage(text: string, brief: string): string {
  const body = text.trim()
  const block = brief.trim()
  if (block === '') return body
  if (body === '') return block
  return `${body}\n\n${block}`
}

/** 取一段记忆索引；宿主没有该能力时返回空串。 */
export async function loadBrief(transport: RemoteTransport): Promise<string> {
  try {
    const result = await transport.call('ghostMemory/brief' as never, {} as never) as { text?: unknown }
    const text = typeof result?.text === 'string' ? result.text : ''
    return text.trim()
  } catch {
    return ''
  }
}

/**
 * 手动触发宿主的 `/compact`（界面上的「立即压缩」按钮用）。
 * 宿主自己也会在 80% 自动压，所以这里只在用户明确要求时调用。
 */
export async function requestHostCompaction(transport: RemoteTransport, sessionId: string): Promise<boolean> {
  try {
    await transport.call('commands/execute' as never, {
      agentId: sessionId,
      line: '/compact',
      submittedAttachments: [],
    } as never)
    return true
  } catch {
    return false
  }
}

export interface ContextEvaluation {
  /** 宿主给的真实用量；拿不到就是全 0。 */
  usage: HarnessUsage
  /** 是否该提醒用户压缩。 */
  suggest: boolean
}

/**
 * 读宿主投影里的真实用量，判断是否该提醒压缩。
 * 没有投影数据时返回全 0 + 不提醒（宁可少提醒，也不要拿估算值误导人）。
 */
export async function evaluateContext(
  transport: RemoteTransport,
  sessionId: string,
  options: { thresholdRatio?: number } = {},
): Promise<ContextEvaluation> {
  let projections: unknown
  try {
    projections = await transport.call('session/projections' as never, {
      request: { sessionId },
    } as never)
  } catch {
    return { usage: readHarnessUsage(undefined), suggest: false }
  }
  const usage = readHarnessUsage(projections)
  const suggest = shouldSuggestCompaction(usage, {
    thresholdRatio: options.thresholdRatio ?? compactHintRatio(),
  })
  return { usage, suggest }
}
