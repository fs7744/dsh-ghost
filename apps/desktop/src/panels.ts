/**
 * 统一面板注册表与标签页装配（C8 剩余项的公共骨架）。
 *
 * 约定：每个面板 load() 从 Remote 读 -> 纯函数归一化 -> render() -> 用户动作再调 Remote。
 * 端点不存在或抛错时统一渲染「该能力未启用」，绝不抛未捕获异常、绝不白屏。
 * 纯逻辑（asList / str / num / bool / record / sortPanelDefs / describeError 等）零 DOM，
 * 可在 Node 里单测；DOM 只出现在 mountPanels 与下面的辅助函数里。
 *
 * 登记脚本：test:panels / verify:panels（集成时加入根 package.json）。
 */
import type { RemoteTransport } from '@dsh-ghost/harness-port'

/** 面板与宿主之间的依赖。t 绑定到当前 locale，切换语言后自动返回新文案。 */
export interface PanelServices {
  transport: RemoteTransport
  /** 当前会话 / agent id；无会话时返回 undefined。 */
  agentId: () => string | undefined
  notice: (text: string) => void
  t: (key: string) => string
}

/** 每个挂载后的面板至少提供 refresh（切换到该标签或切换语言时触发）。 */
export interface PanelInstance {
  refresh: () => Promise<void>
}

/** 一条动态面板定义。 */
export interface PanelDef {
  id: string
  labelKey: string
  /** 字面标题（用户扩展用；有值时优先于 labelKey）。 */
  label?: string
  order: number
  mount: (host: HTMLElement, services: PanelServices) => PanelInstance
}

/** 静态面板（容器已在 HTML 里，如 chat / flow / memory）。 */
export interface StaticPane {
  id: string
  labelKey: string
  order: number
}

/** 从任意 Remote 响应里挖出数组，兼容常见容器字段或裸数组。 */
export function asList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  if (raw === null || typeof raw !== 'object') return []
  const value = raw as Record<string, unknown>
  for (const key of ['items', 'entries', 'list', 'values', 'results', 'data', 'records', 'value', 'tickets', 'bundles', 'plugins', 'providers', 'skills', 'jobs', 'terminals', 'goals']) {
    const candidate = value[key]
    if (Array.isArray(candidate)) return candidate
  }
  return []
}

/** 安全取字符串。 */
export function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 安全取有限数字，缺失或非数返回 0。 */
export function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** 安全取布尔。 */
export function bool(value: unknown): boolean {
  return value === true
}

/** 对象守卫：非对象一律返回空对象。 */
export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/** HTML 转义，所有外部文本进 DOM 前都要过这一层。 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] as string))
}

/** 把异常压成一小段可读文本。 */
export function describeError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.slice(0, 160)
}

/** 面板按 order 排序，order 相同按 id。 */
export function sortPanelDefs<T extends { id: string; order: number }>(defs: readonly T[]): T[] {
  return [...defs].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
}

/** 把带 data-t 的元素文字按当前 locale 重刷（i18n 切换即时生效）。 */
export function paintText(root: HTMLElement, services: { t: (key: string) => string }): void {
  root.querySelectorAll<HTMLElement>('[data-t]').forEach(node => {
    const key = node.dataset.t
    if (key !== undefined) node.textContent = services.t(key)
  })
}

/** 统一的「能力未启用」视图。 */
export function unavailableHtml(label: string, detail = ''): string {
  return `<div class="empty panel-unavailable"><div class="pu-title">${escapeHtml(label)}</div>`
    + (detail === '' ? '' : `<div class="pu-detail">${escapeHtml(detail)}</div>`)
    + '</div>'
}

/** 包一层 Remote 调用：失败返回 ok:false，永不向外抛。 */
export async function safeCall(
  call: () => Promise<unknown>,
): Promise<{ ok: true; value: unknown } | { ok: false; reason: string }> {
  try {
    return { ok: true, value: await call() }
  } catch (error) {
    return { ok: false, reason: describeError(error) }
  }
}

/** 从一个对象里按候选键取第一个字符串字段。 */
export function pickStr(value: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const text = str(value[key])
    if (text !== '') return text
  }
  return ''
}

interface Entry {
  id: string
  labelKey: string
  label?: string
  order: number
  paneId: string
  mount: ((host: HTMLElement, services: PanelServices) => PanelInstance) | undefined
}

export interface MountPanelsOptions {
  tabs: HTMLElement
  main: HTMLElement
  staticPanes: readonly StaticPane[]
  defs: readonly PanelDef[]
  services: PanelServices
  /** 切换到某标签后的额外回调（main.ts 用来刷新上下文条等）。 */
  onActivate?: (id: string) => void
}

export interface MountedPanels {
  activate: (id: string) => void
  applyLocale: () => void
  current: () => string
  ids: string[]
}

/**
 * 生成全部标签按钮、创建动态面板容器、挂载面板、接管标签切换。
 * 静态面板只参与切换，不会被重新挂载（flow-editor / memory-panel 已各自 mount）。
 */
export function mountPanels(options: MountPanelsOptions): MountedPanels {
  const { tabs, main, staticPanes, defs, services, onActivate } = options
  const entries: Entry[] = sortPanelDefs<Entry>([
    ...staticPanes.map((pane): Entry => ({
      id: pane.id, labelKey: pane.labelKey, order: pane.order, paneId: pane.id, mount: undefined,
    })),
    ...defs.map((def): Entry => ({
      id: def.id, labelKey: def.labelKey, ...(def.label === undefined ? {} : { label: def.label }),
      order: def.order, paneId: `panel-${def.id}`, mount: def.mount,
    })),
  ])

  const instances = new Map<string, PanelInstance>()
  for (const entry of entries) {
    if (entry.mount === undefined) continue
    const host = document.createElement('div')
    host.id = entry.paneId
    host.className = 'pane hidden'
    main.appendChild(host)
    instances.set(entry.id, entry.mount(host, services))
  }

  const drawTabs = (): void => {
    tabs.innerHTML = entries.map(entry =>
      `<button type="button" data-panel="${escapeHtml(entry.id)}">${escapeHtml(entry.label ?? services.t(entry.labelKey))}</button>`).join('')
  }
  drawTabs()

  let currentId = entries[0]?.id ?? ''
  const activate = (id: string): void => {
    const entry = entries.find(item => item.id === id)
    if (entry === undefined) return
    currentId = id
    tabs.querySelectorAll<HTMLButtonElement>('button[data-panel]').forEach(button =>
      button.classList.toggle('on', button.dataset.panel === id))
    for (const item of entries) {
      const pane = document.getElementById(item.paneId)
      pane?.classList.toggle('hidden', item.paneId !== entry.paneId)
    }
    const instance = instances.get(id)
    if (instance !== undefined) void instance.refresh()
    onActivate?.(id)
  }

  tabs.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-panel]')
    if (button === null) return
    activate(button.dataset.panel ?? '')
  })

  const applyLocale = (): void => {
    drawTabs()
    tabs.querySelectorAll<HTMLButtonElement>('button[data-panel]').forEach(button =>
      button.classList.toggle('on', button.dataset.panel === currentId))
    const instance = instances.get(currentId)
    if (instance !== undefined) void instance.refresh()
  }

  activate(currentId)
  return { activate, applyLocale, current: () => currentId, ids: entries.map(entry => entry.id) }
}
