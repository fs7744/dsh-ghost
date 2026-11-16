/**
 * 多 agent 面板：团队的开关与任务、子 agent 目录、权限档位。
 *
 * 先说清分工：**宿主的多 agent 能力本来就是开的**（`dsh-subagent` / `dsh-agent-team` /
 * `dsh-tool-agent-team` 都在 base patch 里），模型侧早就有团队工具与子 agent 工具。
 * 我们缺的是**界面层**——用户看不见团队任务、管不了子 agent、也看不到权限档位。
 * 这个面板补的就是这一层。
 */
import {
  asList, escapeHtml, pickStr, record, safeCall, unavailableHtml,
  type PanelInstance, type PanelServices,
} from './panels.ts'

/** 团队任务（一行）。 */
export interface TeamTaskRow {
  id: string
  title: string
  state: string
}

/** 从投影里挑出团队任务。 */
export function normalizeTeamTasks(raw: unknown): TeamTaskRow[] {
  const out: TeamTaskRow[] = []
  for (const value of asList(raw)) {
    const item = record(value)
    const id = pickStr(item, ['id', 'taskId', 'key'])
    const title = pickStr(item, ['title', 'summary', 'task', 'name'])
    if (id === '' && title === '') continue
    out.push({ id: id || title, title: title || id, state: pickStr(item, ['state', 'status', 'phase']) })
  }
  return out
}

/** 子 agent 目录（一行）。 */
export interface SubagentRow {
  id: string
  label: string
  mode: string
}

/** 从投影里挑出子 agent 目录。 */
export function normalizeSubagentCatalog(raw: unknown): SubagentRow[] {
  const out: SubagentRow[] = []
  for (const value of asList(raw)) {
    const item = record(value)
    const id = pickStr(item, ['id', 'provider', 'name'])
    if (id === '') continue
    out.push({ id, label: pickStr(item, ['label', 'title', 'displayName']) || id, mode: pickStr(item, ['mode', 'kind']) })
  }
  return out
}

/** 权限档位（宿主投影里的 permissions.currentValue）。 */
export function normalizePermission(raw: unknown): string {
  const item = record(raw)
  const value = pickStr(item, ['currentValue', 'value', 'mode'])
  return value === '' ? 'unknown' : value
}

/**
 * 多 agent 面板。
 */
export function mountTeamPanel(host: HTMLElement, services: PanelServices): PanelInstance {
  host.innerHTML = `<div class="panelbar">
      <span class="paneltitle"></span>
      <button data-act="refresh" data-t="common.refresh"></button>
      <span class="panelspacer"></span><span class="panelstatus"></span>
    </div>
    <div class="capbody"></div>`
  const body = host.querySelector<HTMLElement>('.capbody')!
  const statusEl = host.querySelector<HTMLElement>('.panelstatus')!
  const titleEl = host.querySelector<HTMLElement>('.paneltitle')!

  const load = async (): Promise<void> => {
    titleEl.textContent = services.t('tab.team')
    const sessionId = services.agentId() ?? ''
    const result = await safeCall(() => services.transport.call('session/projections' as never, {
      request: { sessionId },
    } as never))
    if (!result.ok) {
      body.innerHTML = unavailableHtml(services.t('common.unavailable'), result.reason)
      statusEl.textContent = ''
      return
    }
    const values = record(record(result.value).values)
    const team = record(values.agentTeam)
    const enabled = team.enabled === true
    const tasks = normalizeTeamTasks(team.tasks)
    const catalog = normalizeSubagentCatalog(values.subagentCatalog)
    const permission = normalizePermission(values.permissions)
    const subagent = record(values.subagent)
    const subagentState = subagent === undefined || Object.keys(subagent).length === 0
      ? services.t('team.noSubagent')
      : `${pickStr(subagent, ['label', 'id', 'provider'])}${pickStr(subagent, ['state', 'status']) === '' ? '' : `（${pickStr(subagent, ['state', 'status'])}）`}`

    body.innerHTML = `<section><h3 data-t="team.mode"></h3>
        <div class="lrow"><span class="lname">${escapeHtml(services.t('team.switch'))}</span>
          <span class="lstate ${enabled ? 'done' : 'idle'}">${escapeHtml(enabled ? services.t('common.enabled') : services.t('common.disabled'))}</span>
          <button data-act="toggle-team" data-enabled="${enabled}" data-t="${enabled ? 'team.disable' : 'team.enable'}"></button>
        </div>
        <div class="lrow"><span class="ldetail">${escapeHtml(services.t('team.modeHint'))}</span></div></section>`
      + `<section><h3 data-t="team.tasks"></h3>
        ${tasks.length === 0
          ? `<div class="empty">${escapeHtml(services.t('team.noTasks'))}</div>`
          : tasks.map(task => `<div class="lrow"><span class="lname">${escapeHtml(task.title)}</span>
              ${task.state === '' ? '' : `<span class="lstate">${escapeHtml(task.state)}</span>`}</div>`).join('')}</section>`
      + `<section><h3 data-t="team.subagents"></h3>
        <div class="lrow"><span class="lname">${escapeHtml(services.t('team.current'))}</span>
          <span class="ldetail">${escapeHtml(subagentState)}</span></div>
        ${catalog.length === 0
          ? `<div class="empty">${escapeHtml(services.t('team.noCatalog'))}</div>`
          : catalog.map(row => `<div class="lrow"><span class="lname">${escapeHtml(row.label)}</span>
              <span class="lstate">${escapeHtml(row.mode)}</span></div>`).join('')}</section>`
      + `<section><h3 data-t="team.permissions"></h3>
        <div class="lrow"><span class="lname">${escapeHtml(services.t('team.permissionLevel'))}</span>
          <span class="ldetail">${escapeHtml(permission)}</span></div>
        <div class="lrow"><span class="ldetail">${escapeHtml(services.t('team.permissionHint'))}</span></div></section>`
    statusEl.textContent = services.t('common.ready')
  }

  host.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]')
    if (button === null) return
    const action = button.dataset.act ?? ''
    if (action === 'refresh') { void load(); return }
    if (action === 'toggle-team') {
      const enabled = button.dataset.enabled === 'true'
      const agentId = services.agentId() ?? ''
      void safeCall(() => services.transport.call('agentTeams/setEnabled' as never, { agentId, enabled: !enabled } as never))
        .then(result => {
          services.notice(result.ok ? services.t('common.saved') : result.reason)
          void load()
        })
    }
  })
  return { refresh: load }
}
