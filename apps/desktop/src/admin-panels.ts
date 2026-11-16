/**
 * 管理面板：设置 / 插件管理与市场 / MCP / 模型信息（C8-16 / C8-17）。
 *
 * 每个分区独立 load 一个 Remote 端点，失败只在该分区降级，不影响其它分区。
 * 纯逻辑：归一化、权限开关（enabled / 内置不可切换）、排序、启用数统计。
 */
import {
  armConfirm, asList, bool, escapeHtml, num, paintText, pickStr, record, safeCall, unavailableHtml,
  type PanelInstance, type PanelServices,
} from './panels.ts'
import { applyCustomSkin, invokeSlot, slotSection } from './extensions.ts'
import { createSchedule, renderSchedulesSection, scheduleAction } from './schedules-section.ts'
import { activePresetId, applyPreset, SKIN_PRESETS } from './themes.ts'
import { mountModelsPanel } from './models-panel.ts'
import { createModelsHost } from './models-host.ts'

export function sortByName<T extends { name: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.name.localeCompare(b.name))
}

export interface ProviderRow {
  name: string
  id: string
  models: number
}
export function normalizeProviders(raw: unknown): ProviderRow[] {
  const rows: ProviderRow[] = []
  for (const value of asList(raw)) {
    const item = record(value)
    const name = pickStr(item, ['name', 'id', 'provider', 'title'])
    if (name === '') continue
    const models = Array.isArray(item.models) ? item.models.length : num(item.modelCount)
    rows.push({ name, id: pickStr(item, ['id', 'provider']) || name, models })
  }
  return sortByName(rows)
}

export interface SettingSection {
  key: string
  label: string
  value: string
}
/** settings/describe 可能是 sections 数组、values 数组，或纯键值 map，这里都兼容。 */
export function normalizeSettings(raw: unknown): SettingSection[] {
  const root = record(raw)
  const out: SettingSection[] = []
  for (const value of asList(root.sections ?? root.values ?? root.settings ?? raw)) {
    const item = record(value)
    const key = pickStr(item, ['key', 'id', 'ns', 'name', 'path'])
    const label = pickStr(item, ['label', 'title', 'name']) || key
    const val = item.value
    const text = typeof val === 'string' ? val : (JSON.stringify(val) ?? String(val))
    if (key === '' && label === '') continue
    out.push({ key, label, value: text.slice(0, 120) })
  }
  if (out.length === 0 && !Array.isArray(raw)) {
    for (const [key, val] of Object.entries(root)) {
      if (key === 'revision' || key === 'ns') continue
      const text = typeof val === 'string' ? val : (JSON.stringify(val) ?? String(val))
      out.push({ key, label: key, value: text.slice(0, 120) })
    }
  }
  return [...out].sort((a, b) => a.key.localeCompare(b.key))
}

export interface BundleRow {
  id: string
  name: string
  enabled: boolean
  builtin: boolean
  version: string
}
/** 权限开关：未显式 enabled:false 一律视为启用；内置包标记 builtin。 */
export function normalizeBundles(raw: unknown): BundleRow[] {
  const out: BundleRow[] = []
  for (const value of asList(raw)) {
    const item = record(value)
    const name = pickStr(item, ['name', 'id', 'packageName', 'spec'])
    if (name === '') continue
    const builtin = bool(item.builtin) || bool(item.isBuiltin) || bool(item.core)
      || pickStr(item, ['source', 'origin']).toLowerCase() === 'builtin'
    out.push({
      id: name,
      name,
      enabled: item.enabled !== false,
      builtin,
      version: pickStr(item, ['version', 'installedVersion']),
    })
  }
  return sortByName(out)
}

export function canToggleBundle(row: BundleRow): boolean {
  return !row.builtin
}

export function countEnabled(rows: readonly { enabled: boolean }[]): number {
  return rows.reduce((total, row) => total + (row.enabled ? 1 : 0), 0)
}

export interface PluginRow {
  id: string
  name: string
  enabled: boolean
  version: string
}
export function normalizePlugins(raw: unknown): PluginRow[] {
  const out: PluginRow[] = []
  for (const value of asList(raw)) {
    const item = record(value)
    const id = pickStr(item, ['id', 'name', 'pluginId'])
    if (id === '') continue
    out.push({
      id,
      name: pickStr(item, ['name', 'title']) || id,
      enabled: item.enabled !== false,
      version: pickStr(item, ['version']),
    })
  }
  return sortByName(out)
}

export interface McpRow {
  name: string
  state: string
  tools: number
}
export function normalizeMcp(raw: unknown): McpRow[] {
  const out: McpRow[] = []
  for (const value of asList(raw)) {
    const item = record(value)
    const name = pickStr(item, ['name', 'id', 'server'])
    if (name === '') continue
    const state = pickStr(item, ['state', 'status', 'connection'])
      || (item.connected === false ? 'offline' : 'online')
    const tools = Array.isArray(item.tools) ? item.tools.length : num(item.toolCount)
    out.push({ name, state, tools })
  }
  return sortByName(out)
}

export interface MarketRow {
  name: string
  version: string
  description: string
  url: string
}
export function normalizeMarket(raw: unknown): MarketRow[] {
  const out: MarketRow[] = []
  for (const value of asList(raw)) {
    const item = record(value)
    const name = pickStr(item, ['name', 'title', 'packageName', 'id'])
    if (name === '') continue
    out.push({
      name,
      version: pickStr(item, ['version', 'latest']),
      description: pickStr(item, ['description', 'summary']),
      url: pickStr(item, ['url', 'index', 'homepage']),
    })
  }
  return sortByName(out)
}

interface SectionJob {
  selector: string
  endpoint: string
  args: (services: PanelServices) => Record<string, unknown>
  render: (raw: unknown, services: PanelServices) => string
}

const EMPTY_ARGS = (): Record<string, unknown> => ({})

/** 设置页分类：左侧导航，右侧只显示当前分类。参考 WorkBuddy / Claude 的设置形态。 */
const SETTINGS_CATEGORIES = [
  { id: 'general', labelKey: 'settings.cat.general' },
  { id: 'model', labelKey: 'settings.cat.model' },
  { id: 'mcp', labelKey: 'settings.cat.mcp' },
  { id: 'connection', labelKey: 'settings.cat.connection' },
  { id: 'agent', labelKey: 'settings.cat.agent' },
  { id: 'advanced', labelKey: 'settings.cat.advanced' },
] as const
type SettingsCategoryId = typeof SETTINGS_CATEGORIES[number]['id']

/** C8-16 设置页：按分类组织的设置项；模型分类内嵌可编辑的模型配置面板。 */
export function mountSettingsPanel(host: HTMLElement, services: PanelServices): PanelInstance {
  const nav = SETTINGS_CATEGORIES.map((cat, index) =>
    `<button type="button" role="tab" aria-controls="pane-${cat.id}" aria-selected="${index === 1}"
      class="setnav${index === 1 ? ' active' : ''}" data-cat="${cat.id}" data-t="${cat.labelKey}"></button>`).join('')
  host.innerHTML = `<div class="panelbar">
      <strong data-t="tab.settings"></strong>
      <button data-act="refresh" data-t="common.refresh"></button>
      <span class="panelspacer"></span><span class="panelstatus"></span>
    </div>
    <div class="settings-shell">
      <nav class="settings-nav" role="tablist" aria-label="${escapeHtml(services.t('tab.settings'))}">${nav}</nav>
      <div class="settings-panes">
        <section data-pane="general" id="pane-general" role="tabpanel" class="hidden">
          <p class="set-hint" data-t="settings.cat.general.hint"></p>
          <h3 data-t="settings.skin"></h3><div data-sec="skin"></div>
          <h3 data-t="ui.extensions"></h3><div data-sec="slots"></div>
        </section>
        <section data-pane="model" id="pane-model" role="tabpanel">
          <p class="set-hint" data-t="settings.model.hint"></p>
          <div id="models-root" class="settings-models"></div>
          <h3 data-t="admin.providers"></h3><div data-sec="providers"></div>
        </section>
        <section data-pane="mcp" id="pane-mcp" role="tabpanel" class="hidden">
          <p class="set-hint" data-t="settings.cat.mcp.hint"></p>
          <h3 data-t="admin.mcp"></h3><div data-sec="mcp"></div>
        </section>
        <section data-pane="connection" id="pane-connection" role="tabpanel" class="hidden">
          <p class="set-hint" data-t="settings.cat.connection.hint"></p>
          <h3 data-t="settings.proxy"></h3><div data-sec="proxy"></div>
          <h3 data-t="settings.extension"></h3><div data-sec="extension"></div>
        </section>
        <section data-pane="agent" id="pane-agent" role="tabpanel" class="hidden">
          <p class="set-hint" data-t="settings.cat.agent.hint"></p>
          <h3 data-t="settings.peers"></h3><div data-sec="peers"></div>
          <h3 data-t="settings.permission"></h3><div data-sec="permission"></div>
          <h3 data-t="settings.schedules"></h3><div data-sec="schedules"></div>
        </section>
        <section data-pane="advanced" id="pane-advanced" role="tabpanel" class="hidden">
          <p class="set-hint" data-t="settings.cat.advanced.hint"></p>
          <h3 data-t="admin.settings"></h3><div data-sec="settings"></div>
        </section>
      </div>
    </div>`
  const statusEl = host.querySelector<HTMLElement>('.panelstatus')!
  const jobs: SectionJob[] = [
    {
      selector: '[data-sec="providers"]', endpoint: 'llm/listProviders', args: EMPTY_ARGS,
      render: (raw, s) => {
        const rows = normalizeProviders(raw)
        return rows.length === 0 ? `<div class="empty">${escapeHtml(s.t('common.empty'))}</div>`
          : rows.map(row => `<div class="lrow"><span class="lname">${escapeHtml(row.name)}</span>
              <span class="ldetail">${row.models} models</span></div>`).join('')
      },
    },
    {
      selector: '[data-sec="mcp"]', endpoint: 'mcpManager/watch', args: EMPTY_ARGS,
      render: (raw, s) => {
        const rows = normalizeMcp(raw)
        return rows.length === 0 ? `<div class="empty">${escapeHtml(s.t('common.empty'))}</div>`
          : rows.map(row => `<div class="lrow"><span class="lname">${escapeHtml(row.name)}</span>
              <span class="lstate">${escapeHtml(row.state)}</span>
              <span class="ldetail">${row.tools} tools</span>
              <button data-act="mcp-probe" data-value="${escapeHtml(row.name)}" data-t="admin.mcp.probe"></button>
              <button data-act="mcp-restart" data-value="${escapeHtml(row.name)}" data-t="admin.mcp.restart"></button></div>`).join('')
      },
    },
    {
      selector: '[data-sec="settings"]', endpoint: 'settings/describe', args: EMPTY_ARGS,
      render: (raw, s) => {
        const rows = normalizeSettings(raw)
        return rows.length === 0 ? `<div class="empty">${escapeHtml(s.t('common.empty'))}</div>`
          : rows.map(row => `<div class="lrow"><span class="lname">${escapeHtml(row.label)}</span>
              <span class="ldetail">${escapeHtml(row.value)}</span></div>`).join('')
      },
    },
  ]
  // 模型配置面板只挂载一次：它自己管理表单状态，重复挂载会叠加事件监听。
  const modelsRoot = host.querySelector<HTMLElement>('#models-root')
  if (modelsRoot !== null) mountModelsPanel(modelsRoot, createModelsHost(undefined, text => services.notice(text)))

  const showCategory = (id: SettingsCategoryId): void => {
    for (const button of host.querySelectorAll<HTMLElement>('.setnav')) {
      const active = button.dataset.cat === id
      button.classList.toggle('active', active)
      button.setAttribute('aria-selected', String(active))
      button.tabIndex = active ? 0 : -1
    }
    for (const pane of host.querySelectorAll<HTMLElement>('.settings-panes [data-pane]')) {
      pane.classList.toggle('hidden', pane.dataset.pane !== id)
    }
  }
  // 初始化 tab 的键盘焦点顺序（默认停靠 model）。
  showCategory('model')

  const load = async (): Promise<void> => {
    paintText(host, services)
    let okCount = 0
    for (const job of jobs) {
      const box = host.querySelector<HTMLElement>(job.selector)
      if (box === null) continue
      const result = await safeCall(() => services.transport.call(job.endpoint as never, job.args(services) as never))
      if (!result.ok) {
        box.innerHTML = unavailableHtml(services.t('common.unavailable'), result.reason)
        continue
      }
      okCount += 1
      box.innerHTML = job.render(result.value, services)
    }
    // LLM 服务已并入「模型」分类的可编辑面板（models-panel.ts），旧简版表单不再渲染。
    await renderProxySection(host, services)
    await renderSkinSection(host, services)
    await renderExtensionSection(host, services)
    await renderPeersSection(host, services)
    await renderPermissionSection(host, services)
    await renderSchedulesSection(host, services)
    await renderExtensionSlots(host, services)
    statusEl.textContent = `${okCount} / ${jobs.length} · ${services.t('common.ready')}`
  }
  // WAI-ARIA tab 模式：左右方向键在同组分类间移动焦点并激活。
  host.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    const target = (event.target as HTMLElement).closest<HTMLElement>('.setnav')
    if (target === null) return
    const tabs = [...host.querySelectorAll<HTMLElement>('.setnav')]
    const index = tabs.indexOf(target)
    if (index < 0) return
    const delta = event.key === 'ArrowRight' ? 1 : -1
    const next = tabs[(index + delta + tabs.length) % tabs.length]
    if (next === undefined) return
    event.preventDefault()
    showCategory(next.dataset.cat as SettingsCategoryId)
    next.focus()
  })
  host.addEventListener('click', event => {
    const target = event.target as HTMLElement
    const nav = target.closest<HTMLElement>('.setnav')
    if (nav !== null) {
      const id = nav.dataset.cat
      if (id !== undefined) showCategory(id as SettingsCategoryId)
      return
    }
    const button = target.closest<HTMLButtonElement>('button[data-act]')
    if (button === null) return
    const action = button.dataset.act ?? ''
    if (action === 'refresh') { void load(); return }
    if (action === 'save-proxy') {
      void submitProxy(host, services)
      return
    }
    if (action === 'apply-preset') {
      const id = button.dataset.value ?? ''
      applyPreset(id)
      services.notice(services.t('settings.skin.applied'))
      void load()
      return
    }
    if (action === 'copy-preset') {
      const id = button.dataset.value ?? ''
      const preset = SKIN_PRESETS.find(item => item.id === id)
      if (preset === undefined) return
      void safeCall(() => services.transport.call('ghostUI/customCssSave' as never, {
        input: { css: preset.css },
      } as never)).then(result => {
        services.notice(result.ok ? services.t('settings.skin.copied') : result.reason)
        void load()
      })
      return
    }
    if (action === 'run-schedule') {
      void scheduleAction(host, services, button.dataset.value ?? '', 'run')
      return
    }
    if (action === 'toggle-schedule') {
      void scheduleAction(host, services, button.dataset.value ?? '', 'toggle')
      return
    }
    if (action === 'delete-schedule') {
      if (armConfirm(button, { idle: services.t('settings.schedules.delete'), armed: services.t('common.confirm.delete') })) {
        void scheduleAction(host, services, button.dataset.value ?? '', 'delete')
      }
      return
    }
    if (action === 'create-schedule') {
      void createSchedule(host, services)
      return
    }
    if (action === 'set-permission') {
      void setPermission(host, services, button.dataset.value ?? '')
      return
    }
    if (action === 'add-peer') {
      void addPeer(host, services)
      return
    }
    if (action === 'remove-peer') {
      if (armConfirm(button, { idle: services.t('settings.peers.remove'), armed: services.t('common.confirm.delete') })) {
        void removePeer(host, services, button.dataset.value ?? '')
      }
      return
    }
    if (action === 'generate-pairing') {
      void generatePairingCode(host, services)
      return
    }
    if (action === 'reload-skin') {
      void applyCustomSkin(services).then(applied => {
        services.notice(applied ? services.t('settings.skin.applied') : services.t('settings.skin.empty'))
      })
      return
    }
    const slotButton = target.closest<HTMLButtonElement>('button[data-slot-endpoint]')
    if (slotButton !== null) {
      const endpoint = slotButton.dataset.slotEndpoint ?? ''
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(decodeURIComponent(slotButton.dataset.slotArgs ?? '{}')) as Record<string, unknown>
      } catch { /* 参数坏了就按空参调 */ }
      void invokeSlot(services, endpoint, args).then(result => services.notice(result.text))
      return
    }
    // MCP 服务：探测连通性 / 重启连接。
    if (action === 'mcp-probe' || action === 'mcp-restart') {
      const name = button.dataset.value ?? ''
      const endpoint = action === 'mcp-probe' ? 'mcpManager/probe' : 'mcpManager/restart'
      void safeCall(() => services.transport.call(endpoint as never, { name } as never)).then(result => {
        services.notice(result.ok ? services.t('common.done') : result.reason)
        void load()
      })
    }
  })
  return { refresh: load }
}

/** 网络代理区：填 http/https/noProxy，交给宿主插件校验并落盘（重启宿主后生效）。 */
async function renderProxySection(host: HTMLElement, services: PanelServices): Promise<void> {
  const box = host.querySelector<HTMLElement>('[data-sec="proxy"]')
  if (box === null) return
  const result = await safeCall(() => services.transport.call('ghostUI/proxy' as never, {} as never))
  if (!result.ok) {
    box.innerHTML = unavailableHtml(services.t('common.unavailable'), result.reason)
    return
  }
  const raw = record(result.value)
  const proxy = record(raw.proxy)
  const errors = asList(raw.errors).map(item => String(item))
  box.innerHTML = `<div class="lrow">
      <input data-proxy="http" placeholder="http://proxy:port" value="${escapeHtml(String(proxy.http ?? ''))}" />
      <input data-proxy="https" placeholder="https://proxy:port" value="${escapeHtml(String(proxy.https ?? ''))}" />
      <input data-proxy="noProxy" placeholder="no_proxy（逗号分隔）" value="${escapeHtml(String(proxy.noProxy ?? ''))}" />
      <button data-act="save-proxy" data-t="settings.proxy.save"></button></div>`
    + (errors.length === 0 ? '' : `<div class="empty">${escapeHtml(errors.join('；'))}</div>`)
    + `<div class="lrow"><span class="ldetail">${escapeHtml(services.t('settings.proxy.hint'))}</span></div>`
}

/** 提交代理配置。 */
async function submitProxy(host: HTMLElement, services: PanelServices): Promise<void> {
  const read = (key: string): string => host.querySelector<HTMLInputElement>(`[data-proxy="${key}"]`)?.value.trim() ?? ''
  const saved = await safeCall(() => services.transport.call('ghostUI/proxySave' as never, {
    input: { proxy: { http: read('http'), https: read('https'), noProxy: read('noProxy') } },
  } as never))
  if (!saved.ok) {
    services.notice(saved.reason)
    return
  }
  services.notice(services.t('settings.proxy.saved'))
}

/** 自定义皮肤区：内置预设 + 自定义 CSS（放哪、覆盖了哪些变量、如何改）。 */
async function renderSkinSection(host: HTMLElement, services: PanelServices): Promise<void> {
  const box = host.querySelector<HTMLElement>('[data-sec="skin"]')
  if (box === null) return
  const result = await safeCall(() => services.transport.call('ghostUI/customCss' as never, {} as never))
  const css = result.ok ? String(record(result.value).css ?? '') : ''
  const vars = [...css.matchAll(/(--[a-z-]+)\s*:/g)].map(match => match[1] ?? '').filter(name => name !== '')
  const active = activePresetId()
  const presets = SKIN_PRESETS.map(preset => `<div class="lrow">
      <span class="lname">${escapeHtml(preset.label)}</span>
      <span class="ldetail">${escapeHtml(preset.description)}</span>
      <button data-act="apply-preset" data-value="${escapeHtml(preset.id)}"
        ${preset.id === active ? 'disabled' : ''} data-t="settings.skin.apply"></button>
      ${preset.css === '' ? '' : `<button data-act="copy-preset" data-value="${escapeHtml(preset.id)}" data-t="settings.skin.copy"></button>`}
    </div>`).join('')
  box.innerHTML = presets
    + `<div class="lrow"><span class="ldetail">${escapeHtml(services.t('settings.skin.hint'))}</span></div>`
    + (vars.length === 0 ? '' : `<div class="lrow"><span class="lname">${escapeHtml(services.t('settings.skin.vars'))}</span>
        <span class="ldetail">${escapeHtml(vars.join('、'))}</span></div>`)
    + `<div class="lrow"><button data-act="reload-skin" data-t="settings.skin.reload"></button></div>`
}

/** 权限档位区：列出宿主给的档位，标出当前生效的档位（改完要重启宿主）。 */
async function renderPermissionSection(host: HTMLElement, services: PanelServices): Promise<void> {
  const box = host.querySelector<HTMLElement>('[data-sec="permission"]')
  if (box === null) return
  const catalog = await safeCall(() => services.transport.call('permissionPresets/catalog' as never, {} as never))
  const sessionId = services.agentId() ?? ''
  const proj = await safeCall(() => services.transport.call('session/projections' as never, {
    request: { sessionId },
  } as never))
  const current = proj.ok
    ? pickStr(record(record(record(proj.value).values).permissions), ['currentValue'])
    : ''
  const options = catalog.ok ? asList(record(catalog.value).options).map(item => record(item)) : []
  if (options.length === 0) {
    box.innerHTML = `<div class="empty">${escapeHtml(catalog.ok ? services.t('common.empty') : catalog.reason)}</div>`
    return
  }
  const shell = (globalThis as unknown as {
    shellApi?: { setConfig?: (patch: Record<string, unknown>) => Promise<unknown> }
  }).shellApi
  const rows = options.map(option => {
    const value = pickStr(option, ['value'])
    const name = pickStr(option, ['name'])
    return `<div class="lrow"><span class="lname">${escapeHtml(name || value)}</span>
        ${value === current ? `<span class="lstate done">${escapeHtml(services.t('settings.permission.current'))}</span>` : ''}
        <button data-act="set-permission" data-value="${escapeHtml(value)}"
          ${value === current || shell?.setConfig === undefined ? 'disabled' : ''} data-t="settings.permission.set"></button></div>`
  }).join('')
  box.innerHTML = rows + `<div class="lrow"><span class="ldetail">${escapeHtml(services.t('settings.permission.hint'))}</span></div>`
}

/** 改权限档位（写进壳配置，下次启动宿主生效）。 */
async function setPermission(host: HTMLElement, services: PanelServices, value: string): Promise<void> {
  if (value === '') return
  const shell = (globalThis as unknown as {
    shellApi?: { setConfig?: (patch: Record<string, unknown>) => Promise<unknown> }
  }).shellApi
  if (shell?.setConfig === undefined) {
    services.notice(services.t('settings.extension.needShell'))
    return
  }
  await shell.setConfig({ approvalPreset: value })
  services.notice(services.t('settings.permission.saved'))
  void renderPermissionSection(host, services)
}

/** 外部 agent（同事）区：列出已登记的 peer，并提供登记/删除。 */
async function renderPeersSection(host: HTMLElement, services: PanelServices): Promise<void> {
  const box = host.querySelector<HTMLElement>('[data-sec="peers"]')
  if (box === null) return
  const result = await safeCall(() => services.transport.call('ghostPeers/list' as never, {} as never))
  if (!result.ok) {
    box.innerHTML = unavailableHtml(services.t('common.unavailable'), result.reason)
    return
  }
  const peers = asList(record(result.value).peers).map(item => record(item))
  const errors = asList(record(result.value).errors).map(item => String(item))
  const rows = peers.map(peer => `<div class="lrow">
      <span class="lname">${escapeHtml(pickStr(peer, ['label']))}</span>
      <span class="lstate">${escapeHtml(pickStr(peer, ['kind']))}</span>
      <span class="ldetail">${escapeHtml(`${pickStr(peer, ['id'])} · ${pickStr(peer, ['description'])}`)}</span>
      <button data-act="remove-peer" data-value="${escapeHtml(pickStr(peer, ['id']))}" data-t="settings.peers.remove"></button>
    </div>`).join('')
  box.innerHTML = (rows === '' ? `<div class="empty">${escapeHtml(services.t('settings.peers.empty'))}</div>` : rows)
    + (errors.length === 0 ? '' : `<div class="empty">${escapeHtml(errors.join('；'))}</div>`)
    + `<div class="lrow">
        <input data-peer="id" placeholder="id（kebab-case）" />
        <input data-peer="label" placeholder="显示名" />
        <select data-peer="kind">
          <option value="cli">cli（命令行程序）</option>
          <option value="http">http（JSON 服务）</option>
          <option value="a2a">a2a（Agent2Agent）</option>
        </select>
        <input data-peer="target" placeholder="command（cli）或 URL（http/a2a）" />
        <input data-peer="args" placeholder="args（JSON 数组，可选）" />
        <input data-peer="description" placeholder="擅长什么（一句话）" />
        <button data-act="add-peer" data-t="settings.peers.add"></button></div>`
    + `<div class="lrow"><span class="ldetail">${escapeHtml(services.t('settings.peers.hint'))}</span></div>`
}

/** 登记一个 peer。 */
async function addPeer(host: HTMLElement, services: PanelServices): Promise<void> {
  const read = (key: string): string => host.querySelector<HTMLInputElement>(`[data-peer="${key}"]`)?.value.trim() ?? ''
  const id = read('id')
  const label = read('label')
  const kind = read('kind')
  const target = read('target')
  if (id === '' || label === '' || target === '') {
    services.notice(services.t('settings.peers.incomplete'))
    return
  }
  let args: string[] = []
  const rawArgs = read('args')
  if (rawArgs !== '') {
    try {
      const parsed = JSON.parse(rawArgs) as unknown
      if (!Array.isArray(parsed)) throw new Error('not array')
      args = parsed.map(item => String(item))
    } catch {
      services.notice(services.t('settings.peers.badArgs'))
      return
    }
  }
  const peer: Record<string, unknown> = { id, label, kind }
  if (kind === 'cli') {
    peer['command'] = target
    if (args.length > 0) peer['args'] = args
  } else {
    peer['url'] = target
  }
  const description = read('description')
  if (description !== '') peer['description'] = description
  const current = await safeCall(() => services.transport.call('ghostPeers/list' as never, {} as never))
  const peers = current.ok ? asList(record(current.value).peers).map(item => record(item)) : []
  peers.push(peer)
  const saved = await safeCall(() => services.transport.call('ghostPeers/save' as never, { input: { peers } } as never))
  if (!saved.ok) {
    services.notice(saved.reason)
    return
  }
  services.notice(services.t('settings.peers.added'))
  void renderPeersSection(host, services)
}

/** 删除一个 peer。 */
async function removePeer(host: HTMLElement, services: PanelServices, id: string): Promise<void> {
  if (id === '') return
  const current = await safeCall(() => services.transport.call('ghostPeers/list' as never, {} as never))
  const peers = current.ok
    ? asList(record(current.value).peers).map(item => record(item)).filter(item => pickStr(item, ['id']) !== id)
    : []
  const saved = await safeCall(() => services.transport.call('ghostPeers/save' as never, { input: { peers } } as never))
  services.notice(saved.ok ? services.t('settings.peers.removed') : saved.reason)
  void renderPeersSection(host, services)
}

/** 浏览器扩展区：给出应用地址与一次性配对码。 */
async function renderExtensionSection(host: HTMLElement, services: PanelServices): Promise<void> {
  const box = host.querySelector<HTMLElement>('[data-sec="extension"]')
  if (box === null) return
  const shell = (globalThis as unknown as {
    shellApi?: { extensionPairing?: () => Promise<{ ok?: boolean; code?: string; error?: string }> }
  }).shellApi
  const origin = globalThis.location?.origin ?? ''
  if (shell?.extensionPairing === undefined) {
    box.innerHTML = `<div class="empty">${escapeHtml(services.t('settings.extension.needShell'))}</div>`
    return
  }
  box.innerHTML = `<div class="lrow"><span class="lname">${escapeHtml(services.t('settings.extension.address'))}</span>
      <span class="ldetail">${escapeHtml(origin)}</span></div>`
    + `<div class="lrow"><span class="lname">${escapeHtml(services.t('settings.extension.code'))}</span>
      <span class="ldetail" data-role="pairing-code">—</span>
      <button data-act="generate-pairing" data-t="settings.extension.generate"></button></div>`
    + `<div class="lrow"><span class="ldetail">${escapeHtml(services.t('settings.extension.hint'))}</span></div>`
}

/** 生成一次性配对码并显示。 */
async function generatePairingCode(host: HTMLElement, services: PanelServices): Promise<void> {
  const shell = (globalThis as unknown as {
    shellApi?: { extensionPairing?: () => Promise<{ ok?: boolean; code?: string; error?: string }> }
  }).shellApi
  if (shell?.extensionPairing === undefined) {
    services.notice(services.t('settings.extension.needShell'))
    return
  }
  const result = await shell.extensionPairing()
  const target = host.querySelector<HTMLElement>('[data-role="pairing-code"]')
  if (!result?.ok || result.code === undefined) {
    if (target !== null) target.textContent = '—'
    services.notice(result?.error ?? services.t('common.unavailable'))
    return
  }
  if (target !== null) target.textContent = result.code
  services.notice(services.t('settings.extension.generated'))
}

/** 扩展插槽区：把 settings.sections 插槽渲染到设置页。 */
async function renderExtensionSlots(host: HTMLElement, services: PanelServices): Promise<void> {
  const box = host.querySelector<HTMLElement>('[data-sec="slots"]')
  if (box === null) return
  const result = await safeCall(() => services.transport.call('ghostUI/slots' as never, {} as never))
  if (!result.ok) {
    box.innerHTML = `<div class="empty">${escapeHtml(services.t('common.empty'))}</div>`
    return
  }
  const slots = asList(record(result.value).slots).map(item => record(item))
  const html = slotSection(slots as never, 'settings.sections')
  box.innerHTML = html === ''
    ? `<div class="empty">${escapeHtml(services.t('common.empty'))}<div class="empty-hint">${escapeHtml(services.t('common.firstHint'))}</div></div>`
    : html
}

/** C8-17 插件管理与市场：bundles / plugins / 市场三分区，带启用开关与安装动作。 */
export function mountPluginsPanel(host: HTMLElement, services: PanelServices): PanelInstance {
  host.innerHTML = `<div class="panelbar">
      <strong data-t="tab.plugins"></strong>
      <button data-act="refresh" data-t="common.refresh"></button>
      <span class="panelspacer"></span><span class="panelstatus"></span>
    </div>
    <div class="adminbody">
      <section><h3 data-t="admin.bundles"></h3><div data-sec="bundles"></div></section>
      <section><h3 data-t="admin.plugins"></h3><div data-sec="plugins"></div></section>
      <section><h3 data-t="admin.market"></h3>
        <div class="marketbar"><input data-role="query" placeholder="搜索插件市场" />
          <button data-act="search" data-t="common.search"></button></div>
        <div class="marketbar"><input data-role="index" placeholder="市场索引 URL" />
          <button data-act="add-index" data-t="admin.market.addIndex"></button></div>
        <div data-sec="market"></div></section>
    </div>`
  const statusEl = host.querySelector<HTMLElement>('.panelstatus')!

  const renderBundles = (raw: unknown, s: PanelServices): string => {
    const rows = normalizeBundles(raw)
    if (rows.length === 0) return `<div class="empty">${escapeHtml(s.t('common.empty'))}</div>`
    return rows.map(row => `<div class="lrow">
      <span class="lname">${escapeHtml(row.name)}</span>
      <span class="lstate ${row.enabled ? 'done' : 'idle'}">${escapeHtml(s.t(row.enabled ? 'common.enabled' : 'common.disabled'))}</span>
      <button data-act="toggle-bundle" data-value="${escapeHtml(row.id)}" data-enabled="${row.enabled}" ${canToggleBundle(row) ? '' : 'disabled'} data-t="admin.toggle"></button>
    </div>`).join('')
  }
  const renderMarket = (raw: unknown, s: PanelServices): string => {
    const rows = normalizeMarket(raw)
    return rows.length === 0 ? `<div class="empty">${escapeHtml(s.t('common.empty'))}</div>`
      : rows.map(row => `<div class="lrow"><span class="lname">${escapeHtml(row.name)}</span>
          <span class="ldetail">${escapeHtml(row.description)}</span>
          <button data-act="install" data-value="${escapeHtml(row.url || row.name)}" data-t="admin.install"></button></div>`).join('')
  }
  const renderPlugins = (raw: unknown, s: PanelServices): string => {
    const rows = normalizePlugins(raw)
    return rows.length === 0 ? `<div class="empty">${escapeHtml(s.t('common.empty'))}</div>`
      : rows.map(row => `<div class="lrow"><span class="lname">${escapeHtml(row.name)}</span>
          <span class="lstate ${row.enabled ? 'done' : 'idle'}">${escapeHtml(s.t(row.enabled ? 'common.enabled' : 'common.disabled'))}</span></div>`).join('')
  }

  const load = async (): Promise<void> => {
    paintText(host, services)
    const bundleResult = await safeCall(() => services.transport.call('pluginManager/listBundles' as never, {} as never))
    const bundleBox = host.querySelector<HTMLElement>('[data-sec="bundles"]')
    if (bundleBox !== null) {
      bundleBox.innerHTML = bundleResult.ok
        ? renderBundles(bundleResult.value, services)
        : unavailableHtml(services.t('common.unavailable'), bundleResult.reason)
    }
    const pluginResult = await safeCall(() => services.transport.call('pluginManager/listPlugins' as never, {} as never))
    const pluginBox = host.querySelector<HTMLElement>('[data-sec="plugins"]')
    if (pluginBox !== null) {
      pluginBox.innerHTML = pluginResult.ok
        ? renderPlugins(pluginResult.value, services)
        : unavailableHtml(services.t('common.unavailable'), pluginResult.reason)
    }
    const marketBox = host.querySelector<HTMLElement>('[data-sec="market"]')
    if (marketBox !== null) {
      // 市场索引可能没配（宿主默认不带），没索引就明说，别显示空白。
      const indexes = await safeCall(() => services.transport.call('pluginMarket/listIndexes' as never, {} as never))
      const url = indexes.ok ? pickStr(record(indexes.value), ['current', 'default'])
        || (asList(indexes.value).map(item => pickStr(record(item), ['url'])).find(text => text !== '') ?? '') : ''
      const indexInput = host.querySelector<HTMLInputElement>('input[data-role="index"]')
      if (indexInput !== null && indexInput.value.trim() === '' && url !== '') indexInput.value = url
      if (url === '') {
        marketBox.innerHTML = `<div class="empty">${escapeHtml(services.t('admin.market.noIndex'))}</div>`
      } else {
        const found = await safeCall(() => services.transport.call('pluginMarket/search' as never, { url, query: '' } as never))
        marketBox.innerHTML = !found.ok
          ? unavailableHtml(services.t('common.unavailable'), found.reason)
          : renderMarket(found.value, services)
      }
    }
    statusEl.textContent = services.t('common.ready')
    paintText(host, services)
  }

  host.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]')
    if (button === null) return
    const action = button.dataset.act ?? ''
    if (action === 'refresh') { void load(); return }
    if (action === 'toggle-bundle') {
      const name = button.dataset.value ?? ''
      const next = button.dataset.enabled !== 'true'
      void safeCall(() => services.transport.call('pluginManager/setBundleEnabled' as never, {
        name, enabled: next,
      } as never)).then(result => {
        services.notice(result.ok ? services.t('common.done') : result.reason)
        void load()
      })
      return
    }
    if (action === 'search') {
      const query = host.querySelector<HTMLInputElement>('input[data-role="query"]')?.value.trim() ?? ''
      const marketBox = host.querySelector<HTMLElement>('[data-sec="market"]')
      void (async (): Promise<void> => {
        const indexes = await safeCall(() => services.transport.call('pluginMarket/listIndexes' as never, {} as never))
        const url = indexes.ok ? pickStr(record(indexes.value), ['current', 'default'])
          || (asList(indexes.value).map(v => pickStr(record(v), ['url'])).find(text => text !== '') ?? '') : ''
        const found = await safeCall(() => services.transport.call('pluginMarket/search' as never, { url, query } as never))
        if (marketBox === null) return
        if (!found.ok) { marketBox.innerHTML = unavailableHtml(services.t('common.unavailable'), found.reason); return }
        marketBox.innerHTML = renderMarket(found.value, services)
        paintText(host, services)
      })()
      return
    }
    if (action === 'add-index') {
      const url = host.querySelector<HTMLInputElement>('input[data-role="index"]')?.value.trim() ?? ''
      if (url === '') {
        services.notice(services.t('admin.market.noIndex'))
        return
      }
      void safeCall(() => services.transport.call('pluginMarket/setIndexes' as never, { urls: [url] } as never)).then(result => {
        services.notice(result.ok ? services.t('common.done') : result.reason)
        void load()
      })
      return
    }
    if (action === 'install') {
      const spec = button.dataset.value ?? ''
      void safeCall(() => services.transport.call('pluginManager/installBundle' as never, {
        spec, options: {},
      } as never)).then(result => {
        services.notice(result.ok ? services.t('common.done') : result.reason)
        void load()
      })
    }
  })
  return { refresh: load }
}
