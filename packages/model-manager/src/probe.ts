/**
 * 连通性自测（C3-02）：探测函数由调用方注入，结果统一归一化。
 *
 * 纯逻辑本身不发任何请求；probe 可以是真 fetch、假端点、或测试里的同步 stub。
 * 归一化会丢掉耗时 / 时间 / id 等易变字段，只留结构信号，便于断言与回放。
 */
import type { ProviderSpec } from './core.ts'

export interface ProbeOutcome {
  ok: boolean
  status?: number
  error?: string
  models?: readonly string[]
}

export type ProbeFn = (provider: ProviderSpec) => Promise<unknown> | unknown

/** 把各种形状的探测结果归一化成统一结构；易变字段一律丢弃。 */
export function normalizeProbeResult(raw: unknown): ProbeOutcome {
  if (raw === true) return { ok: true }
  if (raw === false || raw === null || raw === undefined) return { ok: false, error: '无响应' }
  if (typeof raw === 'string') return { ok: false, error: raw.slice(0, 120) }
  if (raw instanceof Error) return { ok: false, error: raw.message.slice(0, 120) }
  if (typeof raw !== 'object') return { ok: false, error: '未知结果形状' }
  const value = raw as Record<string, unknown>
  const status = typeof value.status === 'number' ? value.status : undefined
  const models = Array.isArray(value.models)
    ? value.models.filter((item): item is string => typeof item === 'string')
    : undefined
  let ok = false
  if (typeof value.ok === 'boolean') ok = value.ok
  else if (typeof value.success === 'boolean') ok = value.success
  else if (status !== undefined) ok = status >= 200 && status < 300
  const error = typeof value.error === 'string' ? value.error.slice(0, 120) : undefined

  const outcome: ProbeOutcome = { ok }
  if (status !== undefined) outcome.status = status
  if (error !== undefined) outcome.error = error
  if (models !== undefined) outcome.models = models
  return outcome
}

/** 归一化结果的可读标签（界面与 CLI 共用一份文案口径）。 */
export function describeProbe(outcome: ProbeOutcome): string {
  if (outcome.ok) return '连通' + (outcome.status === undefined ? '' : ` (HTTP ${outcome.status})`)
  return '不通' + (outcome.error === undefined ? '' : `: ${outcome.error}`)
}

export interface ConnectivityReport extends ProbeOutcome {
  label: string
}

/** 调一次可注入 probe，捕获异常并归一化；绝不把原始异常直接抛给界面。 */
export async function runConnectivityProbe(provider: ProviderSpec, probe: ProbeFn): Promise<ConnectivityReport> {
  let raw: unknown
  try { raw = await probe(provider) } catch (error) { raw = error }
  const outcome = normalizeProbeResult(raw)
  return { ...outcome, label: outcome.ok ? '连通' : '不通' }
}
