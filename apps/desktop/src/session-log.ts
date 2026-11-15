/**
 * 会话日志 → 视图模型（纯函数，零 DOM）。
 *
 * UI 渲染、会话导出、验收脚本共用这一份解析，避免「界面看到的」和「导出的」
 * 对同一条日志有不同理解。
 */

/** `session/page` 返回的一条记录。 */
export type LogRecord = { type: string; event?: { type: string; seq: number; data: Record<string, unknown> } }

/** 一条可显示 / 可导出的消息。 */
export type Bubble =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string; tool?: string }
  | { kind: 'toolcall'; name: string; text: string }
  | { kind: 'tool'; name: string; text: string }
  | { kind: 'note'; text: string }

/** 工具参数常是 JSON 字符串，尽量解析后展示。 */
export function parseMaybe(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return value }
}

/** 把任意值压成一小段可读文本。 */
export function summarize(value: unknown, limit = 240): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value.slice(0, limit)
  try {
    const text = JSON.stringify(value, null, 1)
    if (text === undefined) return ''
    return text.length > limit ? `${text.slice(0, limit)}…` : text
  } catch {
    return String(value).slice(0, limit)
  }
}

/** 从会话日志里抽出可显示的消息。 */
export function toBubbles(records: readonly LogRecord[]): Bubble[] {
  const bubbles: Bubble[] = []
  const callNames = new Map<string, string>()
  for (const record of records) {
    const event = record.type === 'event' ? record.event : undefined
    if (event === undefined) continue
    const data = event.data as {
      message?: { content?: Array<{ type: string; text?: string; name?: string }> }
      content?: Array<{ type: string; text?: string }>
      result?: unknown
      reason?: { kind?: string }
      callId?: string
      id?: string
      name?: string
      arguments?: unknown
      args?: unknown
      toolCallId?: string
    }
    if (event.type === 'user/message') {
      const text = (data.content ?? []).filter(part => part.type === 'text').map(part => part.text ?? '').join('\n')
      if (text !== '') bubbles.push({ kind: 'user', text })
    } else if (event.type === 'assistant/message') {
      const parts = data.message?.content ?? []
      const text = parts.filter(part => part.type === 'text').map(part => part.text ?? '').join('')
      const tool = parts.find(part => part.type === 'tool-call')?.name
      if (text !== '' || tool !== undefined) bubbles.push({ kind: 'assistant', text, ...(tool === undefined ? {} : { tool }) })
    } else if (event.type === 'tool/call') {
      const callId = data.callId ?? data.id ?? ''
      const name = String(data.name ?? 'tool')
      callNames.set(callId, name)
      bubbles.push({ kind: 'toolcall', name, text: summarize(parseMaybe(data.arguments)) })
    } else if (event.type === 'tool/result') {
      const callId = data.callId ?? data.id ?? ''
      const name = callNames.get(callId) ?? String(data.name ?? 'tool')
      // 工具结果在 message.content[] 里；没有就退回原始 JSON
      const parts = data.message?.content ?? []
      const text = parts.filter(part => part.type === 'text').map(part => part.text ?? '').join('\n')
      bubbles.push({ kind: 'tool', name, text: text === '' ? summarize(data, 600) : text.slice(0, 600) })
    } else if (event.type === 'turn/end') {
      const reason = data.reason?.kind
      if (reason !== undefined) bubbles.push({ kind: 'note', text: `回合结束（${reason}）` })
    } else if (event.type === 'command/run') {
      // 斜杠命令不进模型消息，但导出/界面仍要看得见它执行过。
      const name = String(data.name ?? 'command')
      const args = typeof data.args === 'string' && data.args.trim() !== '' ? ` ${data.args.trim()}` : ''
      bubbles.push({ kind: 'note', text: `命令 /${name}${args}` })
    }
  }
  return bubbles
}
