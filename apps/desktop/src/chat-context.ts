/**
 * 聊天上下文的两件事：
 *
 *  1. **前置记忆索引**：从 `ghostMemory/brief` 取一小段项目记忆，附在用户消息后面；
 *  2. **历史压缩**：上下文超预算时**自动**触发宿主 `/compact` 就地压缩旧消息，
 *     同一个会话继续（Claude Code / Codex / Cursor 都是这个模式）。
 *     宿主没暴露改写历史的接口（`session/page` 只读、`session/prompt` 只追加），
 *     所以「替换旧消息」这步只能由宿主做；我们负责**何时压、压多少预算、要不要压**。
 */
import type { RemoteTransport } from '@dsh-ghost/harness-port'
import {
  estimateTokens, planCompaction as planBudget, type ChatMessage,
} from '@dsh-ghost/economizer'
import { toBubbles, type LogRecord } from './session-log.ts'

/** 上下文预算的本地覆盖键；设 0 或负数即关闭自动压缩。 */
const BUDGET_KEY = 'dsh-ghost.contextTokens'
const DEFAULT_BUDGET = 12_000

/** 压缩模式：`host` 就地压缩（默认）、`off` 关闭。 */
const MODE_KEY = 'dsh-ghost.compactMode'
export type CompactionMode = 'host' | 'off'

/** 读上下文预算（token 估算）。 */
export function contextBudget(): number {
  try {
    const raw = globalThis.localStorage?.getItem(BUDGET_KEY)
    if (raw === null || raw === undefined || raw.trim() === '') return DEFAULT_BUDGET
    const value = Number.parseInt(raw, 10)
    return Number.isFinite(value) ? value : DEFAULT_BUDGET
  } catch {
    return DEFAULT_BUDGET
  }
}

/** 读压缩模式。 */
export function compactionMode(): CompactionMode {
  try {
    const raw = globalThis.localStorage?.getItem(MODE_KEY)
    if (raw === 'off' || raw === 'host') return raw
    return 'host'
  } catch {
    return 'host'
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

/** 会话记录 → 便于摘要的消息列表。 */
export function recordsToMessages(records: readonly LogRecord[]): ChatMessage[] {
  const messages: ChatMessage[] = []
  for (const bubble of toBubbles(records)) {
    if (bubble.kind === 'user') messages.push({ role: 'user', text: bubble.text })
    else if (bubble.kind === 'assistant') messages.push({ role: 'assistant', text: bubble.text })
    else if (bubble.kind === 'tool' || bubble.kind === 'toolcall') messages.push({ role: 'tool', text: bubble.text })
    else messages.push({ role: 'note', text: bubble.text })
  }
  return messages.filter(message => message.text.trim() !== '')
}

/** 估算当前会话占用的 token（仅量级判断）。 */
export function contextTokens(records: readonly LogRecord[]): number {
  return recordsToMessages(records).reduce((sum, message) => sum + estimateTokens(message.text), 0)
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

/** 调宿主 `/compact` 做就地压缩；失败返回 false。 */
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

export interface CompactionDeps {
  transport: RemoteTransport
  /** 当前会话 id。 */
  sessionId: string
  /** 预算（token 估算）；<=0 表示不压缩。 */
  maxTokens?: number
  /** 强制模式（测试用）；缺省读本地设置。 */
  mode?: CompactionMode
  /** 新会话工作目录。 */
  cwd?: string
}

export type CompactionDecision =
  | { action: 'none' }
  /** 就地压缩：同一个会话继续，宿主历史被替换成摘要。 */
  | { action: 'host'; previousSessionId: string; estimatedTokens: number; overflowTokens: number }

/**
 * 判断要不要压缩并执行：超预算就调宿主 `/compact` 就地压缩。
 * 宿主命令失败时不做任何替代动作（宁可不动，也不要悄悄换会话）。
 */
export async function planCompaction(deps: CompactionDeps): Promise<CompactionDecision> {
  const mode = deps.mode ?? compactionMode()
  const budget = deps.maxTokens ?? contextBudget()
  if (mode === 'off' || budget <= 0) return { action: 'none' }

  let page: { records?: LogRecord[] } | undefined
  try {
    page = await deps.transport.call('session/page' as never, {
      request: { address: { kind: 'session', sessionId: deps.sessionId }, maxMessages: 200 },
    } as never) as { records?: LogRecord[] }
  } catch {
    return { action: 'none' }
  }
  const messages = recordsToMessages(page?.records ?? [])
  const plan = planBudget(messages, { maxTokens: budget })
  if (!plan.compress) return { action: 'none' }

  const compacted = await requestHostCompaction(deps.transport, deps.sessionId)
  if (!compacted) return { action: 'none' }
  return {
    action: 'host',
    previousSessionId: deps.sessionId,
    estimatedTokens: plan.estimatedTokens,
    overflowTokens: plan.overflowTokens,
  }
}
