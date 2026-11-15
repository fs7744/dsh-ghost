/**
 * C10-07：进化度量。
 *
 * 每次任务结束写一条 run 到 `runs.jsonl`（本地，不外传），
 * 用纯函数做 before/after 对比与汇总看板——「无度量不合并」。
 * encodeRun/parseRun/summarize/compareMetrics/dashboard 都是纯函数；
 * 只有 appendRun/readRuns 碰到文件，且文件能力可注入。
 */
import { nodeFileIo, type FileIo } from './io.ts'

/** 一条任务运行记录。 */
export interface RunRecord {
  ticketId: string
  /** ISO 时间戳。 */
  at: string
  /** 是否完成（完成率的分子）。 */
  completed: boolean
  tokens: number
  toolCalls: number
  /** 返工次数。 */
  rework: number
  /** 是否越权（可选，便于以后筛选）。 */
  violation?: boolean
}

/** 一组 run 的汇总指标。 */
export interface MetricsSummary {
  runs: number
  completionRate: number // 0..1
  avgTokens: number
  avgToolCalls: number
  totalRework: number
  avgRework: number
}

/** 一项指标的 before/after 对比。 */
export interface MetricComparison {
  metric: 'completionRate' | 'avgTokens' | 'avgToolCalls' | 'totalRework'
  before: number
  after: number
  delta: number
  improved: boolean
}

/** 汇总看板数据结构，直接序列化给 UI。 */
export interface Dashboard {
  before: MetricsSummary
  after: MetricsSummary
  comparison: MetricComparison[]
  runs: number
}

/** 把一条 run 编成 JSONL 的一行。 */
export function encodeRun(record: RunRecord): string {
  return JSON.stringify(record)
}

/** 解析一行 JSONL；脏行返回 undefined（跳过而不是让整批失败）。 */
export function parseRun(line: string): RunRecord | undefined {
  const trimmed = line.trim()
  if (trimmed === '') return undefined
  try {
    const value: unknown = JSON.parse(trimmed)
    if (typeof value !== 'object' || value === null) return undefined
    const record = value as Record<string, unknown>
    if (typeof record.ticketId !== 'string'
      || typeof record.at !== 'string'
      || typeof record.completed !== 'boolean'
      || typeof record.tokens !== 'number'
      || typeof record.toolCalls !== 'number'
      || typeof record.rework !== 'number') return undefined
    return {
      ticketId: record.ticketId,
      at: record.at,
      completed: record.completed,
      tokens: record.tokens,
      toolCalls: record.toolCalls,
      rework: record.rework,
      ...(record.violation === true ? { violation: true } : {}),
    }
  } catch {
    return undefined
  }
}

/** 汇总一组 run（纯函数）。 */
export function summarize(runs: readonly RunRecord[]): MetricsSummary {
  const count = runs.length
  if (count === 0) {
    return { runs: 0, completionRate: 0, avgTokens: 0, avgToolCalls: 0, totalRework: 0, avgRework: 0 }
  }
  const sum = (pick: (record: RunRecord) => number): number => runs.reduce((total, record) => total + pick(record), 0)
  const totalRework = sum(record => record.rework)
  return {
    runs: count,
    completionRate: runs.filter(record => record.completed).length / count,
    avgTokens: sum(record => record.tokens) / count,
    avgToolCalls: sum(record => record.toolCalls) / count,
    totalRework,
    avgRework: totalRework / count,
  }
}

/** before/after 对比（纯函数）。完成率越高越好，其余越低越好。 */
export function compareMetrics(
  before: readonly RunRecord[],
  after: readonly RunRecord[],
): MetricComparison[] {
  const b = summarize(before)
  const a = summarize(after)
  const definitions: ReadonlyArray<{
    metric: MetricComparison['metric']
    before: number
    after: number
    lowerIsBetter: boolean
  }> = [
    { metric: 'completionRate', before: b.completionRate, after: a.completionRate, lowerIsBetter: false },
    { metric: 'avgTokens', before: b.avgTokens, after: a.avgTokens, lowerIsBetter: true },
    { metric: 'avgToolCalls', before: b.avgToolCalls, after: a.avgToolCalls, lowerIsBetter: true },
    { metric: 'totalRework', before: b.totalRework, after: a.totalRework, lowerIsBetter: true },
  ]
  return definitions.map(item => ({
    metric: item.metric,
    before: item.before,
    after: item.after,
    delta: item.after - item.before,
    improved: item.lowerIsBetter ? item.after < item.before : item.after > item.before,
  }))
}

/** 汇总看板（纯函数）。 */
export function dashboard(before: readonly RunRecord[], after: readonly RunRecord[]): Dashboard {
  return {
    before: summarize(before),
    after: summarize(after),
    comparison: compareMetrics(before, after),
    runs: before.length + after.length,
  }
}

/** 追加一条 run 到 runs.jsonl。 */
export async function appendRun(path: string, record: RunRecord, io: FileIo = nodeFileIo()): Promise<void> {
  await io.append(path, `${encodeRun(record)}\n`)
}

/** 读出全部 run；文件不存在返回空数组。 */
export async function readRuns(path: string, io: FileIo = nodeFileIo()): Promise<RunRecord[]> {
  let raw: string
  try {
    raw = await io.read(path)
  } catch {
    return []
  }
  return raw.split(/\r?\n/).map(parseRun).filter((record): record is RunRecord => record !== undefined)
}
