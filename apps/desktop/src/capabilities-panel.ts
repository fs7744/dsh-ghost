/**
 * 宿主能力台账（桌面端）。
 *
 * 目的：把「宿主有什么、我们接了多少、剩下的能不能开」摆在台面上，
 * 而不是让用户去猜。分成两类：
 *  - **能点一下就用的**：Agent 预设（已接）、MCP 服务（已接）、网页抓取/搜索（宿主默认开）；
 *  - **能开关但要重启宿主的**：电脑操控（CU）、定时任务、持久目标（白名单插件）。
 */
import {
  asList, escapeHtml, pickStr, record, safeCall, unavailableHtml,
  type PanelInstance, type PanelServices,
} from './panels.ts'

/** 能力台账的一行。 */
export interface CapabilityRow {
  id: string
  /** 能力名。 */
  label: string
  /** 状态：已接 / 宿主默认 / 可开启 / 未接。 */
  state: 'wired' | 'host-default' | 'toggleable' | 'not-wired'
  /** 一句话说明。 */
  note: string
}

/**
 * 台账（静态部分）。状态是**我们与宿主的能力台账**，不是营销词。
 * 逐条对应宿主的真实能力与端点。
 */
export const CAPABILITY_LEDGER: readonly CapabilityRow[] = [
  { id: 'agent-preset', label: 'Agent 预设', state: 'wired', note: '切换会话的人设与工具组合（standard / ptc / minimal / cordis）。' },
  { id: 'mcp', label: 'MCP 服务', state: 'wired', note: '设置页可查看、探测、重启 MCP 连接。' },
  { id: 'web', label: '网页抓取与搜索', state: 'host-default', note: '宿主默认开启：web_fetch / web_search 已在模型工具表里。' },
  { id: 'memory', label: '记忆', state: 'wired', note: 'ghostMemory/*：写盘前会拒明文密钥。' },
  { id: 'tickets', label: '票据编排', state: 'wired', note: 'ghostTickets/* 与 19 个编排工具。' },
  { id: 'ui-extensions', label: '用户扩展', state: 'wired', note: '放 JSON 就能加页面 / 注入界面 / 登记 LLM 服务。' },
  { id: 'cua', label: '电脑操控（Computer Use）', state: 'toggleable', note: '宿主有 dsh-cua / dsh-cua-bundle，但官方 CUA 面向 macOS，且默认未装载。' },
  { id: 'browser', label: '浏览器操控', state: 'not-wired', note: '宿主没有浏览器自动化包（只有抓取与搜索）；真要点击/填表得另接驱动。' },
  { id: 'schedule', label: '定时任务', state: 'toggleable', note: '宿主 schedule/*：模型侧已有 schedule_* 工具，界面未接入。' },
  { id: 'goal', label: '持久目标', state: 'toggleable', note: '宿主 goals/*：跨会话目标，界面目前只有模型侧工具。' },
  { id: 'speech', label: '语音', state: 'not-wired', note: '宿主 speech/*（转写与合成），我们没接。' },
  { id: 'credentials', label: '宿主凭据仓', state: 'not-wired', note: '宿主 credentials/*；我们用自己的系统钥匙串（DPAPI / Keychain）。' },
  { id: 'settings-edit', label: '直接改宿主设置', state: 'not-wired', note: '宿主 settings/mutate|update 可写；我们目前只读（settings/describe）。' },
]

export interface AgentPreset {
  id: string
  isDefault: boolean
  order: number
}

/** 归一化 agent 预设列表。 */
export function normalizePresets(raw: unknown): AgentPreset[] {
  const out: AgentPreset[] = []
  for (const value of asList(record(raw).presets)) {
    const item = record(value)
    const id = pickStr(item, ['id', 'name'])
    if (id === '') continue
    out.push({ id, isDefault: item.isDefault === true, order: typeof item.order === 'number' ? item.order : 0 })
  }
  return out.sort((left, right) => left.order - right.order)
}

/** 归一化电脑操控状态；宿主没装载时返回 undefined（= 不可用）。 */
export function normalizeCuaStatus(raw: unknown): { supported: boolean; detail: string } | undefined {
  if (raw === undefined || raw === null) return undefined
  const item = record(raw)
  const supported = item.supported === true || item.available === true || item.enabled === true
  return { supported, detail: pickStr(item, ['detail', 'reason', 'status']) }
}

/**
 * 宿主能力面板：Agent 预设 + 电脑操控状态 + 宿主插件开关 + 静态台账。
 */
export function mountCapabilitiesPanel(host: HTMLElement, services: PanelServices): PanelInstance {
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
    titleEl.textContent = services.t('tab.capabilities')
    const agentId = services.agentId() ?? ''

    // 1) Agent 预设（已接）
    const presetsResult = await safeCall(() => services.transport.call('agentPresets/list' as never, {} as never))
    const presets = presetsResult.ok ? normalizePresets(presetsResult.value) : []
    const presetBlock = presets.length === 0
      ? `<div class="empty">${escapeHtml(presetsResult.ok ? services.t('common.empty') : presetsResult.reason)}</div>`
      : presets.map(preset => `<div class="lrow">
          <span class="lname">${escapeHtml(preset.id)}</span>
          ${preset.isDefault ? `<span class="lstate idle">${escapeHtml(services.t('capabilities.default'))}</span>` : ''}
          <button data-act="select-preset" data-value="${escapeHtml(preset.id)}" data-t="capabilities.use"></button>
        </div>`).join('')

    // 2) 电脑操控状态
    const cuaResult = await safeCall(() => services.transport.call('cuaAccess/systemStatus' as never, {} as never))
    const cua = cuaResult.ok ? normalizeCuaStatus(cuaResult.value) : undefined
    const cuaBlock = cua === undefined
      ? `<div class="lrow"><span class="lname">${escapeHtml(services.t('capabilities.computerUse'))}</span>
          <span class="ldetail">${escapeHtml(services.t('capabilities.cua.unavailable'))}</span>
          <button data-act="toggle-host-plugin" data-value="cua" data-t="capabilities.enable"></button></div>`
      : `<div class="lrow"><span class="lname">${escapeHtml(services.t('capabilities.computerUse'))}</span>
          <span class="ldetail">${escapeHtml(cua.supported ? cua.detail || services.t('capabilities.cua.ready') : services.t('capabilities.cua.unavailable'))}</span></div>`

    // 3) 宿主插件开关（白名单）
    const pluginsResult = await safeCall(() => services.transport.call('ghostUI/hostPlugins' as never, {} as never))
    const pluginBlock = pluginsResult.ok
      ? asList(record(pluginsResult.value).allowlist).map(item => {
        const plugin = record(item)
        const id = pickStr(plugin, ['id'])
        const enabled = asList(record(pluginsResult.value).ids).some(value => value === id)
        return `<div class="lrow">
            <span class="lname">${escapeHtml(pickStr(plugin, ['label']))}</span>
            <span class="ldetail">${escapeHtml(pickStr(plugin, ['note']))}</span>
            <button data-act="toggle-host-plugin" data-value="${escapeHtml(id)}" data-enabled="${enabled}"
              ${enabled ? 'disabled' : ''} data-t="${enabled ? 'capabilities.on' : 'capabilities.enable'}"></button>
          </div>`
      }).join('')
      : `<div class="empty">${escapeHtml(pluginsResult.reason)}</div>`

    // 4) 自动化（浏览器 / Windows 电脑操控）
    const automationResult = await safeCall(() => services.transport.call('ghostAutomation/status' as never, {} as never))
    const automation = automationResult.ok ? record(automationResult.value) : {}
    const browserInfo = record(automation.browser)
    const computerInfo = record(automation.computer)
    const automationBlock = automationResult.ok
      ? `<div class="lrow"><span class="lname">${escapeHtml(services.t('capabilities.browserAutomation'))}</span>
          <span class="ldetail">${escapeHtml(browserInfo.available === true
            ? `${services.t('capabilities.available')}（${String(browserInfo.name ?? '')}）`
            : services.t('capabilities.noBrowser'))}</span>
          <button data-act="toggle-automation" data-value="browser" data-enabled="${browserInfo.enabled === true}"
            ${browserInfo.enabled === true ? 'disabled' : ''} data-t="${browserInfo.enabled === true ? 'capabilities.on' : 'capabilities.enable'}"></button></div>`
        + `<div class="lrow"><span class="lname">${escapeHtml(services.t('capabilities.computerControl'))}</span>
          <span class="ldetail">${escapeHtml(computerInfo.available === true
            ? services.t('capabilities.available')
            : services.t('capabilities.notWindows'))}</span>
          <button data-act="toggle-automation" data-value="computer" data-enabled="${computerInfo.enabled === true}"
            ${computerInfo.enabled === true ? 'disabled' : ''} data-t="${computerInfo.enabled === true ? 'capabilities.on' : 'capabilities.enable'}"></button></div>`
      : `<div class="empty">${escapeHtml(automationResult.reason)}</div>`

    // 5) 静态台账
    const ledger = CAPABILITY_LEDGER.map(row => `<div class="lrow">
        <span class="lname">${escapeHtml(row.label)}</span>
        <span class="lstate ${row.state}">${escapeHtml(services.t(`capabilities.state.${row.state}`))}</span>
        <span class="ldetail">${escapeHtml(row.note)}</span>
      </div>`).join('')

    body.innerHTML = `<section><h3 data-t="capabilities.presets"></h3>${presetBlock}</section>`
      + `<section><h3 data-t="capabilities.automation"></h3>${automationBlock}</section>`
      + `<section><h3 data-t="capabilities.computerUse"></h3>${cuaBlock}</section>`
      + `<section><h3 data-t="capabilities.hostPlugins"></h3>${pluginBlock}</section>`
      + `<section><h3 data-t="capabilities.ledger"></h3>${ledger}</section>`
    statusEl.textContent = services.t('common.refresh')
  }

  host.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]')
    if (button === null) return
    const action = button.dataset.act ?? ''
    if (action === 'refresh') { void load(); return }
    if (action === 'select-preset') {
      const preset = button.dataset.value ?? ''
      const agentId = services.agentId() ?? ''
      void safeCall(() => services.transport.call('agentPresets/select' as never, { agentId, agentPreset: preset } as never))
        .then(result => {
          services.notice(result.ok ? services.t('capabilities.selected') : result.reason)
          void load()
        })
      return
    }
    if (action === 'toggle-automation') {
      const which = button.dataset.value === 'computer' ? 'computer' : 'browser'
      const enabled = button.dataset.enabled !== 'true'
      void safeCall(() => services.transport.call('ghostAutomation/setEnabled' as never, {
        input: { [which]: enabled },
      } as never)).then(result => {
        services.notice(result.ok ? services.t('capabilities.automationToggled') : result.reason)
        void load()
      })
      return
    }
    if (action === 'toggle-host-plugin') {
      const id = button.dataset.value ?? ''
      const enabled = button.dataset.enabled === 'true'
      void safeCall(() => services.transport.call('ghostUI/hostPlugins' as never, {} as never)).then(async current => {
        if (!current.ok) {
          services.notice(current.reason)
          return
        }
        const ids = asList(record(current.value).ids).filter(value => value !== id)
        if (!enabled) ids.push(id)
        const saved = await safeCall(() => services.transport.call('ghostUI/hostPluginsSave' as never, {
          input: { ids },
        } as never))
        if (!saved.ok) {
          services.notice(saved.reason)
          return
        }
        services.notice(services.t('capabilities.needsRestart'))
        void load()
      })
    }
  })
  return { refresh: load }
}
