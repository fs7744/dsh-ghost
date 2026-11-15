/**
 * 运行时面板：终端 / 后台任务 / 计划 / 目标 / 协作（子代理 + 团队） / 技能
 * （C8-07 / C8-08 / C8-11 / C8-12 / C8-13 / C8-14 / C8-15）。
 *
 * 统一走一个列表面板工厂：load() 依次尝试候选 Remote 端点 -> 纯函数归一化 ->
 * render() -> 用户动作再调 Remote。端点全不可用则渲染「该能力未启用」。
 */
import {
  asList, bool, escapeHtml, paintText, pickStr, record, safeCall, unavailableHtml,
  type PanelInstance, type PanelServices,
} from './panels.ts'

export type Tone = 'running' | 'done' | 'failed' | 'idle'

export interface GenericRow {
  id: string
  name: string
  state: string
  detail: string
}

/** 通用行归一化：从任意描述符里挑 id / name / state / detail，丢掉空壳。 */
export function genericRows(raw: unknown): GenericRow[] {
  const out: GenericRow[] = []
  for (const value of asList(raw)) {
    const item = record(value)
    const id = pickStr(item, ['id', 'sessionId', 'callId', 'key', 'ref'])
    const name = pickStr(item, ['name', 'title', 'label', 'command', 'text']) || id
    const state = pickStr(item, ['state', 'status', 'stage', 'kind', 'phase'])
    const detail = pickStr(item, ['description', 'summary', 'detail', 'cwd', 'path', 'command'])
    if (id === '' && name === '') continue
    out.push({ id: id || name, name, state, detail })
  }
  return out
}

/** 状态 -> 语义色调。 */
export function jobTone(state: string): Tone {
  const value = state.toLowerCase()
  if (value.includes('run') || value.includes('active') || value.includes('pending') || value.includes('queue')) return 'running'
  if (value.includes('fail') || value.includes('error') || value.includes('kill') || value.includes('cancel')) return 'failed'
  if (value.includes('done') || value.includes('complete') || value.includes('success') || value.includes('exit')) return 'done'
  return 'idle'
}

export function toneLabel(tone: Tone, services: PanelServices): string {
  const keys: Record<Tone, string> = {
    running: 'runtime.running', done: 'runtime.done', failed: 'runtime.failed', idle: 'runtime.idle',
  }
  return services.t(keys[tone])
}

export interface JobRow extends GenericRow {
  tone: Tone
}
export function normalizeJobs(raw: unknown): JobRow[] {
  return genericRows(raw).map(row => ({ ...row, tone: jobTone(row.state) }))
}
/** 运行中的排最前，其次失败 / 空闲 / 已完成；同级按名称。 */
export function sortJobs(rows: readonly JobRow[]): JobRow[] {
  const rank: Record<Tone, number> = { running: 0, failed: 1, idle: 2, done: 3 }
  return [...rows].sort((a, b) => rank[a.tone] - rank[b.tone] || a.name.localeCompare(b.name))
}

export function normalizeTerminals(raw: unknown): GenericRow[] {
  return genericRows(raw)
}

export interface SkillRow extends GenericRow {
  /** 技能文件路径（宿主给的是绝对路径）。 */
  path: string
  /** 模型能否直接调用（宿主 skills/list 的 modelInvocable）。 */
  modelInvocable: boolean
  /** 技能说明。 */
  description: string
}

export function normalizeSkills(raw: unknown): SkillRow[] {
  const values = asList(raw)
  const list = values.length > 0 ? values : [record(raw).skills ?? raw]
  const out: SkillRow[] = []
  for (const value of list) {
    const item = record(value)
    const name = pickStr(item, ['name', 'title', 'id'])
    if (name === '') continue
    out.push({
      id: name,
      name,
      state: item.modelInvocable === true ? 'model' : '',
      detail: pickStr(item, ['description', 'summary']),
      description: pickStr(item, ['description', 'summary']),
      path: pickStr(item, ['path']),
      modelInvocable: item.modelInvocable === true,
    })
  }
  return sortSkills(out)
}
export function sortSkills(rows: readonly SkillRow[]): SkillRow[] {
  return [...rows].sort((a, b) => a.name.localeCompare(b.name))
}

export interface GoalRow extends GenericRow {
  tone: Tone
}
export function goalTone(state: string): Tone {
  return jobTone(state)
}
export function normalizeGoals(raw: unknown): GoalRow[] {
  const values = asList(raw)
  const source = values.length > 0 ? values : [record(raw).goal ?? raw]
  return genericRows(source).map(row => ({ ...row, tone: goalTone(row.state) }))
}

/** 从 session/projections 里挖计划步骤；字段名随宿主版本变化，这里兼容多种。 */
export function planFromProjections(raw: unknown): unknown[] {
  const values = record(record(raw).values)
  for (const key of ['plan', 'todo', 'todos', 'steps', 'planMode']) {
    const candidate = values[key]
    if (Array.isArray(candidate)) return candidate
    const nested = record(candidate)
    for (const sub of ['items', 'steps', 'todos', 'entries']) {
      const inner = nested[sub]
      if (Array.isArray(inner)) return inner
    }
  }
  return []
}

export interface PlanStep {
  id: string
  text: string
  done: boolean
}
export function normalizePlan(raw: unknown): PlanStep[] {
  const out: PlanStep[] = []
  for (const value of asList(raw)) {
    const item = record(value)
    const text = pickStr(item, ['text', 'title', 'content', 'step', 'description'])
    if (text === '') continue
    const id = pickStr(item, ['id', 'key', 'index']) || String(out.length)
    const status = pickStr(item, ['status', 'state']).toLowerCase()
    const done = bool(item.done) || status === 'done' || status === 'completed' || status === 'checked'
    out.push({ id, text, done })
  }
  return out
}

/** 子代理与团队合在一个视图：从投影里分别取，打上来源前缀。 */
export function collabRows(raw: unknown): GenericRow[] {
  const values = record(record(raw).values)
  const out: GenericRow[] = []
  const collect = (source: unknown, label: string): void => {
    for (const value of asList(source)) {
      const item = record(value)
      const id = pickStr(item, ['id', 'sessionId', 'childSessionId', 'name'])
      const name = pickStr(item, ['name', 'title', 'label']) || id
      if (name === '') continue
      out.push({
        id: `${label}:${id || name}`,
        name: `${label} ${name}`,
        state: pickStr(item, ['state', 'status']),
        detail: pickStr(item, ['task', 'summary', 'description']),
      })
    }
  }
  collect(values.subagents ?? values.subagent ?? values.children, '子代理')
  collect(values.agentTeam ?? values.team ?? values.agentTeams, '团队')
  return out
}

export interface EndpointCall {
  endpoint: string
  args: (services: PanelServices) => Record<string, unknown>
}

export interface ListPanelOptions<T> {
  head?: (services: PanelServices) => string
  endpoints: readonly EndpointCall[]
  normalize: (raw: unknown) => T[]
  rowHtml: (item: T, services: PanelServices) => string
  act?: (action: string, value: string, services: PanelServices, refresh: () => Promise<void>) => void
}

/** 列表面板工厂：所有运行时视图共用同一套 load / render / 降级 / 刷新骨架。 */
export function mountListPanel<T>(host: HTMLElement, services: PanelServices, options: ListPanelOptions<T>): PanelInstance {
  host.innerHTML = `<div class="panelbar">
      <span class="paneltitle"></span>
      <button data-act="refresh" data-t="common.refresh"></button>
      <span class="panelspacer"></span><span class="panelstatus"></span>
    </div><div class="panellist"></div>`
  const listEl = host.querySelector<HTMLElement>('.panellist')!
  const statusEl = host.querySelector<HTMLElement>('.panelstatus')!
  const titleEl = host.querySelector<HTMLElement>('.paneltitle')!

  const load = async (): Promise<void> => {
    titleEl.textContent = options.head === undefined ? '' : options.head(services)
    paintText(host, services)
    let value: unknown
    let reason = ''
    let ok = false
    for (const ep of options.endpoints) {
      const result = await safeCall(() => services.transport.call(ep.endpoint as never, ep.args(services) as never))
      if (result.ok) { value = result.value; ok = true; break }
      reason = result.reason
    }
    if (!ok) {
      listEl.innerHTML = unavailableHtml(services.t('common.unavailable'), reason)
      paintText(host, services)
      return
    }
    const rows = options.normalize(value)
    statusEl.textContent = services.t('common.count').replace('{count}', String(rows.length))
    listEl.innerHTML = rows.length === 0
      ? `<div class="empty">${escapeHtml(services.t('common.empty'))}</div>`
      : rows.map(row => options.rowHtml(row, services)).join('')
    paintText(host, services)
  }

  host.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]')
    if (button === null) return
    const action = button.dataset.act ?? ''
    if (action === 'refresh') { void load(); return }
    if (options.act !== undefined) options.act(action, button.dataset.value ?? '', services, load)
  })
  return { refresh: load }
}

const AGENT_ARGS = (services: PanelServices): Record<string, unknown> => ({ agentId: services.agentId() ?? '' })
const SESSION_ARGS = (services: PanelServices): Record<string, unknown> => ({ sessionId: services.agentId() ?? '' })
const PROJECTIONS_ARGS = (services: PanelServices): Record<string, unknown> => ({
  request: { sessionId: services.agentId() ?? '' },
})

/** C8-07 终端面板。 */
export function mountTerminalPanel(host: HTMLElement, services: PanelServices): PanelInstance {
  return mountListPanel<GenericRow>(host, services, {
    endpoints: [{ endpoint: 'terminal/list', args: SESSION_ARGS }],
    normalize: normalizeTerminals,
    rowHtml: (row, s) => `<div class="lrow">
      <span class="lname">${escapeHtml(row.name || row.id)}</span>
      <span class="lstate ${jobTone(row.state)}">${escapeHtml(row.state || s.t('runtime.idle'))}</span>
      <span class="ldetail">${escapeHtml(row.detail)}</span></div>`,
  })
}

/** C8-08 后台任务面板：可终止（job/kill）；request 形状随宿主版本变化，依次尝试。 */
export function mountJobsPanel(host: HTMLElement, services: PanelServices): PanelInstance {
  return mountListPanel<JobRow>(host, services, {
    endpoints: [
      { endpoint: 'job/list', args: s => ({ request: { sessionId: s.agentId() ?? '' } }) },
      { endpoint: 'job/list', args: () => ({ request: {} }) },
    ],
    normalize: rows => sortJobs(normalizeJobs(rows)),
    rowHtml: (row, s) => `<div class="lrow">
      <span class="lname">${escapeHtml(row.name || row.id)}</span>
      <span class="lstate ${row.tone}">${escapeHtml(toneLabel(row.tone, s))}</span>
      <button data-act="kill" data-value="${escapeHtml(row.id)}" data-t="runtime.kill"></button></div>`,
    act: (action, value, s, refresh) => {
      if (action !== 'kill') return
      void safeCall(() => s.transport.call('job/kill', { request: { id: value } } as never))
        .then(result => { s.notice(result.ok ? s.t('runtime.done') : result.reason); void refresh() })
    },
  })
}

/** C8-11 计划视图（投影里的 plan / todo 步骤）。 */
export function mountPlanPanel(host: HTMLElement, services: PanelServices): PanelInstance {
  return mountListPanel<PlanStep>(host, services, {
    endpoints: [{ endpoint: 'session/projections', args: PROJECTIONS_ARGS }],
    normalize: raw => normalizePlan(planFromProjections(raw)),
    rowHtml: step => `<div class="lrow">
      <span class="lcheck">${step.done ? '[x]' : '[ ]'}</span>
      <span class="lname">${escapeHtml(step.text)}</span></div>`,
  })
}

/** C8-12 目标视图（goals/get，可暂停 / 完成）。 */
export function mountGoalsPanel(host: HTMLElement, services: PanelServices): PanelInstance {
  return mountListPanel<GoalRow>(host, services, {
    endpoints: [{ endpoint: 'goals/get', args: AGENT_ARGS }],
    normalize: normalizeGoals,
    rowHtml: (row, s) => `<div class="lrow">
      <span class="lname">${escapeHtml(row.name || row.id)}</span>
      <span class="lstate ${row.tone}">${escapeHtml(row.state || s.t('runtime.idle'))}</span>
      <button data-act="pause" data-value="${escapeHtml(row.id)}" data-t="common.off"></button>
      <button data-act="complete" data-value="${escapeHtml(row.id)}" data-t="runtime.done"></button></div>`,
    act: (action, value, s, refresh) => {
      const endpoint = action === 'pause' ? 'goals/pause' : action === 'complete' ? 'goals/complete' : ''
      if (endpoint === '') return
      void safeCall(() => s.transport.call(endpoint as never, {
        agentId: s.agentId() ?? '', ref: value,
      } as never)).then(result => { s.notice(result.ok ? s.t('runtime.done') : result.reason); void refresh() })
    },
  })
}

/** C8-13 + C8-14 子代理 / 团队视图。 */
export function mountCollabPanel(host: HTMLElement, services: PanelServices): PanelInstance {
  return mountListPanel<GenericRow>(host, services, {
    endpoints: [{ endpoint: 'session/projections', args: PROJECTIONS_ARGS }],
    normalize: collabRows,
    rowHtml: (row, s) => `<div class="lrow">
      <span class="lname">${escapeHtml(row.name)}</span>
      <span class="lstate ${jobTone(row.state)}">${escapeHtml(row.state || s.t('runtime.idle'))}</span>
      <span class="ldetail">${escapeHtml(row.detail)}</span></div>`,
  })
}

/** C8-15 技能面板（skills/list 的 request 需带 sessionId，验证见 verify-skill.mjs）。 */
export function mountSkillsPanel(host: HTMLElement, services: PanelServices): PanelInstance {
  return mountListPanel<SkillRow>(host, services, {
    endpoints: [
      { endpoint: 'skills/list', args: s => ({ request: { sessionId: s.agentId() ?? '' } }) },
      { endpoint: 'skills/list', args: () => ({ request: {} }) },
    ],
    normalize: rows => sortSkills(normalizeSkills(rows)),
    rowHtml: (row, s) => `<div class="lrow">
      <span class="lname">${escapeHtml(row.name || row.id)}</span>
      <span class="ldetail">${escapeHtml(row.description || s.t('common.empty'))}</span>
      ${row.modelInvocable ? `<span class="lstate done">${escapeHtml(s.t('skills.modelInvocable'))}</span>` : ''}</div>`,
  })
}
