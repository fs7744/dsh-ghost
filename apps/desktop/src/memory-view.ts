/**
 * 记忆界面的纯逻辑（C10-03）：分组、排序、名称校验。
 * 不碰 DOM / 网络，方便单测；数据一律来自 `ghostMemory/*` Remote。
 */

/** 一条记忆的索引信息（与后端 EntryMeta 对齐）。 */
export interface MemoryEntry {
  name: string
  title: string
  updated: string
}

/** 一组记忆。 */
export interface MemoryGroup {
  key: 'today' | 'week' | 'older' | 'unknown'
  label: string
  items: MemoryEntry[]
}

const ORDER: Array<MemoryGroup['key']> = ['today', 'week', 'older', 'unknown']
const LABEL: Record<MemoryGroup['key'], string> = {
  today: '今天',
  week: '近 7 天',
  older: '更早',
  unknown: '未标注时间',
}

/** kebab-case，与后端 gate 的 NAME 规则一致。 */
export const ENTRY_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/

export function validEntryName(name: string): boolean {
  return ENTRY_NAME.test(name)
}

/** 按更新时间分桶；空串或非法日期归到「未标注时间」。 */
export function bucketOf(updated: string, now: Date): MemoryGroup['key'] {
  const time = Date.parse(updated)
  if (!Number.isFinite(time)) return 'unknown'
  const days = (now.getTime() - time) / 86_400_000
  if (days < 0) return 'unknown'
  if (days < 1) return 'today'
  if (days < 7) return 'week'
  return 'older'
}

/**
 * 分组查看：只返回非空组，组内按 name 排序。
 * @param items - `ghostMemory/list` 的结果
 * @param now - 可注入当前时间以便测试
 */
export function groupEntries(items: readonly MemoryEntry[], now = new Date()): MemoryGroup[] {
  const buckets = new Map<MemoryGroup['key'], MemoryEntry[]>()
  for (const item of items) {
    const key = bucketOf(item.updated, now)
    const group = buckets.get(key) ?? []
    group.push(item)
    buckets.set(key, group)
  }
  return ORDER.flatMap(key => {
    const group = buckets.get(key)
    if (group === undefined || group.length === 0) return []
    return [{ key, label: LABEL[key], items: [...group].sort((a, b) => a.name.localeCompare(b.name)) }]
  })
}

/** 状态栏摘要。 */
export function memorySummary(items: readonly MemoryEntry[], enabled: boolean): string {
  return `${items.length} 条记忆 · 写入${enabled ? '已开启' : '已关闭'}`
}
