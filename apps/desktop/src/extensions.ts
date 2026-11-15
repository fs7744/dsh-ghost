/**
 * 用户扩展在桌面端的落地（纯逻辑 + 薄 DOM）。
 *
 * 「配置插件」怎么变成界面：
 *  - **面板** → 变成一个额外页签，数据来自插件声明的宿主端点；
 *  - **插槽** → 变成聊天工具栏按钮、设置页分区、统计页附加行。
 *
 * 扩展只能声明端点，不能塞代码进来跑（见 `@dsh-ghost/ui-extensions` 的边界说明）。
 */
import { normalizePanels, normalizeSlots, panelRows, type PanelManifest, type SlotContribution } from '@dsh-ghost/ui-extensions'
import { escapeHtml, record, safeCall, type PanelInstance, type PanelServices } from './panels.ts'

export interface ExtensionSnapshot {
  /** 可用面板。 */
  panels: PanelManifest[]
  /** 可用插槽贡献。 */
  slots: SlotContribution[]
  /** 装载失败/清单非法的原因（给界面提示用）。 */
  errors: string[]
}

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

/**
 * 从宿主拉扩展清单。宿主没装 ghost-ui 插件时静默返回空（不是错误）。
 */
export async function loadExtensions(services: PanelServices): Promise<ExtensionSnapshot> {
  const panelsResult = await safeCall(() => services.transport.call('ghostUI/panels' as never, {} as never))
  const slotsResult = await safeCall(() => services.transport.call('ghostUI/slots' as never, {} as never))
  const errors: string[] = []
  const panels: PanelManifest[] = []
  const slots: SlotContribution[] = []
  if (panelsResult.ok) {
    const raw = record(panelsResult.value)
    const normalized = normalizePanels(asArray(raw.panels))
    panels.push(...normalized.items)
    for (const item of normalized.errors) errors.push(`面板 ${item.id}：${item.errors.join('；')}`)
  }
  if (slotsResult.ok) {
    const raw = record(slotsResult.value)
    const normalized = normalizeSlots(asArray(raw.slots))
    slots.push(...normalized.items)
    for (const item of normalized.errors) errors.push(`插槽 ${item.id}：${item.errors.join('；')}`)
  }
  return { panels, slots, errors }
}

/** 插槽里某个槽位的条目。 */
export function slotsFor(slots: readonly SlotContribution[], slot: string): SlotContribution[] {
  return slots.filter(item => item.slot === slot)
}

/** 插槽按钮的 HTML（无端点的条目只展示不触发）。 */
export function slotButtons(slots: readonly SlotContribution[], slot: string): string {
  return slotsFor(slots, slot).map(item => {
    if (item.endpoint === undefined) {
      return `<span class="ldetail" title="${escapeHtml(item.description ?? '')}">${escapeHtml(item.label)}</span>`
    }
    const args = encodeURIComponent(JSON.stringify(item.args ?? {}))
    return `<button type="button" data-slot-endpoint="${escapeHtml(item.endpoint)}" data-slot-args="${escapeHtml(args)}"
      title="${escapeHtml(item.description ?? item.label)}">${escapeHtml(item.label)}</button>`
  }).join('')
}

/** 插槽分区的 HTML（设置页用）。 */
export function slotSection(slots: readonly SlotContribution[], slot: string): string {
  const items = slotsFor(slots, slot)
  if (items.length === 0) return ''
  return items.map(item => {
    const action = item.endpoint === undefined ? '' :
      `<button type="button" data-slot-endpoint="${escapeHtml(item.endpoint)}"
        data-slot-args="${escapeHtml(encodeURIComponent(JSON.stringify(item.args ?? {})))}">${escapeHtml(item.label)}</button>`
    const description = item.description === undefined ? '' : `<span class="ldetail">${escapeHtml(item.description)}</span>`
    return `<div class="lrow"><span class="lname">${escapeHtml(item.label)}</span>${description}${action}</div>`
  }).join('')
}

/** 调一个插槽端点；返回结果文本（给通知用）。 */
export async function invokeSlot(
  services: PanelServices,
  endpoint: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; text: string }> {
  const result = await safeCall(() => services.transport.call(endpoint as never, args as never))
  if (!result.ok) return { ok: false, text: result.reason }
  const value = result.value
  if (typeof value === 'string') return { ok: true, text: value }
  return { ok: true, text: JSON.stringify(value).slice(0, 400) }
}

/**
 * 通用扩展面板：标题 + 刷新 + 表格（列由清单的 columns 决定）。
 */
export function mountExtensionPanel(
  host: HTMLElement,
  services: PanelServices,
  manifest: PanelManifest,
): PanelInstance {
  host.innerHTML = `<div class="panelbar">
      <span class="paneltitle"></span>
      <button data-act="refresh" data-t="common.refresh"></button>
      <span class="panelspacer"></span><span class="panelstatus"></span>
    </div><div class="panellist"></div>`
  const listEl = host.querySelector<HTMLElement>('.panellist')!
  const titleEl = host.querySelector<HTMLElement>('.paneltitle')!
  const statusEl = host.querySelector<HTMLElement>('.panelstatus')!

  const load = async (): Promise<void> => {
    titleEl.textContent = manifest.title
    const result = await safeCall(() => services.transport.call(manifest.source.endpoint as never, (manifest.source.args ?? {}) as never))
    if (!result.ok) {
      listEl.innerHTML = `<div class="empty">${escapeHtml(result.reason)}</div>`
      statusEl.textContent = services.t('common.unavailable')
      return
    }
    const rows = panelRows(result.value, manifest.columns)
    statusEl.textContent = services.t('common.count').replace('{count}', String(rows.length))
    listEl.innerHTML = rows.length === 0
      ? `<div class="empty">${escapeHtml(services.t('common.empty'))}</div>`
      : rows.map(row => `<div class="lrow">
          <span class="lname">${escapeHtml(row.name)}</span>
          <span class="ldetail">${escapeHtml(row.detail)}</span>
          ${row.cells.map(cell => `<span class="lstate">${escapeHtml(cell)}</span>`).join('')}
        </div>`).join('')
  }
  host.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-act="refresh"]')
    if (button !== null) void load()
  })
  return { refresh: load }
}
