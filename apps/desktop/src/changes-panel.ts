/**
 * 变更与合并面板（桌面端）。
 *
 * 数据来自**壳侧 git**（`window.shellApi.git`）：宿主虽有 `workspaceFiles/changes`，
 * 但它是 stream 方法，渲染层调不到；差异与合并需要真 git，所以走壳。
 * 浏览器里跑（没有 shellApi）时给出明确提示，不假装有数据。
 */
import { parseUnifiedDiff, type ChangedFile } from '@dsh-ghost/git-view'
import {
  armConfirm, escapeHtml, record, safeCall, unavailableHtml,
  type PanelInstance, type PanelServices,
} from './panels.ts'

/** 壳暴露的 git 能力（形状很窄，只用这四个操作）。 */
export interface GitBridge {
  git?: (op: string, payload?: unknown) => Promise<unknown>
}

/** 取壳的 git 桥；浏览器里返回 undefined。 */
export function gitBridge(): GitBridge | undefined {
  return (globalThis as unknown as { shellApi?: GitBridge }).shellApi
}

/** 归一化变更文件列表。 */
export function normalizeChangedFiles(raw: unknown): ChangedFile[] {
  const out: ChangedFile[] = []
  const list = Array.isArray(raw) ? raw : []
  for (const value of list) {
    const item = record(value)
    const path = typeof item.path === 'string' ? item.path : ''
    if (path === '') continue
    out.push({
      path,
      status: (typeof item.status === 'string' ? item.status : 'unknown') as ChangedFile['status'],
      additions: typeof item.additions === 'number' ? item.additions : 0,
      deletions: typeof item.deletions === 'number' ? item.deletions : 0,
    })
  }
  return out
}

const STATUS_LABEL: Record<string, string> = {
  added: '新增',
  modified: '修改',
  deleted: '删除',
  renamed: '重命名',
  untracked: '未跟踪',
  conflicted: '冲突',
  unknown: '未知',
}

/** 差异文本 → 可渲染 HTML（+/- 着色 + 行号）。 */
export function renderDiffHtml(diff: string): string {
  const lines = parseUnifiedDiff(diff)
  if (lines.length === 0) return '<div class="empty">没有差异</div>'
  return `<pre class="diff">${lines.map(line => {
    const cls = line.type === 'add' ? 'add' : line.type === 'del' ? 'del' : line.type === 'hunk' ? 'hunk' : 'ctx'
    const no = line.type === 'del' ? line.oldNo : line.newNo
    const number = no === undefined ? '' : String(no).padStart(4, ' ')
    return `<span class="dl ${cls}"><span class="dl-no">${escapeHtml(number)}</span>${escapeHtml(line.text)}</span>`
  }).join('\n')}</pre>`
}

/**
 * 变更与合并面板：左侧变更文件，右侧差异；冲突文件带「用我方 / 用对方」。
 */
export function mountChangesPanel(host: HTMLElement, services: PanelServices): PanelInstance {
  host.innerHTML = `<div class="panelbar">
      <span class="paneltitle"></span>
      <button data-act="refresh" data-t="common.refresh"></button>
      <span class="panelspacer"></span><span class="panelstatus"></span>
    </div>
    <div class="changes">
      <div class="chlist"></div>
      <div class="chdiff"></div>
    </div>`
  const listEl = host.querySelector<HTMLElement>('.chlist')!
  const diffEl = host.querySelector<HTMLElement>('.chdiff')!
  const statusEl = host.querySelector<HTMLElement>('.panelstatus')!
  const titleEl = host.querySelector<HTMLElement>('.paneltitle')!
  let selected = ''

  const load = async (): Promise<void> => {
    titleEl.textContent = services.t('tab.changes')
    const bridge = gitBridge()
    if (bridge?.git === undefined) {
      listEl.innerHTML = ''
      diffEl.innerHTML = `<div class="empty">${escapeHtml(services.t('changes.needShell'))}</div>`
      statusEl.textContent = ''
      return
    }
    const changes = await safeCall(() => bridge.git!('changes', {}))
    if (!changes.ok) {
      listEl.innerHTML = ''
      diffEl.innerHTML = unavailableHtml(services.t('common.unavailable'), changes.reason)
      return
    }
    const files = normalizeChangedFiles(record(changes.value).files)
    const conflicts = await safeCall(() => bridge.git!('conflicts', {}))
    const conflictPaths = conflicts.ok
      ? (Array.isArray(record(conflicts.value).files) ? (record(conflicts.value).files as string[]) : [])
      : []
    statusEl.textContent = services.t('common.count').replace('{count}', String(files.length))
    if (files.length === 0) {
      listEl.innerHTML = `<div class="empty">${escapeHtml(services.t('changes.clean'))}</div>`
      diffEl.innerHTML = ''
      return
    }
    listEl.innerHTML = files.map(file => {
      const conflicted = conflictPaths.includes(file.path) || file.status === 'conflicted'
      const badge = conflicted ? services.t('changes.conflict') : (STATUS_LABEL[file.status] ?? file.status)
      return `<div class="chrow${file.path === selected ? ' active' : ''}" data-path="${escapeHtml(file.path)}">
          <span class="chbadge ${file.status}">${escapeHtml(badge)}</span>
          <span class="chpath">${escapeHtml(file.path)}</span>
          <span class="chcount">+${file.additions} / -${file.deletions}</span>
        </div>`
    }).join('')
    if (selected !== '' && files.some(file => file.path === selected)) await showDiff(selected)
  }

  const showDiff = async (path: string): Promise<void> => {
    selected = path
    const bridge = gitBridge()
    if (bridge?.git === undefined) return
    const result = await safeCall(() => bridge.git!('diff', { path }))
    if (!result.ok) {
      diffEl.innerHTML = unavailableHtml(services.t('common.unavailable'), result.reason)
      return
    }
    const conflicts = await safeCall(() => bridge.git!('conflicts', {}))
    const conflicted = conflicts.ok
      && (Array.isArray(record(conflicts.value).files) ? (record(conflicts.value).files as string[]) : []).includes(path)
    const actions = conflicted
      ? `<div class="lrow"><span class="lname">${escapeHtml(services.t('changes.resolve'))}</span>
          <button data-act="resolve" data-side="ours" data-value="${escapeHtml(path)}" data-t="changes.ours"></button>
          <button data-act="resolve" data-side="theirs" data-value="${escapeHtml(path)}" data-t="changes.theirs"></button></div>`
      : ''
    diffEl.innerHTML = `<div class="lrow"><span class="lname">${escapeHtml(path)}</span></div>${actions}${renderDiffHtml(String(record(result.value).diff ?? ''))}`
  }

  host.addEventListener('click', event => {
    const target = event.target as HTMLElement
    const button = target.closest<HTMLButtonElement>('button[data-act]')
    if (button !== null) {
      const action = button.dataset.act ?? ''
      if (action === 'refresh') { void load(); return }
      if (action === 'resolve') {
        const bridge = gitBridge()
        const path = button.dataset.value ?? ''
        const side = button.dataset.side === 'theirs' ? 'theirs' : 'ours'
        if (bridge?.git === undefined) return
        if (!armConfirm(button, {
          idle: services.t(side === 'theirs' ? 'changes.theirs' : 'changes.ours'),
          armed: services.t('common.confirm'),
        })) return
        void safeCall(() => bridge.git!('resolve', { path, side })).then(result => {
          services.notice(result.ok ? services.t('changes.resolved') : result.reason)
          void load()
        })
        return
      }
    }
    const row = target.closest<HTMLElement>('.chrow')
    if (row !== null) {
      const path = row.dataset.path ?? ''
      void showDiff(path).then(() => void load())
    }
  })
  return { refresh: load }
}
