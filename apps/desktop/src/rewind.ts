/**
 * Checkpoint / rewind（C11-05）：从会话日志里找可回退点，构造 `session/fork` 请求。
 *
 * harness 的 `atSeq` 是**包含该事件的精确前缀边界**：fork 出的新会话只保留
 * 到这条用户消息为止的历史，之后的对话都被切掉。原会话不动，所以回退永远可撤销。
 * 纯函数、零 DOM，方便单测与验收脚本复用。
 */
import type { LogRecord } from './session-log.ts'

/** 一个可回退的 checkpoint（一条用户消息）。 */
export interface RewindPoint {
  /** `user/message` 事件的 seq，直接作为 `session/fork` 的 atSeq。 */
  seq: number
  /** 文本预览，给按钮/确认框看。 */
  label: string
  /** 第几条用户消息（1 起）。 */
  index: number
}

/** 从一条记录里取用户消息正文。 */
function userText(record: LogRecord): string {
  const data = record.event?.data as { content?: Array<{ type: string; text?: string }> } | undefined
  return (data?.content ?? [])
    .filter(part => part.type === 'text')
    .map(part => part.text ?? '')
    .join('\n')
    .trim()
}

/**
 * 列出所有可回退点（按 seq 升序）。空消息与无 seq 的记录会被跳过。
 * @param records - `session/page` 的原始记录
 */
export function findRewindPoints(records: readonly LogRecord[]): RewindPoint[] {
  const points: Array<{ seq: number; label: string }> = []
  for (const record of records) {
    if (record.type !== 'event' || record.event?.type !== 'user/message') continue
    const text = userText(record)
    const seq = record.event.seq
    if (text === '' || !Number.isSafeInteger(seq)) continue
    points.push({
      seq,
      label: text.length > 48 ? `${text.slice(0, 48)}…` : text,
    })
  }
  // index 是「第几条用户消息」，必须按 seq 排完再编号。
  return points.sort((left, right) => left.seq - right.seq)
    .map((point, index) => ({ ...point, index: index + 1 }))
}

/**
 * 构造 `session/fork` 的 payload。
 * 不传 checkpoint 时省略 atSeq —— 宿主会选「最近一个已完成回合」的前缀。
 */
export function forkRequest(sessionId: string, point?: RewindPoint): {
  request: { sessionId: string; atSeq?: number }
} {
  return {
    request: {
      sessionId,
      ...(point === undefined ? {} : { atSeq: point.seq }),
    },
  }
}

/** 给确认框用的可读描述。 */
export function rewindLabel(point: RewindPoint): string {
  return `回退到第 ${point.index} 条消息「${point.label}」？\n\n会新建一个会话，保留这条消息及之前的历史；当前会话不变。`
}
