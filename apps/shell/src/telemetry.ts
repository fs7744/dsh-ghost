/**
 * 遥测与隐私（C7）：默认关闭、本地优先、可导出可删除、崩溃上报默认关闭。
 *
 * 纯模块：事件只进内存缓冲；是否落盘 / 上报由适配层按配置开关决定。
 * 导出强制脱敏，绝不把 token / key / cookie 带出本机。
 */
import type { Clock } from './ports.ts'
import { redactText } from './diagnostics.ts'

export interface TelemetryEvent {
  ts: number
  kind: string
  detail?: string
}

export class TelemetryBuffer {
  private events: TelemetryEvent[] = []
  private enabled = false

  constructor(private readonly clock: Clock) {}

  setEnabled(value: boolean): void {
    this.enabled = value
    if (!value) this.events = []
  }

  isEnabled(): boolean {
    return this.enabled
  }

  /** 关闭时不记录任何事件；开启时记录，detail 可选。 */
  record(kind: string, detail?: string): boolean {
    if (!this.enabled) return false
    const event: TelemetryEvent = { ts: this.clock.now(), kind }
    if (detail !== undefined) event.detail = detail
    this.events.push(event)
    return true
  }

  get size(): number {
    return this.events.length
  }

  /** 导出为 JSON 文本；detail 强制脱敏。knownSecrets 由调用方注入当前会话敏感值。 */
  export(knownSecrets: readonly string[] = []): string {
    const safe = this.events.map(e => ({
      ts: e.ts,
      kind: e.kind,
      detail: e.detail === undefined ? '' : redactText(e.detail, knownSecrets),
    }))
    return JSON.stringify({ exportedAt: this.clock.now(), events: safe }, null, 2)
  }

  clear(): void {
    this.events = []
  }
}
