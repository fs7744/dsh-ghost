/**
 * 剧本 × 定时：把宿主的持久化定时（cron/daily/weekly…）接到剧本上。
 *
 * 为什么要合并：剧本是「怎么做」，定时是「什么时候做」。宿主的 schedule 已经把
 * **持久化、时区、投递、投递历史、限流**都做好了（`schedule/*` 九个端点），
 * 我们不该再造一个调度器——只需要让剧本能声明计划，然后复用它。
 *
 * 剧本里这样写（文本仍是唯一真相源，git diff 友好）：
 *
 *   # @ticket-flow v2
 *   # schedule daily 09:00:00 Asia/Shanghai
 *   # schedule weekly 1,3,5 08:30:00 Asia/Shanghai
 *   # schedule cron 0 9 * * 1-5 Asia/Shanghai
 *
 * 定时到点时，宿主把一条 prompt 投递到目标会话；prompt 里带剧本 id 与流程路径，
 * 会话里的 agent 按剧本执行（剧本编译成 skill 包，模型按 skill 跑）。
 */
import type { Flow } from './parse.ts'

/** 计划种类（与宿主 timing 的 kind 对齐）。 */
export type ScheduleKind = 'daily' | 'weekly' | 'cron' | 'every' | 'at' | 'after'

/** 一条计划声明。 */
export interface FlowSchedule {
  kind: ScheduleKind
  /** daily/weekly：时刻 `HH:mm:ss`。 */
  time?: string
  /** weekly：星期几（1=周一 … 7=周日，逗号分隔）。 */
  days?: string
  /** cron：5 段表达式。 */
  expression?: string
  /** every：间隔秒数。 */
  seconds?: number
  /** at：ISO 时间。 */
  at?: string
  /** after：延后秒数。 */
  afterSeconds?: number
  /** 时区（IANA 名，如 Asia/Shanghai）。 */
  timeZone?: string
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/

/** 把 `09:00` 规范成宿主要的 `HH:mm:ss`（宿主只收带秒的）。 */
export function normalizeTime(value: string): string | undefined {
  const match = TIME_PATTERN.exec(value.trim())
  if (match === null) return undefined
  const [, hh = '00', mm = '00', ss = '00'] = match
  return `${hh}:${mm}:${ss}`
}

/**
 * 解析一行计划声明：`daily 09:00 Asia/Shanghai`。
 * @returns 计划；格式不对返回 undefined
 */
export function parseScheduleLine(line: string): FlowSchedule | undefined {
  const parts = line.trim().split(/\s+/).filter(part => part !== '')
  const kind = parts[0]
  if (kind === undefined) return undefined
  const rest = parts.slice(1)
  const timeZone = rest.length > 0 && /^[A-Za-z]+\/[A-Za-z_+-]+$/.test(rest[rest.length - 1] ?? '') ? rest.pop() : undefined

  if (kind === 'daily') {
    const time = normalizeTime(rest[0] ?? '')
    if (time === undefined) return undefined
    return { kind: 'daily', time, ...(timeZone === undefined ? {} : { timeZone }) }
  }
  if (kind === 'weekly') {
    // weekly <星期几> <时刻> [时区]，如 weekly 1,3,5 08:30:00 Asia/Shanghai
    const days = rest[0]
    const time = normalizeTime(rest[1] ?? '')
    if (days === undefined || !/^[1-7](,[1-7])*$/.test(days)) return undefined
    if (time === undefined) return undefined
    return { kind: 'weekly', time, days, ...(timeZone === undefined ? {} : { timeZone }) }
  }
  if (kind === 'cron') {
    const expression = rest.join(' ')
    if (expression.split(/\s+/).length !== 5) return undefined
    return { kind: 'cron', expression, ...(timeZone === undefined ? {} : { timeZone }) }
  }
  if (kind === 'every') {
    const seconds = Number.parseInt(rest[0] ?? '', 10)
    if (!Number.isFinite(seconds) || seconds <= 0) return undefined
    return { kind: 'every', seconds }
  }
  if (kind === 'at') {
    const at = rest[0]
    if (at === undefined) return undefined
    return { kind: 'at', at }
  }
  if (kind === 'after') {
    const seconds = Number.parseInt(rest[0] ?? '', 10)
    if (!Number.isFinite(seconds) || seconds <= 0) return undefined
    return { kind: 'after', afterSeconds: seconds }
  }
  return undefined
}

/**
 * 计划 → 宿主的 timing 结构（`schedule/create` 的 timing 字段）。
 * @returns timing，或 undefined（声明不合法）
 */
export function buildTiming(schedule: FlowSchedule): Record<string, unknown> | undefined {
  switch (schedule.kind) {
    case 'daily':
      if (schedule.time === undefined) return undefined
      return {
        kind: 'daily',
        daily: { time: schedule.time, time_zone: schedule.timeZone ?? 'Asia/Shanghai' },
      }
    case 'weekly': {
      if (schedule.time === undefined || schedule.days === undefined) return undefined
      const days = schedule.days.split(',').map(day => Number.parseInt(day, 10))
      if (days.some(day => day < 1 || day > 7)) return undefined
      return {
        kind: 'weekly',
        weekly: { days, time: schedule.time, time_zone: schedule.timeZone ?? 'Asia/Shanghai' },
      }
    }
    case 'cron':
      if (schedule.expression === undefined) return undefined
      return {
        kind: 'cron',
        cron: { expression: schedule.expression, time_zone: schedule.timeZone ?? 'Asia/Shanghai' },
      }
    case 'every':
      if (schedule.seconds === undefined) return undefined
      return { kind: 'every', every_seconds: schedule.seconds }
    case 'at':
      if (schedule.at === undefined) return undefined
      return { kind: 'at', at: schedule.at }
    case 'after':
      if (schedule.afterSeconds === undefined) return undefined
      return { kind: 'after', after_seconds: schedule.afterSeconds }
    default:
      return undefined
  }
}

/** 剧本执行提示词（定时投递的内容）。 */
export function buildPrompt(flow: Pick<Flow, 'id'>, flowPath?: string): string {
  const target = flowPath === undefined ? '' : `（流程文件：${flowPath}）`
  return `按剧本「${flow.id}」执行。${target}`.trim()
}

/** 建计划请求（`schedule/create` 的 request）。 */
export function buildCreateRequest(options: {
  title: string
  prompt: string
  schedule: FlowSchedule
  /** 目标会话；不给就是「每次新建会话」。 */
  sessionId?: string
}): Record<string, unknown> | undefined {
  const timing = buildTiming(options.schedule)
  if (timing === undefined) return undefined
  return {
    title: options.title,
    prompt: options.prompt,
    timing,
    target: options.sessionId === undefined
      ? { kind: 'new' }
      : { kind: 'session', sessionId: options.sessionId },
  }
}

/** 宿主 schedule 任务（一行）。 */
export interface ScheduleTaskRow {
  id: string
  kind: string
  title: string
  /** 展示用的时间描述（daily 的时刻 / cron 表达式 / at 时间）。 */
  when: string
  timeZone?: string
  status: string
  /** 目标会话（若是固定会话）。 */
  sessionId?: string
  /** 下次触发时间（宿主给的）。 */
  scheduledAt?: string
}

/** 归一化宿主 schedule 列表项。 */
export function normalizeScheduleTasks(raw: unknown): ScheduleTaskRow[] {
  const out: ScheduleTaskRow[] = []
  const list = Array.isArray(raw) ? raw : []
  for (const value of list) {
    if (typeof value !== 'object' || value === null) continue
    const item = value as Record<string, unknown>
    const id = typeof item.id === 'string' ? item.id : ''
    if (id === '') continue
    const kind = typeof item.kind === 'string' ? item.kind : 'unknown'
    const target = typeof item.target === 'object' && item.target !== null
      ? item.target as Record<string, unknown>
      : undefined
    const sessionId = typeof target?.sessionId === 'string' ? target.sessionId : undefined
    const when = kind === 'daily' || kind === 'weekly'
      ? String(item.time ?? '')
      : kind === 'cron'
        ? String(item.expression ?? '')
        : kind === 'every'
          ? `每 ${String(item.everySeconds ?? '')} 秒`
          : kind === 'at'
            ? String(item.scheduledAt ?? '')
            : ''
    out.push({
      id,
      kind,
      title: typeof item.title === 'string' ? item.title : id,
      when,
      ...(typeof item.timeZone === 'string' ? { timeZone: item.timeZone } : {}),
      status: typeof item.status === 'string' ? item.status : 'active',
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(typeof item.scheduledAt === 'string' ? { scheduledAt: item.scheduledAt } : {}),
    })
  }
  return out
}
