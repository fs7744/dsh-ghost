/**
 * Superagent 面板（C8-25）：工作项 / 策略 / 执行状态 / 待人处理。
 *
 * 数据优先走 ghostTickets/list（插件注册的 Remote，未生成端点 -> as never），
 * 失败降级到 session/projections。纯逻辑（票归一化、待人处理筛选、状态分组）零 DOM。
 */
import {
  asList, escapeHtml, paintText, pickStr, record, safeCall, unavailableHtml,
  type PanelInstance, type PanelServices,
} from './panels.ts'

export interface WorkItem {
  id: string
  title: string
  stage: string
  action: string
  needsPerson: boolean
}

/** 归一化票 / 工作项；stage 可能是字符串或 {stage, action} 对象。 */
export function normalizeWorkItems(raw: unknown): WorkItem[] {
  const out: WorkItem[] = []
  for (const value of asList(raw)) {
    const item = record(value)
    const id = pickStr(item, ['id', 'ticketId', 'key'])
    const title = pickStr(item, ['title', 'name', 'summary'])
    if (id === '' && title === '') continue
    const stageObj = record(item.stage)
    const stage = (pickStr(stageObj, ['stage', 'state', 'status']) || pickStr(item, ['stage', 'state', 'status'])).toLowerCase()
    const action = pickStr(stageObj, ['action']) || pickStr(item, ['action'])
    out.push({ id: id || title, title: title || id, stage, action, needsPerson: false })
  }
  return out.map(item => ({ ...item, needsPerson: needsPerson(item) }))
}

/** 待人处理：阶段是 person，或动作是 ask / human。 */
export function needsPerson(item: WorkItem): boolean {
  return item.stage === 'person' || item.action === 'ask' || item.action === 'human'
}

export function selectNeedsPerson(items: readonly WorkItem[]): WorkItem[] {
  return items.filter(item => item.needsPerson)
}

export interface WorkGroup {
  key: string
  label: string
  items: WorkItem[]
}

const STAGE_ORDER = ['person', 'working', 'ended', 'other'] as const

/** 按执行状态分组；组内按 id 排序，空组不返回。 */
export function groupByStage(items: readonly WorkItem[]): WorkGroup[] {
  const buckets = new Map<string, WorkItem[]>()
  for (const item of items) {
    const key = (STAGE_ORDER as readonly string[]).includes(item.stage) ? item.stage : 'other'
    const list = buckets.get(key) ?? []
    list.push(item)
    buckets.set(key, list)
  }
  return STAGE_ORDER.filter(key => (buckets.get(key)?.length ?? 0) > 0)
    .map(key => ({
      key,
      label: key,
      items: [...(buckets.get(key) ?? [])].sort((a, b) => a.id.localeCompare(b.id)),
    }))
}

/** 策略区摘要：工作项总数 + 待人处理数。 */
export function strategySummary(items: readonly WorkItem[], t: (key: string) => string): string {
  return `${t('superagent.workItems')}: ${items.length} · ${t('superagent.needsPerson')}: ${selectNeedsPerson(items).length}`
}

/** 挂载面板：待人处理 / 工作项 / 执行状态 / 策略四区。 */
export function mountSuperagentPanel(host: HTMLElement, services: PanelServices): PanelInstance {
  host.innerHTML = `<div class="panelbar">
      <strong data-t="tab.superagent"></strong>
      <button data-act="refresh" data-t="common.refresh"></button>
      <span class="panelspacer"></span><span class="panelstatus"></span>
    </div>
    <div class="adminbody">
      <section><h3 data-t="superagent.strategy"></h3><div data-sec="strategy"></div></section>
      <section><h3 data-t="superagent.needsPerson"></h3><div data-sec="person"></div></section>
      <section><h3 data-t="superagent.execution"></h3><div data-sec="groups"></div></section>
    </div>`
  const strategyEl = host.querySelector<HTMLElement>('[data-sec="strategy"]')!
  const personEl = host.querySelector<HTMLElement>('[data-sec="person"]')!
  const groupsEl = host.querySelector<HTMLElement>('[data-sec="groups"]')!
  const statusEl = host.querySelector<HTMLElement>('.panelstatus')!

  const load = async (): Promise<void> => {
    paintText(host, services)
    const ticketsResult = await safeCall(() => services.transport.call('ghostTickets/list' as never, {} as never))
    let items = ticketsResult.ok ? normalizeWorkItems(ticketsResult.value) : []
    if (!ticketsResult.ok) {
      const projectionsResult = await safeCall(() => services.transport.call('session/projections', {
        request: { sessionId: services.agentId() ?? '' },
      }))
      if (projectionsResult.ok) {
        const values = record(record(projectionsResult.value).values)
        items = normalizeWorkItems(values.tickets ?? values.workItems ?? values.superagent)
      }
    }
    strategyEl.innerHTML = `<div class="lrow"><span class="lname">${escapeHtml(strategySummary(items, services.t))}</span></div>`
    const person = selectNeedsPerson(items)
    personEl.innerHTML = person.length === 0
      ? `<div class="empty">${escapeHtml(services.t('common.empty'))}</div>`
      : person.map(item => `<div class="lrow"><span class="lstate running">${escapeHtml(services.t('common.ask'))}</span>
          <span class="lname">${escapeHtml(item.title)}</span></div>`).join('')
    const groups = groupByStage(items)
    groupsEl.innerHTML = groups.length === 0
      ? `<div class="empty">${escapeHtml(services.t('common.empty'))}</div>`
      : groups.map(group => `<div class="grouphead">${escapeHtml(services.t('superagent.execution'))} · ${escapeHtml(group.label)} (${group.items.length})</div>`
        + group.items.map(item => `<div class="lrow"><span class="lname">${escapeHtml(item.title)}</span>
            <span class="ldetail">${escapeHtml(item.action)}</span></div>`).join('')).join('')
    statusEl.textContent = services.t('common.count').replace('{count}', String(items.length))
    if (items.length === 0 && !ticketsResult.ok) {
      groupsEl.innerHTML = unavailableHtml(services.t('common.unavailable'), ticketsResult.reason)
    }
  }
  host.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-act="refresh"]')
    if (button !== null) void load()
  })
  return { refresh: load }
}
