/**
 * 上下文占用条升级（C11-04）：压缩点标记 + 可展开看被压掉的原文。
 *
 * 占用比例来自 session/projections 的 contextPressure；压缩点用 session/page 的记录
 * 推断（compact / summary 类事件里的 original / dropped / summary 文本）。
 * 纯逻辑（占用计算、色调、token 格式化、压缩点提取、刻度位置）零 DOM。
 */
import type { LogRecord } from './session-log.ts'
import { escapeHtml, num, pickStr, record } from './panels.ts'

export interface Occupancy {
  ratio: number
  used: number
  total: number
}

/** 归一化为 0..1 的占比；缺字段 / 非法值一律安全返回 0。 */
export function computeOccupancy(projectedTokens: unknown, contextWindow: unknown): Occupancy {
  const used = num(projectedTokens)
  const total = num(contextWindow)
  const ratio = total > 0 ? Math.min(1, Math.max(0, used / total)) : 0
  return { ratio, used, total }
}

export function barTone(ratio: number): 'ok' | 'warn' | 'danger' {
  if (ratio > 0.8) return 'danger'
  if (ratio > 0.6) return 'warn'
  return 'ok'
}

export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  if (value < 1000) return String(Math.round(value))
  return `${(value / 1000).toFixed(1)}k`
}

export interface CompactionMark {
  seq: number
  label: string
  original: string
}

/** 从会话日志里找压缩点；按 seq 升序。 */
export function findCompactionMarks(records: readonly LogRecord[]): CompactionMark[] {
  const out: CompactionMark[] = []
  for (const entry of records) {
    const event = entry.event
    const data = record(event?.data)
    const type = `${entry.type} ${event?.type ?? ''}`.toLowerCase()
    const isCompaction = type.includes('compact') || type.includes('summar')
      || data.compaction !== undefined || data.summary !== undefined || data.dropped !== undefined
    if (!isCompaction) continue
    const seq = num(event?.seq ?? data.seq)
    const original = [data.original, data.dropped, data.removed, data.summary, data.content]
      .map(value => (typeof value === 'string' ? value : ''))
      .find(text => text !== '') ?? ''
    const label = pickStr(data, ['label', 'reason', 'title']) || `seq ${seq}`
    out.push({ seq, label, original })
  }
  return out.sort((a, b) => a.seq - b.seq)
}

/** 把压缩点的 seq 映射到占用条上的百分比位置。 */
export function markOffsets(marks: readonly CompactionMark[], maxSeq: number): number[] {
  if (maxSeq <= 0) return marks.map(() => 0)
  return marks.map(mark => Math.min(100, Math.max(0, (mark.seq / maxSeq) * 100)))
}

export interface ContextBarParts {
  bar: HTMLElement
  marks: HTMLElement
  num: HTMLElement
  popover: HTMLElement
}

/** 就地更新占用条、刻度与压缩点浮层（可展开被压掉的原文）。 */
export function renderContextBar(
  parts: ContextBarParts,
  projections: unknown,
  records: readonly LogRecord[],
  services: { t: (key: string) => string },
): void {
  const values = record(record(projections).values)
  const pressure = record(values.contextPressure)
  const occupancy = computeOccupancy(pressure.projectedTokens, pressure.contextWindow)
  const tone = barTone(occupancy.ratio)
  parts.bar.style.width = `${(occupancy.ratio * 100).toFixed(1)}%`
  parts.bar.style.background = tone === 'danger' ? 'var(--danger)' : tone === 'warn' ? 'var(--warn)' : 'var(--accent)'
  parts.num.textContent = services.t('ctx.used')
    .replace('{used}', formatTokens(occupancy.used))
    .replace('{total}', formatTokens(occupancy.total))

  const marks = findCompactionMarks(records)
  const maxSeq = records.reduce((max, entry) => Math.max(max, num(entry.event?.seq)), 0)
  const offsets = markOffsets(marks, maxSeq)
  parts.marks.innerHTML = marks.map((mark, index) =>
    `<span class="cmark" style="left:${(offsets[index] ?? 0).toFixed(1)}%" title="${escapeHtml(mark.label)}"></span>`).join('')

  const head = `<div class="ctxpop-head">${escapeHtml(services.t('ctx.compaction'))} (${marks.length})</div>`
  const body = marks.length === 0
    ? `<div class="empty">${escapeHtml(services.t('ctx.none'))}</div>`
    : marks.map(mark => `<div class="cmitem">
        <div class="cmtitle">${escapeHtml(mark.label)} · seq ${mark.seq}</div>
        ${mark.original === '' ? '' : `<details><summary>${escapeHtml(services.t('ctx.original'))}</summary><pre>${escapeHtml(mark.original)}</pre></details>`}
      </div>`).join('')
  parts.popover.innerHTML = head + body
}
