/**
 * 会话导出（C11-06）：Markdown 给人读，JSONL 给机器回溯。
 *
 * 两条原则：
 *  - Markdown 从**视图模型**（toBubbles 的结果）生成，和界面看到的完全一致；
 *  - JSONL 保留 `session/page` 的**原始记录**，一个字节不丢，方便事后重放。
 * 纯函数不碰 DOM，下载单独一个函数，方便在 Node 里单测。
 */
import type { Bubble } from './session-log.ts'

/** 导出头信息。 */
export interface ExportMeta {
  sessionId: string
  title?: string
  /** 可注入以便测试得到确定结果；缺省取当前时间。 */
  exportedAt?: string
}

/** 选一段不会被正文里反引号打断的代码围栏。 */
function fence(text: string): string {
  let longest = 2
  for (const match of text.matchAll(/`+/g)) longest = Math.max(longest, match[0].length)
  return '`'.repeat(longest + 1)
}

/** 代码块：围栏长度自适应，避免用户文本里的 ``` 把 Markdown 撑破。 */
function block(text: string, language: string): string {
  const marker = fence(text)
  return `${marker}${language}\n${text}\n${marker}`
}

/**
 * 导出成 Markdown。
 * @param bubbles - toBubbles(records) 的结果
 * @param meta - 会话 id、标题与时间
 */
export function exportMarkdown(bubbles: readonly Bubble[], meta: ExportMeta): string {
  const at = meta.exportedAt ?? new Date().toISOString()
  const lines = [
    `# ${meta.title ?? '会话记录'}`,
    '',
    `- 会话：\`${meta.sessionId}\``,
    `- 导出时间：${at}`,
    `- 消息数：${bubbles.length}`,
    '',
    '---',
    '',
  ]
  for (const bubble of bubbles) {
    switch (bubble.kind) {
      case 'user':
        lines.push('## 你', '', bubble.text, '')
        break
      case 'assistant':
        lines.push(`## Ghost${bubble.tool === undefined ? '' : `（调用 ${bubble.tool}）`}`, '', bubble.text || '（无文本）', '')
        break
      case 'toolcall':
        lines.push(`> 工具调用 \`${bubble.name}\``, '', block(bubble.text, 'json'), '')
        break
      case 'tool':
        lines.push(`> 工具结果 \`${bubble.name}\``, '', block(bubble.text, 'text'), '')
        break
      case 'note':
        lines.push(`_${bubble.text}_`, '')
        break
    }
  }
  return lines.join('\n')
}

/** 一行一条原始记录；不可序列化的值单独兜底，不让整次导出失败。 */
export function exportJsonl(records: readonly unknown[]): string {
  const lines = records.map(record => {
    try {
      return JSON.stringify(record) ?? 'null'
    } catch {
      return JSON.stringify({ error: 'unserializable', type: typeof record })
    }
  })
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`
}

/** 生成安全的文件名（会话 id 可能含特殊字符）。 */
export function exportFilename(sessionId: string, ext: 'md' | 'jsonl'): string {
  const safe = sessionId.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 40) || 'session'
  return `dsh-ghost-${safe}.${ext}`
}

/** 浏览器下载；纯逻辑单测不会调用它。 */
export function downloadText(filename: string, content: string, mime = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
