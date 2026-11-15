/**
 * 定时任务区：把宿主持久化定时（schedule/*）接到剧本上。
 *
 * 剧本写 `# schedule daily 09:00:00 Asia/Shanghai` 声明计划；
 * 到点时宿主把一条提示词投递给目标会话，会话里的 agent 按剧本执行。
 * 我们**不自己造调度器**——持久化、时区、投递、投递历史、限流都由宿主负责。
 */
import { buildCreateRequest, buildPrompt, normalizeScheduleTasks, parseScheduleLine } from '@dsh-ghost/playbook'
import {
  escapeHtml, record, safeCall, unavailableHtml,
  type PanelServices,
} from './panels.ts'

/** 读输入框。 */
const read = (host: HTMLElement, key: string): string =>
  host.querySelector<HTMLInputElement>(`[data-sched="${key}"]`)?.value.trim() ?? ''

/**
 * 渲染定时任务区（设置页用）。
 */
export async function renderSchedulesSection(host: HTMLElement, services: PanelServices): Promise<void> {
  const box = host.querySelector<HTMLElement>('[data-sec="schedules"]')
  if (box === null) return
  const result = await safeCall(() => services.transport.call('schedule/list' as never, { request: {} } as never))
  if (!result.ok) {
    box.innerHTML = unavailableHtml(services.t('common.unavailable'), result.reason)
    return
  }
  const tasks = normalizeScheduleTasks(record(result.value).items)
  const rows = tasks.map(task => `<div class="lrow">
      <span class="lname">${escapeHtml(task.title)}</span>
      <span class="lstate">${escapeHtml(task.kind)}</span>
      <span class="ldetail">${escapeHtml(`${task.when}${task.timeZone === undefined ? '' : ` ${task.timeZone}`}`)}</span>
      <span class="lstate ${task.status === 'active' ? 'done' : 'idle'}">${escapeHtml(task.status)}</span>
      <button data-act="run-schedule" data-value="${escapeHtml(task.id)}" data-t="settings.schedules.run"></button>
      <button data-act="toggle-schedule" data-value="${escapeHtml(task.id)}"
        data-t="${task.status === 'active' ? 'settings.schedules.pause' : 'settings.schedules.resume'}"></button>
      <button data-act="delete-schedule" data-value="${escapeHtml(task.id)}" data-t="settings.schedules.delete"></button>
    </div>`).join('')
  box.innerHTML = (rows === '' ? `<div class="empty">${escapeHtml(services.t('settings.schedules.empty'))}</div>` : rows)
    + `<div class="lrow">
        <input data-sched="flowId" placeholder="剧本 id" />
        <input data-sched="plan" placeholder="计划（daily 09:00:00 Asia/Shanghai）" />
        <input data-sched="sessionId" placeholder="目标会话 id（留空＝每次新建）" />
        <button data-act="create-schedule" data-t="settings.schedules.create"></button></div>`
    + `<div class="lrow"><span class="ldetail">${escapeHtml(services.t('settings.schedules.hint'))}</span></div>`
}

/**
 * 定时任务动作：立即运行 / 暂停恢复 / 删除。
 */
export async function scheduleAction(
  host: HTMLElement,
  services: PanelServices,
  id: string,
  action: 'run' | 'toggle' | 'delete',
): Promise<void> {
  if (id === '') return
  if (action === 'run') {
    const result = await safeCall(() => services.transport.call('schedule/run' as never, { request: { id } } as never))
    services.notice(result.ok ? services.t('settings.schedules.ran') : result.reason)
    void renderSchedulesSection(host, services)
    return
  }
  if (action === 'delete') {
    const result = await safeCall(() => services.transport.call('schedule/edit' as never, {
      request: { id, action: 'delete' },
    } as never))
    services.notice(result.ok ? services.t('settings.schedules.deleted') : result.reason)
    void renderSchedulesSection(host, services)
    return
  }
  const listed = await safeCall(() => services.transport.call('schedule/list' as never, { request: {} } as never))
  const current = listed.ok
    ? normalizeScheduleTasks(record(listed.value).items).find(item => item.id === id)
    : undefined
  const result = await safeCall(() => services.transport.call('schedule/edit' as never, {
    request: { id, action: 'update', patch: { active: current?.status !== 'active' } },
  } as never))
  services.notice(result.ok ? services.t('common.done') : result.reason)
  void renderSchedulesSection(host, services)
}

/**
 * 从剧本建一个定时：计划写在剧本的 `# schedule` 头里，或在这里手填。
 */
export async function createSchedule(host: HTMLElement, services: PanelServices): Promise<void> {
  const flowId = read(host, 'flowId')
  const plan = read(host, 'plan')
  const sessionId = read(host, 'sessionId')
  if (flowId === '' || plan === '') {
    services.notice(services.t('settings.schedules.incomplete'))
    return
  }
  const schedule = parseScheduleLine(plan)
  if (schedule === undefined) {
    services.notice(services.t('settings.schedules.badPlan'))
    return
  }
  const request = buildCreateRequest({
    title: flowId,
    prompt: buildPrompt({ id: flowId }),
    schedule,
    ...(sessionId === '' ? {} : { sessionId }),
  })
  if (request === undefined) {
    services.notice(services.t('settings.schedules.badPlan'))
    return
  }
  const result = await safeCall(() => services.transport.call('schedule/create' as never, { request } as never))
  if (!result.ok) {
    services.notice(result.reason)
    return
  }
  services.notice(services.t('settings.schedules.created'))
  void renderSchedulesSection(host, services)
}
