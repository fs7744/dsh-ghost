/**
 * 管理面板：设置 / 插件管理与市场 / MCP / 模型信息（C8-16 / C8-17）。
 *
 * 每个分区独立 load 一个 Remote 端点，失败只在该分区降级，不影响其它分区。
 * 纯逻辑：归一化、权限开关（enabled / 内置不可切换）、排序、启用数统计。
 */
import {
  asList, bool, escapeHtml, num, paintText, pickStr, record, safeCall, unavailableHtml,
  type PanelInstance, type PanelServices,
} from './panels.ts'

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

/** C8-16 设置页：模型信息 / MCP / 用户设置三分区。 */
export function mountSettingsPanel(host: HTMLElement, services: PanelServices): PanelInstance {
  host.innerHTML = `<div class="panelbar">
      <strong data-t="tab.settings"></strong>
      <button data-act="refresh" data-t="common.refresh"></button>
      <span class="panelspacer"></span><span class="panelstatus"></span>
    </div>
    <div class="adminbody">
      <section><h3 data-t="admin.providers"></h3><div data-sec="providers"></div></section>
      <section><h3 data-t="admin.mcp"></h3><div data-sec="mcp"></div></section>
      <section><h3 data-t="admin.settings"></h3><div data-sec="settings"></div></section>
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
              <span class="ldetail">${row.tools} tools</span></div>`).join('')
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
    statusEl.textContent = `${okCount} / ${jobs.length}`
  }
  host.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-act="refresh"]')
    if (button !== null) void load()
  })
  return { refresh: load }
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
          <button data-act="search" data-t="common.preview"></button></div>
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
    if (marketBox !== null) marketBox.innerHTML = `<div class="empty">${escapeHtml(services.t('common.empty'))}</div>`
    statusEl.textContent = services.t('common.refresh')
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
        services.notice(result.ok ? services.t('common.refresh') : result.reason)
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
        const rows = normalizeMarket(found.value)
        marketBox.innerHTML = rows.length === 0
          ? `<div class="empty">${escapeHtml(services.t('common.empty'))}</div>`
          : rows.map(row => `<div class="lrow"><span class="lname">${escapeHtml(row.name)}</span>
              <span class="ldetail">${escapeHtml(row.description)}</span>
              <button data-act="install" data-value="${escapeHtml(row.url || row.name)}" data-t="admin.install"></button></div>`).join('')
        paintText(host, services)
      })()
      return
    }
    if (action === 'install') {
      const spec = button.dataset.value ?? ''
      void safeCall(() => services.transport.call('pluginManager/installBundle' as never, {
        spec, options: {},
      } as never)).then(result => {
        services.notice(result.ok ? services.t('runtime.done') : result.reason)
        void load()
      })
    }
  })
  return { refresh: load }
}
