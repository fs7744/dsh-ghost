/**
 * 命令面板的纯逻辑（C11-01）：不碰 DOM、不碰网络，所以能在 Node 里单测。
 *
 * 设计要点：斜杠命令**不进模型消息**。输入以 `/` 开头就是命令，
 * 面板只负责发现与补全，执行一律走 `commands/execute` Remote。
 */

/** 一条可展示的命令。 */
export interface CommandItem {
  /** 不带前导斜杠的命令名。 */
  name: string
  description: string
  /** 自由输入的占位提示；有它说明命令需要参数。 */
  hint?: string
  acceptsAttachments?: boolean
}

/** 把 `commands/list` 的原始描述符归一化（外部数据，字段一律不信任）。 */
export function toCommandItems(raw: readonly unknown[]): CommandItem[] {
  const items: CommandItem[] = []
  for (const value of raw) {
    if (value === null || typeof value !== 'object') continue
    const record = value as Record<string, unknown>
    const name = typeof record.name === 'string' ? record.name : ''
    if (name === '') continue
    const input = record.input !== null && typeof record.input === 'object'
      ? record.input as Record<string, unknown>
      : undefined
    items.push({
      name,
      description: typeof record.description === 'string' ? record.description : '',
      ...(input !== undefined && typeof input.hint === 'string' ? { hint: input.hint } : {}),
      ...(input?.attachments === true ? { acceptsAttachments: true } : {}),
    })
  }
  return items
}

/** 输入行解析结果。 */
export interface SlashInput {
  /** 是否该显示候选面板（还在敲命令名，没输入空格）。 */
  active: boolean
  /** 已敲出的命令名（不含 `/`）。 */
  name: string
  /** 用于过滤的查询；进入参数阶段后为空。 */
  query: string
  /** 已输入的参数。 */
  args: string
  /** 原始输入。 */
  line: string
}

/**
 * 解析输入行。
 * - `/` 或 `/comp` → 面板打开，query 是已敲部分
 * - `/compact 焦点` → 面板关闭，args 是 "焦点"（参数提示仍可用）
 * - 其它 → 面板关闭
 */
export function parseSlash(line: string): SlashInput {
  if (!line.startsWith('/')) return { active: false, name: '', query: '', args: '', line }
  const space = line.indexOf(' ')
  const name = space < 0 ? line.slice(1) : line.slice(1, space)
  const args = space < 0 ? '' : line.slice(space + 1)
  return { active: space < 0, name, query: space < 0 ? name : '', args, line }
}

/** 任意命令行（含带参数），用于决定 send() 走命令还是走模型。 */
export function isCommandLine(line: string): boolean {
  return line.trimStart().startsWith('/')
}

/** 字符按顺序出现即可（`/cmp` 也能找到 `compact`）。 */
function subsequence(needle: string, haystack: string): boolean {
  let index = 0
  for (const char of haystack) {
    if (char === needle[index]) index += 1
    if (index === needle.length) return true
  }
  return needle.length === 0
}

/** 匹配打分：越小越靠前；不匹配返回 -1。 */
function score(item: CommandItem, query: string): number {
  const name = item.name.toLowerCase()
  const q = query.toLowerCase()
  if (name === q) return 0
  if (name.startsWith(q)) return 1
  if (name.includes(q)) return 2
  if (subsequence(q, name)) return 3
  if (item.description.toLowerCase().includes(q)) return 4
  return -1
}

/**
 * 过滤并排序候选命令（精确 → 前缀 → 包含 → 子序列 → 描述命中）。
 * @param items - 全部命令
 * @param query - 已敲出的命令名片段；空则返回全部
 */
export function filterCommands(items: readonly CommandItem[], query: string): CommandItem[] {
  if (query.trim() === '') return [...items]
  return items
    .map(item => ({ item, rank: score(item, query.trim()) }))
    .filter(entry => entry.rank >= 0)
    .sort((left, right) => left.rank - right.rank || left.item.name.localeCompare(right.item.name))
    .map(entry => entry.item)
}

/** 循环移动选中项；空列表永远返回 0。 */
export function moveSelection(length: number, current: number, delta: number): number {
  if (length <= 0) return 0
  return ((current + delta) % length + length) % length
}

/** 拼出交给 `commands/execute` 的一行。 */
export function commandLine(name: string, args = ''): string {
  const trimmed = args.trim()
  return `/${name}${trimmed === '' ? '' : ` ${trimmed}`}`
}

/** `!` shell 直通意图（MVP 只识别并提示，完整直通用终端面板，见 COMMANDS.md）。 */
export function isShellDirect(line: string): boolean {
  return line.trimStart().startsWith('!')
}

/** `@` 文件引用意图（MVP 只识别并提示，文件选择器属 P3）。 */
export function hasFileReference(line: string): boolean {
  return /(^|\s)@[\w./-]+/.test(line)
}
