/**
 * 消息反馈与会话统计（C8-23）。
 *
 * 反馈聚合 / 会话统计 / 时长格式化都是纯函数；界面把赞踩按钮挂到消息流，
 * 统计面板走 messageFeedback/list 与 session/projections，端点不可用就地降级。
 */
import { readHarnessUsage } from '@dsh-ghost/economizer'
import {
  asList, escapeHtml, num, paintText, pickStr, record, safeCall, str, unavailableHtml,
  type PanelInstance, type PanelServices,
} from './panels.ts'
import { costRows, parsePricing, PRICING_KEY, serializePricing } from './stats-cost.ts'

export interface FeedbackEntry {
  target: string
  kind: 'positive' | 'negative' | 'other'
  value: string
}

export function normalizeFeedbackEntries(raw: unknown): FeedbackEntry[] {
  const out: FeedbackEntry[] = []
  for (const value of asList(raw)) {
    const item = record(value)
    const target = pickStr(item, ['target', 'messageId', 'id', 'callId', 'seq'])
    const rawValue = item.kind ?? item.type ?? item.rating ?? item.sentiment ?? item.value
    const text = (typeof rawValue === 'number' ? String(rawValue) : str(rawValue)).toLowerCase()
    const kind: FeedbackEntry['kind'] = ['positive', 'up', 'like', 'good', '赞', '1', 'thumbsup'].includes(text)
      ? 'positive'
      : ['negative', 'down', 'dislike', 'bad', '踩', '-1', 'thumbsdown'].includes(text)
        ? 'negative'
        : 'other'
    if (target === '') continue
    out.push({ target, kind, value: pickStr(item, ['comment', 'text', 'note']) })
  }
  return out
}

export interface FeedbackSummary {
  total: number
  positive: number
  negative: number
  byTarget: Array<{ target: string; positive: number; negative: number }>
}

/** 聚合：总赞踩 + 按目标分组（数量降序、名称升序）。 */
export function aggregateFeedback(raw: unknown): FeedbackSummary {
  const entries = normalizeFeedbackEntries(raw)
  const byTarget = new Map<string, { positive: number; negative: number }>()
  let positive = 0
  let negative = 0
  for (const entry of entries) {
    const bucket = byTarget.get(entry.target) ?? { positive: 0, negative: 0 }
    if (entry.kind === 'positive') { bucket.positive += 1; positive += 1 }
    else if (entry.kind === 'negative') { bucket.negative += 1; negative += 1 }
    byTarget.set(entry.target, bucket)
  }
  const list = [...byTarget.entries()]
    .map(([target, counts]) => ({ target, ...counts }))
    .sort((a, b) => (b.positive + b.negative) - (a.positive + a.negative) || a.target.localeCompare(b.target))
  return { total: entries.length, positive, negative, byTarget: list }
}

export interface SessionStats {
  turns: number
  llmMs: number
  inputTokens: number
  outputTokens: number
}

/** 从投影里取统计，字段名随宿主变化，缺失一律补 0。 */
export function sessionStats(projections: unknown): SessionStats {
  const values = record(record(projections).values)
  const stats = record(values.sessionStats)
  const usage = record(values.tokenUsage)
  const pressure = record(values.contextPressure)
  return {
    turns: num(stats.turns),
    llmMs: num(stats.llmMs ?? stats.durationMs),
    inputTokens: num(usage.inputTokens ?? usage.promptTokens ?? pressure.projectedTokens),
    outputTokens: num(usage.outputTokens ?? usage.completionTokens),
  }
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0ms'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60_000).toFixed(1)}min`
}

/** 构造 messageFeedback/put 的 wire 参数。 */
export function buildFeedbackPut(agentId: string, target: string, positive: boolean): { request: Record<string, unknown> } {
  return { request: { agentId, target, kind: positive ? 'positive' : 'negative' } }
}

/** 给消息流里的助手消息追加赞 / 踩按钮（renderStream 之后调用）。 */
export function decorateStream(stream: HTMLElement, services: PanelServices): void {
  stream.querySelectorAll<HTMLElement>('.msg.assistant').forEach((msg, index) => {
    const target = `msg-${index}`
    const bar = document.createElement('div')
    bar.className = 'fback'
    bar.innerHTML = `<button data-fb="positive" data-target="${target}">${escapeHtml(services.t('feedback.like'))}</button>`
      + `<button data-fb="negative" data-target="${target}">${escapeHtml(services.t('feedback.dislike'))}</button>`
    msg.appendChild(bar)
    bar.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-fb]')
      if (button === null) return
      const positive = button.dataset.fb === 'positive'
      void safeCall(() => services.transport.call('messageFeedback/put',
        buildFeedbackPut(services.agentId() ?? '', button.dataset.target ?? '', positive)))
        .then(result => {
          if (!result.ok) { services.notice(result.reason); return }
          // 就地选中态：同一条消息只保留一个评价，再点一次可撤销。
          const wasOn = button.classList.contains('on')
          bar.querySelectorAll<HTMLButtonElement>('button[data-fb]').forEach(item => item.classList.remove('on'))
          if (!wasOn) button.classList.add('on')
          services.notice(services.t('feedback.recorded'))
        })
    })
  })
}

/** 读本地保存的单价；浏览器外安全返回 null。 */
function readPricing(): string | null {
  try {
    return globalThis.localStorage?.getItem(PRICING_KEY) ?? null
  } catch {
    return null
  }
}

/** 单价输入区：留空就只显示 token，不显示金额。 */
function pricingForm(pricing: ReturnType<typeof parsePricing>, t: (key: string) => string): string {
  const value = (key: string): string => pricing === undefined ? '' : String(pricing[key as keyof typeof pricing])
  const field = (key: string, label: string): string =>
    `<label class="price-field"><span>${escapeHtml(label)}</span><input data-price="${key}" type="number" step="0.01" min="0" value="${value(key)}" placeholder="0.00"></label>`
  return `<div class="pricing-box">`
    + `<div class="pricing-title">${escapeHtml(t('stats.pricing'))}</div>`
    + `<div class="price-grid">`
    + field('inputPerMillion', 'input')
    + field('outputPerMillion', 'output')
    + field('cacheReadPerMillion', 'cache read')
    + field('cacheWritePerMillion', 'cache write')
    + `</div>`
    + `<div class="pricing-foot"><button data-act="save-pricing">${escapeHtml(t('stats.pricing.save'))}</button>`
    + `<span class="ldetail">${escapeHtml(t('stats.pricing.hint'))}</span></div>`
    + `</div>`
}

/** C8-23 统计面板：反馈聚合 + 会话统计。 */
export function mountStatsPanel(host: HTMLElement, services: PanelServices): PanelInstance {
  host.innerHTML = `<div class="panelbar">
      <strong data-t="tab.stats"></strong>
      <button data-act="refresh" data-t="common.refresh"></button>
      <span class="panelspacer"></span><span class="panelstatus"></span>
    </div>
    <div class="adminbody">
      <section><h3 data-t="feedback.title"></h3><div data-sec="feedback"></div></section>
      <section><h3 data-t="stats.title"></h3><div data-sec="stats"></div></section>
    </div>`
  const feedbackBox = host.querySelector<HTMLElement>('[data-sec="feedback"]')!
  const statsBox = host.querySelector<HTMLElement>('[data-sec="stats"]')!
  const statusEl = host.querySelector<HTMLElement>('.panelstatus')!

  const load = async (): Promise<void> => {
    paintText(host, services)
    const sessionId = services.agentId() ?? ''
    const feedbackResult = await safeCall(() => services.transport.call('messageFeedback/list', {
      request: { sessionId },
    }))
    if (!feedbackResult.ok) {
      feedbackBox.innerHTML = unavailableHtml(services.t('common.unavailable'), feedbackResult.reason)
    } else {
      const summary = aggregateFeedback(feedbackResult.value)
      feedbackBox.innerHTML = `<div class="lrow"><span class="lname">${escapeHtml(
        services.t('feedback.total')
          .replace('{total}', String(summary.total))
          .replace('{positive}', String(summary.positive))
          .replace('{negative}', String(summary.negative)),
      )}</span></div>`
        + summary.byTarget.map(item => `<div class="lrow"><span class="lname">${escapeHtml(item.target)}</span>
            <span class="ldetail">+${item.positive} / -${item.negative}</span></div>`).join('')
    }
    const projectionsResult = await safeCall(() => services.transport.call('session/projections', {
      request: { sessionId },
    }))
    if (!projectionsResult.ok) {
      statsBox.innerHTML = unavailableHtml(services.t('common.unavailable'), projectionsResult.reason)
    } else {
      const stats = sessionStats(projectionsResult.value)
      // 真实用量（宿主 token-meter）：token 构成与缓存命中率永远显示；金额要单价。
      const usage = readHarnessUsage(projectionsResult.value)
      const pricing = parsePricing(readPricing())
      const cost = costRows(usage, pricing)
      // 每个指标拆成"标签 + 数值"两格，网格排布，避免旧版每行一大段留白。
      const stat = (label: string, value: string): string =>
        `<div class="stat"><span class="stat-k">${escapeHtml(label)}</span><span class="stat-v">${escapeHtml(value)}</span></div>`
      statsBox.innerHTML = `<div class="stat-grid">`
        + stat(services.t('stats.label.turns'), String(stats.turns))
        + stat(services.t('stats.label.tokens'), `${stats.inputTokens} / ${stats.outputTokens}`)
        + stat(services.t('stats.label.duration'), formatDuration(stats.llmMs))
        + cost.map(row => {
          const template = services.t(row.key)
          return stat(template.replace('{value}', '').trim(), row.value)
        }).join('')
        + `</div>`
        + pricingForm(pricing, services.t)
    }
    statusEl.textContent = services.t('common.ready')
  }
  host.addEventListener('click', event => {
    const target = event.target as HTMLElement
    const saveButton = target.closest<HTMLButtonElement>('button[data-act="save-pricing"]')
    if (saveButton !== null) {
      const read = (key: string): number => {
        const input = host.querySelector<HTMLInputElement>(`input[data-price="${key}"]`)
        const parsed = Number.parseFloat(input?.value ?? '')
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
      }
      const input = read('inputPerMillion')
      const output = read('outputPerMillion')
      try {
        if (input === 0 && output === 0) globalThis.localStorage?.removeItem(PRICING_KEY)
        else {
          globalThis.localStorage?.setItem(PRICING_KEY, serializePricing({
            inputPerMillion: input,
            outputPerMillion: output,
            cacheReadPerMillion: read('cacheReadPerMillion') || input * 0.1,
            cacheWritePerMillion: read('cacheWritePerMillion') || input * 1.25,
          }))
        }
      } catch { /* 存不了就只在本次会话有效 */ }
      void load()
      return
    }
    const button = target.closest<HTMLButtonElement>('button[data-act="refresh"]')
    if (button !== null) void load()
  })
  return { refresh: load }
}
