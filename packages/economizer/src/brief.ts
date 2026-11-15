/**
 * 会话前置简报（对标 micro-skills 的「跨会话事实注入」）。
 *
 * 只注入**索引**（每行一条：名字 + 标题），正文仍按需 memory_read。
 * 这样做的好处：
 *  - 模型开局就知道「以前定过什么」，不用先 memory_list 再逐条读；
 *  - 常驻体积有硬上限，不会把记忆全文塞进每次请求；
 *  - 少于 3 条时不注入，避免为两条笔记白付一段 header。
 */

export interface SessionBriefOptions {
  /** 最多注入多少字符（默认 1200，约 300 token）。 */
  maxChars?: number
  /** 少于多少条记忆就不注入，默认 3。 */
  minEntries?: number
  /** 最多列多少条，默认 24。 */
  maxEntries?: number
}

/** 从 MEMORY.md 里数出索引条目（只认 `- ` 开头的行）。 */
export function countMemoryEntries(index: string): number {
  return index.split('\n').filter(line => /^\s*-\s+/.test(line)).length
}

/** 抽取 `- ...` 行并去掉多余空白；保持原顺序。 */
function extractEntries(index: string, maxEntries: number): { lines: string[]; total: number } {
  const all = index
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => /^\s*-\s+/.test(line))
    .map(line => line.replace(/^\s*-\s+/, '- '))
  return { lines: all.slice(0, maxEntries), total: all.length }
}

/**
 * 拼任务 + 记忆索引。没有足够条目时原样返回任务，一个字符都不多花。
 * @param task - 票标题 / 用户任务
 * @param index - MEMORY.md 文本
 */
export function buildSessionBrief(task: string, index: string, options: SessionBriefOptions = {}): string {
  const cleanTask = task.trim()
  const maxChars = options.maxChars ?? 1200
  const minEntries = options.minEntries ?? 3
  const maxEntries = options.maxEntries ?? 24
  if (cleanTask === '') return ''
  const total = countMemoryEntries(index)
  if (total < minEntries) return cleanTask

  const { lines } = extractEntries(index, maxEntries)
  const header = '已知项目记忆（仅索引；需要正文再调 memory_read）：'
  const tail = total > lines.length ? `（另有 ${total - lines.length} 条，用 memory_list 查看）` : ''
  const body = [header, ...lines, ...(tail === '' ? [] : [tail])].join('\n')
  const block = `<project-memory>\n${body}\n</project-memory>`
  const budget = Math.max(0, maxChars - cleanTask.length - 2)
  if (block.length <= budget) return `${cleanTask}\n\n${block}`

  // 超预算：按行装，装不下就截断，绝不把一行切成半个名字。
  const kept: string[] = []
  let used = header.length + 2
  for (const line of lines) {
    if (used + line.length + 1 > budget - 32) break
    kept.push(line)
    used += line.length + 1
  }
  if (kept.length === 0) return cleanTask
  const clipped = `<project-memory>\n${header}\n${kept.join('\n')}\n（已截断）\n</project-memory>`
  return `${cleanTask}\n\n${clipped}`
}
