/**
 * dsh-ghost 主界面：会话对话 + 剧本流程图。
 *
 * 数据全部来自 harness 的 Remote（经 vite 同源代理），不加载任何 harness 前端。
 * 对话读 `session/page`，写 `session/prompt`；图读 `.flow` 源文件现场编译。
 *
 * 界面结构：左侧会话/导航侧栏 + 顶部轻标题栏 + 居中对话流 + 底部圆角输入区，
 * 右侧「票 / 详情」是可开合抽屉。所有既有 DOM id 与面板容器保持不变。
 */
import { createTransport } from '@dsh-ghost/harness-port'
import { composeChatMessage, evaluateContext, loadBrief } from './chat-context.ts'
import flowSource from '../../../packages/playbook/examples/ticket-flow.flow?raw'
import { mountFlowEditor } from './flow-editor.ts'
import { mountCommandPalette } from './command-palette.ts'
import { isCommandLine, parseSlash, toCommandItems, type CommandItem } from './palette.ts'
import { toBubbles, type Bubble, type LogRecord } from './session-log.ts'
import { downloadText, exportFilename, exportJsonl, exportMarkdown } from './export.ts'
import { findRewindPoints, forkRequest, rewindLabel, type RewindPoint } from './rewind.ts'
import { mountMemoryPanel, type MemoryHost, type MemoryWriteResult } from './memory-panel.ts'
import type { MemoryEntry } from './memory-view.ts'
import { initLocale, makeTranslator, subscribeLocale, toggleLocale } from './i18n.ts'
import { initTheme, subscribeTheme, toggleTheme } from './theme.ts'
import { defaultCombos, registerShortcuts, type ShortcutBinding } from './shortcuts.ts'
import { mountPanels, paintText, type MountedPanels, type PanelServices } from './panels.ts'
import { mountWorkspacePanel } from './workspace.ts'
import {
  mountTerminalPanel, mountJobsPanel, mountPlanPanel, mountGoalsPanel, mountCollabPanel, mountSkillsPanel,
} from './runtime-panels.ts'
import { mountSettingsPanel, mountPluginsPanel } from './admin-panels.ts'
import { mountStatsPanel, decorateStream } from './feedback.ts'
import { mountSuperagentPanel } from './superagent-panel.ts'
import { mountApprovalLayer, type ApprovalLayer } from './approval.ts'
import { mountAttachmentTools, type AttachmentTools } from './attachments.ts'
import { renderContextBar } from './context-bar.ts'
import { applyCustomSkin, invokeSlot, loadExtensions, mountExtensionPanel, slotButtons } from './extensions.ts'
import { mountChangesPanel } from './changes-panel.ts'
import { mountCapabilitiesPanel } from './capabilities-panel.ts'
import { mountTeamPanel } from './team-panel.ts'
import { applyPreset, currentPresetId } from './themes.ts'
import { BRAND_ICON } from './brand-image.ts'

type Transport = ReturnType<typeof createTransport>
type Session = { sessionId: string; title?: string; cwd?: string }
type ModelChoice = { provider: string; model: string; name: string }
type ModelGroup = { id: string; name: string; models: Array<{ id: string; name: string }> }

const app = document.querySelector<HTMLDivElement>('#app')!

/* —— 图标：统一线性风格，currentColor 继承，深浅主题都可读 —— */
const ICONS: Record<string, string> = {
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  dots: '<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  pencil: '<path d="m15 5 4 4M4 20h4l11-11-4-4L4 16Z"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 5H6a1 1 0 0 0-1 1v9"/>',
  rewind: '<path d="M9 7 4 12l5 5"/><path d="M4 12h9a6 6 0 1 1 0 12"/>',
  spark: '<path d="M12 3l1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7Z"/><path d="M18 17l.7 2.1L21 20l-2.3.9L18 23l-.7-2.1L15 20l2.3-.9Z"/>',
  sliders: '<path d="M4 7h6M14 7h6M4 17h10M18 17h2"/><circle cx="12" cy="7" r="2"/><circle cx="16" cy="17" r="2"/>',
  command: '<path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3Z"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2 6"/><path d="M20 5v6h-6"/>',
  export: '<path d="M12 3v12M8 7l4-4 4 4"/><path d="M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
}

const icon = (name: string, size = 16): string =>
  `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" `
  + `stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ''}</svg>`

/** 品牌图（AI 生成的暗色线性熊猫幽灵）：侧栏与欢迎页共用，只是尺寸不同。 */
function brandImg(src: string, size: number, extraClass = ''): string {
  return `<img class="brand-mark${extraClass === '' ? '' : ` ${extraClass}`}" src="${src}"
    width="${size}" height="${size}" alt="ghost" draggable="false" />`
}

// favicon 也用同一张图，运行时注入 data URI，避免静态资源路径在壳里失效。
const favicon = document.createElement('link')
favicon.rel = 'icon'
favicon.type = 'image/webp'
favicon.href = BRAND_ICON
document.head.appendChild(favicon)

app.innerHTML = `
  <aside id="sidebar">
    <div class="side-head">
      <div class="brand">${brandImg(BRAND_ICON, 34)}<span class="brand-text">ghost</span></div>
      <button id="btn-sidebar" class="icon-btn win-toggle" data-sidebar title="收起侧栏" aria-label="收起侧栏">${icon('panel')}</button>
    </div>
    <div class="side-actions">
      <button id="btn-new" class="new-chat">${icon('plus', 17)}<span data-t="session.new"></span></button>
    </div>
    <div class="side-search-wrap">
      ${icon('search', 15)}
      <input id="side-search" type="search" autocomplete="off" spellcheck="false" />
    </div>
    <div class="side-scroll">
      <nav id="tabs" class="navlist" aria-label="主导航"></nav>
      <section class="side-sessions">
        <div class="side-label">
          <span data-t="sidebar.recent"></span>
          <span class="side-spacer"></span>
          <button id="btn-search" class="mini-btn" title="搜索" aria-label="搜索">${icon('search', 15)}</button>
        </div>
        <div id="sessions" class="session-list"></div>
        <div id="search-empty" class="sempty hidden"></div>
      </section>
    </div>
    <div class="side-foot">
      <div class="account"><span class="avatar">${icon('user', 16)}</span><span class="acc-name" data-t="sidebar.account"></span><span id="acc-dot" class="acc-dot"></span></div>
      <button id="btn-side-settings" class="mini-btn" title="设置" aria-label="设置">${icon('sliders', 15)}</button>
    </div>
  </aside>

  <section class="workstage">
    <header>
      <button class="icon-btn stage-toggle" data-sidebar title="收起 / 展开侧栏" aria-label="收起 / 展开侧栏">${icon('panel')}</button>
      <div class="head-title"><span id="chat-title">Ghost</span><span class="head-sub" id="conn">连接中…</span></div>
      <div class="head-actions">
        <button id="btn-theme" class="icon-btn" title="切换亮 / 暗主题" aria-label="切换亮 / 暗主题">${icon('sun')}</button>
        <button id="btn-lang" class="text-btn" title="切换中英文">中 / EN</button>
        <button id="btn-detail" class="icon-btn" data-detail title="任务详情" aria-label="任务详情">${icon('panel')}</button>
        <button id="btn-more" class="icon-btn" data-popover="more-menu" title="更多" aria-label="更多">${icon('dots')}</button>
      </div>
    </header>

    <main id="main">
      <div id="chat" class="pane">
        <div id="chat-slots" class="panelslot"></div>
        <div id="stream"></div>
        <div id="questions" class="hidden"></div>
        <div id="composer">
          <div class="composer-input">
            <textarea id="input" rows="1" spellcheck="false" placeholder="描述你想构建的内容，/ 调用指令，@ 引用文件或对话"></textarea>
          </div>
          <div class="composer-bar">
            <div class="composer-left" id="composer-left">
              <button id="btn-commands" class="cbtn pill" data-popover="command-menu" title="快捷指令">${icon('command', 15)}<span data-t="composer.commands"></span>${icon('chevron', 13)}</button>
              <span class="composer-hint" data-t="composer.hint"></span>
            </div>
            <div class="composer-right">
              <button id="model-btn" class="cbtn model-btn" data-popover="model-menu" title="选择模型"><span class="model-dot"></span><span id="model-name" data-t="model.none"></span>${icon('chevron', 13)}</button>
              <button id="send" class="send-btn" title="发送" aria-label="发送">${icon('arrowUp', 18)}<span class="stop-glyph">${icon('stop', 18)}</span></button>
            </div>
          </div>
        </div>
      </div>
      <div id="flow" class="pane hidden"><div id="canvas"></div></div>
      <div id="memory" class="pane hidden"></div>
    </main>

    <footer>
      <span class="status-dot"></span>
      <span id="f-state">—</span>
      <span class="foot-spacer"></span>
      <span id="f-sessions">— 个会话</span>
      <span id="f-records">— 条记录</span>
      <span id="f-events">— 个事件</span>
      <span id="f-ctx" title="上下文占用">
        <span class="track"><span id="f-ctx-bar"></span><span id="f-ctx-marks"></span></span>
        <span id="f-ctx-num">—</span>
        <button id="f-ctx-more" data-t="ctx.compaction" title="查看压缩点"></button>
      </span>
    </footer>

    <div id="detail" class="detail">
      <div class="detail-head"><strong data-t="ui.detail"></strong><button class="icon-btn" data-detail title="关闭" aria-label="关闭">${icon('close', 15)}</button></div>
      <div class="detail-body">
        <h2>票</h2><div id="tickets"><div class="id">加载中…</div></div>
        <h2>详情</h2><div id="node">未选中</div>
      </div>
    </div>
  </section>

  <div id="ctx-popover" class="hidden"></div>
  <div id="model-menu" class="popover hidden"></div>
  <div id="command-menu" class="popover hidden"></div>
  <div id="more-menu" class="popover hidden">
    <a id="link-models" class="navlink" href="models.html" data-t="tab.models" title="模型库、能力标注与角色路由"></a>
    <button data-export="md" data-t="ui.exportMd"></button>
    <button data-export="jsonl" data-t="ui.exportJsonl"></button>
    <div class="popfoot">Ctrl+K 指令 · Ctrl+B 侧栏 · Ctrl+, 设置</div>
  </div>
  <div id="toast" class="hidden"></div>
`

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const state = {
  transport: undefined as Transport | undefined,
  sessions: [] as Session[],
  active: undefined as string | undefined,
  commands: [] as CommandItem[],
  rewindPoints: [] as RewindPoint[],
  events: 0,
  busy: false,
  aborted: false,
  activePanel: 'chat',
  modelChoice: undefined as ModelChoice | undefined,
  modelGroups: [] as ModelGroup[],
  modelDefault: undefined as ModelChoice | undefined,
  modelAppliedFor: undefined as string | undefined,
  collapsedGroups: new Set<string>(),
  expandedGroups: new Set<string>(),
}

// 绑定到当前 locale 的翻译函数；切换语言后同一函数立即返回新文案。
const T = makeTranslator()
let services: PanelServices | undefined
let approvalLayer: ApprovalLayer | undefined
let attachmentTools: AttachmentTools | undefined
let mountedPanels: MountedPanels | undefined
let refresh: () => Promise<void> = async () => { /* main() 里装配后替换 */ }
let toastTimer: number | undefined
let muteToastUntil = 0

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char] as string))

/** 轻量富文本：先转义再补粗体 / 行内代码 / 编号，绝不引入未转义 HTML。 */
function richText(value: string): string {
  return escapeHtml(value).split('\n').map(line => line
    .replace(/^(\d+\.)(\s*)/, '<span class="numlead">$1</span>$2')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')).join('\n')
}

/** 状态提示：脚本文字照旧写进 #f-state，同时弹一条不打断阅读的 toast。 */
function showToast(text: string): void {
  const clean = text.trim()
  if (clean === '' || clean === '—' || Date.now() < muteToastUntil) return
  const toast = el('toast')
  toast.textContent = clean
  toast.classList.remove('hidden')
  if (toastTimer !== undefined) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => toast.classList.add('hidden'), 3600)
}

function notice(text: string): void {
  el('f-state').textContent = text
  showToast(text)
}

/** 连接层错误只留在状态栏，不弹 toast（避免每次启动都被噪声打断）。 */
function quietNotice(text: string): void {
  muteToastUntil = Date.now() + 200
  el('f-state').textContent = text
}

/* —— 浮层：一次只开一个，点外面自动关 —— */
const POPOVERS = ['model-menu', 'command-menu', 'more-menu']

function closePopovers(except?: string): void {
  for (const id of POPOVERS) {
    if (id !== except) el(id).classList.add('hidden')
  }
}

function togglePopover(id: string): void {
  const box = el(id)
  const wasOpen = !box.classList.contains('hidden')
  closePopovers()
  if (wasOpen) return
  box.classList.remove('hidden')
  // 先显示再量高度，锚点上方放不下就落到下方，避免菜单跑出窗口。
  const anchor = document.querySelector<HTMLElement>(`[data-popover="${id}"]`)
  if (anchor === null) return
  const rect = anchor.getBoundingClientRect()
  const width = box.offsetWidth
  const height = box.offsetHeight
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))
  const above = rect.top - height - 10
  box.style.left = `${left}px`
  box.style.top = `${above >= 8 ? above : Math.min(rect.bottom + 10, window.innerHeight - height - 12)}px`
}

/* —— 侧栏折叠 / 右侧抽屉 —— */
const SIDEBAR_KEY = 'dsh-ghost.sidebar'

function setSidebar(collapsed: boolean): void {
  app.classList.toggle('sidebar-collapsed', collapsed)
  try { globalThis.localStorage?.setItem(SIDEBAR_KEY, collapsed ? '1' : '0') } catch { /* 忽略 */ }
}

function toggleSidebar(): void {
  setSidebar(!app.classList.contains('sidebar-collapsed'))
}

function setDetail(open: boolean): void {
  el('detail').classList.toggle('open', open)
  el('btn-detail').classList.toggle('on', open)
  document.querySelector('.workstage')?.classList.toggle('detail-open', open)
}

/* —— 会话列表：分组、搜索、重命名 —— */

/** 会话按工作区目录分组；没有 cwd 时统一归到「默认工作区」。 */
function groupOf(session: Session): string {
  const cwd = session.cwd ?? ''
  if (cwd === '') return T('session.defaultGroup')
  const parts = cwd.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] || T('session.defaultGroup')
}

function sessionTitle(session: Session): string {
  return session.title ?? T('session.untitled')
}

/** 侧栏每组默认只显示最近几条，避免上百个会话把导航挤没。 */
const SESSION_PREVIEW = 8

function renderSessions(): void {
  const box = el('sessions')
  const query = el<HTMLInputElement>('side-search').value.trim().toLowerCase()
  const searching = query !== ''
  const visible = searching
    ? state.sessions.filter(session => `${sessionTitle(session)} ${session.sessionId}`.toLowerCase().includes(query))
    : state.sessions
  if (visible.length === 0) {
    box.innerHTML = `<div class="sempty">${escapeHtml(state.sessions.length === 0 ? T('session.empty') : T('session.noMatch'))}</div>`
    el('f-sessions').textContent = `${state.sessions.length} 个会话`
    return
  }
  const groups = new Map<string, Session[]>()
  for (const session of visible) {
    const group = groupOf(session)
    groups.set(group, [...(groups.get(group) ?? []), session])
  }
  const isDefault = (name: string) => name === T('session.defaultGroup')
  box.innerHTML = [...groups.entries()].map(([group, items]) => {
    const collapsed = state.collapsedGroups.has(group)
    const expanded = searching || state.expandedGroups.has(group)
    const shown = expanded ? items : items.slice(0, SESSION_PREVIEW)
    const rows = shown.map(session => `<div class="srow${session.sessionId === state.active ? ' active' : ''}" data-id="${escapeHtml(session.sessionId)}">
        <span class="srow-icon">${icon('spark', 14)}</span>
        <span class="stitle" title="${escapeHtml(sessionTitle(session))}">${escapeHtml(sessionTitle(session))}</span>
        <button class="srow-act" data-rename="${escapeHtml(session.sessionId)}" title="${escapeHtml(T('session.rename'))}" aria-label="重命名">${icon('pencil', 13)}</button>
      </div>`).join('')
    const more = !expanded && items.length > SESSION_PREVIEW
      ? `<button class="sshowall" data-expand-group="${escapeHtml(group)}">${escapeHtml(T('sidebar.showAll').replace('{count}', String(items.length)))}</button>`
      : ''
    return `<div class="sgroup${collapsed ? ' collapsed' : ''}" data-group="${escapeHtml(group)}">
        <button class="sgroup-head" data-toggle="${escapeHtml(group)}" aria-expanded="${!collapsed}">
          ${icon('chevron', 13)}<span class="sgroup-icon">${icon('folder', 14)}</span>
          <span class="sgroup-name">${isDefault(group) ? `<span data-t="session.defaultGroup">${escapeHtml(group)}</span>` : escapeHtml(group)}</span>
          <span class="sgroup-count">${items.length}</span>
        </button>
        <div class="sgroup-body">${rows}${more}</div>
      </div>`
  }).join('')
  el('f-sessions').textContent = `${state.sessions.length} 个会话`
}

/** 顶部搜索同时过滤功能菜单与会话；搜索时临时展开折叠分组，清空后自动复原。 */
function applySearch(): void {
  const query = el<HTMLInputElement>('side-search').value.trim().toLowerCase()
  const tabs = el('tabs')
  tabs.classList.toggle('searching', query !== '')
  let menuHits = 0
  tabs.querySelectorAll<HTMLElement>('.tabsection').forEach(section => {
    let hits = 0
    section.querySelectorAll<HTMLButtonElement>('button[data-panel]').forEach(button => {
      const match = query === '' || (button.textContent ?? '').toLowerCase().includes(query)
      button.style.display = match ? '' : 'none'
      if (match) hits += 1
    })
    section.style.display = query === '' || hits > 0 ? '' : 'none'
    menuHits += hits
  })
  renderSessions()
  const sessionHits = el('sessions').querySelectorAll('.srow').length
  const empty = el('search-empty')
  empty.textContent = T('sidebar.noResult')
  empty.classList.toggle('hidden', query === '' || menuHits > 0 || sessionHits > 0)
}

/** 就地重命名：Enter 提交到 session/rename，Esc / 失焦取消。 */
function startRename(row: HTMLElement, sessionId: string): void {
  const session = state.sessions.find(item => item.sessionId === sessionId)
  if (session === undefined || row.querySelector('input') !== null) return
  const title = row.querySelector<HTMLElement>('.stitle')
  if (title === null) return
  const input = document.createElement('input')
  input.className = 'srename-input'
  input.value = sessionTitle(session)
  title.replaceWith(input)
  input.focus()
  input.select()
  let done = false
  const finish = async (commit: boolean): Promise<void> => {
    if (done) return
    done = true
    const next = input.value.trim()
    if (commit && next !== '' && next !== sessionTitle(session)) {
      try {
        await state.transport?.call('session/rename', { request: { sessionId, title: next } })
        session.title = next
        if (state.active === sessionId) updateHeadTitle()
        notice(`${T('session.rename')}：${next}`)
      } catch (error) {
        notice(`重命名失败：${String(error).slice(0, 60)}`)
      }
    }
    renderSessions()
  }
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); void finish(true) }
    if (event.key === 'Escape') { event.preventDefault(); void finish(false) }
  })
  input.addEventListener('blur', () => { void finish(true) })
}

async function newSession(): Promise<void> {
  const transport = state.transport
  if (transport === undefined) { notice('尚未连接宿主'); return }
  try {
    const result = await transport.call('session/create', { request: {} }) as { sessionId?: string }
    const sessionId = result?.sessionId
    if (sessionId === undefined || sessionId === '') throw new Error('宿主没有返回会话号')
    await refresh()
    await openSession(sessionId)
    mountedPanels?.activate('chat')
    el<HTMLTextAreaElement>('input').focus()
    notice(T('session.created'))
  } catch (error) {
    notice(`创建失败：${String(error).slice(0, 90)}`)
  }
}

function updateHeadTitle(): void {
  if (state.activePanel !== 'chat') {
    const label = document.querySelector<HTMLElement>(`#tabs button[data-panel="${state.activePanel}"] .plabel`)
    el('chat-title').textContent = label?.textContent ?? 'Ghost'
    return
  }
  const current = state.sessions.find(session => session.sessionId === state.active)
  el('chat-title').textContent = current === undefined ? 'Ghost' : sessionTitle(current)
}

/* —— 模型选择：真实读 modelCatalog，选择写入 session/selectModel —— */
const MODEL_KEY = 'dsh-ghost.model'

function readSavedModel(): void {
  try {
    const raw = globalThis.localStorage?.getItem(MODEL_KEY)
    if (raw === null || raw === undefined || raw === '') return
    const parsed = JSON.parse(raw) as Partial<ModelChoice>
    if (typeof parsed.provider === 'string' && typeof parsed.model === 'string' && typeof parsed.name === 'string') {
      state.modelChoice = { provider: parsed.provider, model: parsed.model, name: parsed.name }
    }
  } catch { /* 坏数据忽略 */ }
}

function updateModelLabel(): void {
  const name = state.modelChoice?.name ?? T('model.none')
  el('model-name').textContent = name
  el('model-btn').classList.toggle('unset', state.modelChoice === undefined)
}

async function loadModels(): Promise<void> {
  const transport = state.transport
  if (transport === undefined) return
  try {
    const catalog = await transport.call('session/modelCatalog', {}) as {
      groups?: ModelGroup[]; default?: { provider?: string; model?: string }
    }
    state.modelGroups = catalog.groups ?? []
    const fallback = state.modelGroups[0]?.models[0]
    const chosen = catalog.default?.provider !== undefined && catalog.default?.model !== undefined
      ? { provider: catalog.default.provider, model: catalog.default.model }
      : fallback === undefined ? undefined : { provider: state.modelGroups[0]!.id, model: fallback.id }
    state.modelDefault = chosen === undefined ? undefined : {
      ...chosen, name: `${chosen.provider} / ${chosen.model}`,
    }
    if (state.modelChoice === undefined) state.modelChoice = state.modelDefault
    updateModelLabel()
    renderModelMenu()
  } catch { /* 没连上宿主时保留「未连接模型」 */ }
}

function renderModelMenu(): void {
  const menu = el('model-menu')
  const head = `<div class="pophead">${escapeHtml(T('model.title'))}</div>`
  const groups = state.modelGroups.length === 0
    ? `<div class="popempty">${escapeHtml(T('common.unavailable'))}</div>`
    : state.modelGroups.map(group => `<div class="popgroup">${escapeHtml(group.name)}</div>` + group.models.map(model => {
      const selected = state.modelChoice?.provider === group.id && state.modelChoice?.model === model.id
      return `<button class="poprow${selected ? ' on' : ''}" data-model="${escapeHtml(group.id)}|${escapeHtml(model.id)}" data-name="${escapeHtml(model.name || model.id)}">
          <span class="popcheck">${selected ? '✓' : ''}</span><span>${escapeHtml(model.name || model.id)}</span>
          <span class="popmeta">${escapeHtml(group.id)}</span></button>`
    }).join('')).join('')
  menu.innerHTML = head + groups
}

async function chooseModel(provider: string, model: string, name: string): Promise<void> {
  const choice: ModelChoice = { provider, model, name: `${provider} / ${name}` }
  state.modelChoice = choice
  try { globalThis.localStorage?.setItem(MODEL_KEY, JSON.stringify(choice)) } catch { /* 忽略 */ }
  updateModelLabel()
  renderModelMenu()
  closePopovers()
  if (state.transport !== undefined && state.active !== undefined) {
    try {
      await state.transport.call('session/selectModel', { request: { sessionId: state.active, provider, model } })
      state.modelAppliedFor = state.active
      notice(`${T('model.title')}：${choice.name}`)
    } catch (error) {
      notice(`切换模型失败：${String(error).slice(0, 60)}`)
    }
  }
}

/** 确保当前会话有可用模型：优先用户选择，其次宿主默认；同一会话只设置一次。 */
async function ensureModel(sessionId: string): Promise<string | undefined> {
  const transport = state.transport
  if (transport === undefined) return undefined
  const choice = state.modelChoice ?? state.modelDefault
  if (choice === undefined) return undefined
  if (state.modelAppliedFor === sessionId) return choice.name
  try {
    await transport.call('session/selectModel', { request: { sessionId, provider: choice.provider, model: choice.model } })
    state.modelAppliedFor = sessionId
    return choice.name
  } catch {
    return undefined
  }
}

/* —— 快捷指令菜单 —— */
function renderCommandMenu(): void {
  const menu = el('command-menu')
  const rows = state.commands.length === 0
    ? `<div class="popempty">${escapeHtml(T('composer.noCommands'))}</div>`
    : state.commands.map(item => `<button class="poprow" data-command="${escapeHtml(item.name)}">
        <span class="pname">/${escapeHtml(item.name)}</span><span class="popmeta">${escapeHtml(item.description)}</span>
      </button>`).join('')
  menu.innerHTML = `<div class="pophead">${escapeHtml(T('composer.commands'))}</div>${rows}`
}

/* —— 待答问题（agent 通过 ask_user_question 提问）：渲染成横幅，点选项即应答 —— */
function renderQuestions(projections: unknown): void {
  const active = ((projections as { values?: { userQuestions?: { active?: Array<Record<string, unknown>> } } })?.values?.userQuestions?.active) ?? []
  const box = el('questions')
  if (active.length === 0) {
    box.classList.add('hidden')
    box.innerHTML = ''
    return
  }
  box.classList.remove('hidden')
  box.innerHTML = active.map(question => {
    const callId = String(question.callId ?? question.id ?? '')
    const text = String(question.question ?? question.text ?? question.prompt ?? '需要你确认')
    const options = (question.options as Array<{ label?: string; value?: string }> | undefined) ?? []
    const buttons = options.length === 0
      ? '<button data-answer="" data-call="' + callId + '">收到</button>'
      : options.map(option => `<button data-call="${callId}" data-answer="${escapeHtml(String(option.value ?? option.label ?? ''))}">${escapeHtml(String(option.label ?? option.value ?? ''))}</button>`).join('')
    return `<div class="q"><div class="qtext">${icon('spark', 15)}<span>${escapeHtml(text)}</span></div><div class="qbtns">${buttons}</div></div>`
  }).join('')
  box.querySelectorAll<HTMLButtonElement>('button[data-call]').forEach(button => {
    button.addEventListener('click', () => { void answerQuestion(button.dataset.call ?? '', button.dataset.answer ?? '') })
  })
}

async function answerQuestion(callId: string, value: string): Promise<void> {
  const transport = state.transport
  if (transport === undefined || state.active === undefined) return
  try {
    await transport.call('userQuestions/answer', {
      agentId: state.active,
      callId,
      answer: value === '' ? {} : { selected: [value] },
    })
    notice('已应答')
    await openSession(state.active)
  } catch (error) {
    notice(`应答失败：${String(error).slice(0, 90)}`)
  }
}

/** 右栏票列表：来自插件注册的 `ghostTickets/list` Remote。 */
function renderTickets(payload: unknown): void {
  const tickets = (payload as { tickets?: Array<{ id: string; title: string; stage: { stage: string; action?: string } }> })?.tickets ?? []
  const box = el('tickets')
  if (tickets.length === 0) {
    box.innerHTML = '<div class="id">还没有票。让 agent 调用 ghost_ticket 开一张。<br>（票在引擎内存里，宿主重启即清空）</div>'
    return
  }
  box.innerHTML = tickets.map(ticket => {
    const stage = `${ticket.stage.stage}${ticket.stage.action === undefined ? '' : `/${ticket.stage.action}`}`
    const tone = ticket.stage.stage === 'person' ? 'person' : ticket.stage.stage === 'ended' ? 'ended' : 'working'
    return `<div class="trow" data-ticket="${ticket.id}" style="cursor:pointer">
      <span class="tstage ${tone}">${stage}</span>
      <span class="ttitle" title="${escapeHtml(ticket.title)}">${escapeHtml(ticket.title)}</span>
    </div>`
  }).join('')
  box.querySelectorAll<HTMLDivElement>('.trow[data-ticket]').forEach(row => {
    row.addEventListener('click', () => { void openTicket(row.dataset.ticket ?? '') })
  })
}

async function openTicket(id: string): Promise<void> {
  const transport = state.transport
  if (transport === undefined || id === '') return
  try {
    const result = await transport.call('ghostTickets/get' as never, { input: { id } } as never) as { ticket?: {
      id: string; title: string; stage: { stage: string; action?: string }; createdAt: string; report: string | null
      inputs: number; assignments: Array<{ id: string; state: string; report: { state: string; summary: string } | null }>
    } }
    const ticket = result.ticket
    if (ticket === undefined) {
      el('node').innerHTML = '<div class="id">这张票不在仓库里（可能已过期）。</div>'
      return
    }
    const assignments = ticket.assignments.length === 0
      ? '<div class="id">还没有派活记录</div>'
      : ticket.assignments.map(assignment => `<div class="arow">
          <span class="tstage">${escapeHtml(assignment.state)}</span>
          <span class="ttitle">${escapeHtml(assignment.report?.summary ?? '（无报告）')}</span>
        </div>`).join('')
    el('node').innerHTML = `<dl>
      <dt>票号</dt><dd>${escapeHtml(ticket.id.slice(0, 12))}</dd>
      <dt>标题</dt><dd>${escapeHtml(ticket.title)}</dd>
      <dt>阶段</dt><dd>${JSON.stringify(ticket.stage)}</dd>
      <dt>输入</dt><dd>${ticket.inputs} 条</dd>
      <dt>派活</dt><dd>${assignments}</dd>
    </dl>`
  } catch (error) {
    el('node').innerHTML = `<div class="err">${escapeHtml(String(error).slice(0, 120))}</div>`
  }
}

/** 上下文占用条 + 待答横幅。 */
function renderProjections(projections: unknown, records: readonly LogRecord[]): void {
  renderQuestions(projections)
  renderContextBar({
    bar: el('f-ctx-bar'),
    marks: el('f-ctx-marks'),
    num: el('f-ctx-num'),
    popover: el('ctx-popover'),
  }, projections, records, { t: T })
}

/** 空会话：给一个能点、能直接开聊的欢迎页，而不是一行灰字。 */
function welcomeHtml(): string {
  const cards: ReadonlyArray<readonly [string, string]> = [
    ['chat.suggest1', '整理这个工作区的文件，给我一份结构说明'],
    ['chat.suggest2', '帮我写一段代码，并说明怎么运行'],
    ['chat.suggest3', '查资料并交叉核对，给出有来源的结论'],
    ['chat.suggest4', '运行脚本批量处理文件，并汇报进度'],
  ]
  const cardHtml = cards.map(([key, prompt]) =>
    `<button class="wcard" data-suggest="${escapeHtml(prompt)}">${icon('spark', 15)}<span data-t="${key}"></span></button>`).join('')
  return `<div class="welcome">
    <div class="welcome-mark">${brandImg(BRAND_ICON, 48)}</div>
    <h1 data-t="chat.welcomeTitle"></h1>
    <p data-t="chat.welcomeHint"></p>
    <div class="welcome-cards">${cardHtml}</div>
  </div>`
}

function renderStream(bubbles: readonly Bubble[], points: readonly RewindPoint[] = [], recordsCount = 0): void {
  const stream = el('stream')
  const nearBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 140
  if (bubbles.length === 0) {
    // 全新 / 无会话才展示欢迎页；老会话只是没有可显示消息时给一行提示即可。
    const fresh = state.active === undefined || recordsCount === 0
    stream.innerHTML = fresh ? welcomeHtml() : `<div class="empty">${escapeHtml(T('chat.empty'))}</div>`
    if (fresh) paintText(stream, { t: T })
    return
  }
  const copyTexts: string[] = []
  let userIndex = 0
  stream.innerHTML = bubbles.map(bubble => {
    if (bubble.kind === 'note') return `<div class="note">${escapeHtml(bubble.text)}</div>`
    if (bubble.kind === 'toolcall') return `<details class="tcard call"><summary>${icon('command', 14)}<span>${escapeHtml(T('chat.toolCall'))} ${escapeHtml(bubble.name)}</span>${icon('chevron', 13)}</summary><pre>${escapeHtml(bubble.text)}</pre></details>`
    if (bubble.kind === 'tool') return `<details class="tcard result"><summary>${icon('chevronRight', 14)}<span>${escapeHtml(bubble.name)} ${escapeHtml(T('chat.toolResult'))}</span>${icon('chevron', 13)}</summary><pre>${escapeHtml(bubble.text)}</pre></details>`
    if (bubble.kind === 'user') {
      const point = points[userIndex]
      userIndex += 1
      const rewind = point === undefined ? '' : `<button class="rewind" data-rewind="${point.seq}" title="${escapeHtml(rewindLabel(point))}">${icon('rewind', 13)}<span>回退</span></button>`
      return `<div class="msg user"><div class="bubble">${escapeHtml(bubble.text)}</div>${rewind}</div>`
    }
    const copyIndex = copyTexts.push(bubble.text) - 1
    const chip = bubble.tool !== undefined ? `<div class="chip">${escapeHtml(bubble.tool)}</div>` : ''
    return `<div class="msg assistant"><div class="msg-head">
        <span class="avatar ghost">${icon('spark', 13)}</span><strong>Ghost</strong>
        <span class="thought">${escapeHtml(T('chat.thinking'))} ${icon('chevronRight', 12)}</span>
        <button class="copy" data-copy="${copyIndex}" title="${escapeHtml(T('chat.copy'))}" aria-label="复制">${icon('copy', 13)}</button>
      </div><div class="body">${bubble.text === '' ? '<i>（无文本）</i>' : richText(bubble.text)}</div>${chip}</div>`
  }).join('')
  if (nearBottom) stream.scrollTop = stream.scrollHeight
  if (services !== undefined) decorateStream(stream, services)
}

/** 读一个会话的日志并渲染。 */
async function openSession(sessionId: string): Promise<number> {
  if (sessionId === '') return 0
  state.active = sessionId
  state.modelAppliedFor = undefined
  renderSessions()
  updateHeadTitle()
  const transport = state.transport
  if (transport === undefined) return 0
  const page = await transport.call('session/page', { request: { address: { kind: 'session', sessionId }, maxMessages: 60 } })
  const records = (page as { records?: LogRecord[] })?.records ?? []
  el('f-records').textContent = `${records.length} 条记录`
  state.rewindPoints = findRewindPoints(records)
  renderStream(toBubbles(records), state.rewindPoints, records.length)
  try {
    const projections = await transport.call('session/projections', { request: { sessionId } })
    renderProjections(projections, records)
    void approvalLayer?.refresh()
  } catch { /* 投影读不到就不显示占用 */ }
  el('node').innerHTML = `<dl><dt>会话</dt><dd>${sessionId}</dd><dt>记录</dt><dd>${records.length}</dd></dl>`
  await loadCommands()
  return records.length
}

/** 拉取当前会话可用的斜杠命令（切换会话时刷新，不在每次按键时请求）。 */
async function loadCommands(): Promise<void> {
  const transport = state.transport
  if (transport === undefined || state.active === undefined) return
  try {
    const raw = await transport.call('commands/list' as never, { agentId: state.active } as never)
    state.commands = toCommandItems(Array.isArray(raw) ? raw : [])
  } catch {
    state.commands = []
  }
  renderCommandMenu()
}

async function executeCommand(line: string, receipts: readonly string[] = []): Promise<void> {
  const transport = state.transport
  if (transport === undefined || state.active === undefined) return
  const name = parseSlash(line).name
  notice(`执行 /${name}…`)
  try {
    const result = await transport.call('commands/execute' as never, {
      agentId: state.active,
      line,
      submittedAttachments: receipts.map(receiptId => ({ type: 'file' as const, receiptId })),
    } as never)
    notice(result === undefined ? `命令 /${name} 未解析` : `命令 /${name} 已执行`)
    await openSession(state.active)
  } catch (error) {
    notice(`命令失败：${String(error).slice(0, 60)}`)
  }
}

/** 导出当前会话：Markdown 从视图模型生成，JSONL 保留 session/page 的原始记录。 */
async function exportSession(format: 'md' | 'jsonl'): Promise<void> {
  const transport = state.transport
  const sessionId = state.active
  if (transport === undefined || sessionId === undefined) {
    notice('没有可导出的会话')
    return
  }
  try {
    const page = await transport.call('session/page', {
      request: { address: { kind: 'session', sessionId }, maxMessages: 500 },
    })
    const records = (page as { records?: LogRecord[] })?.records ?? []
    const title = state.sessions.find(session => session.sessionId === sessionId)?.title
    const ext: 'md' | 'jsonl' = format === 'md' ? 'md' : 'jsonl'
    const content = format === 'md'
      ? exportMarkdown(toBubbles(records), { sessionId, ...(title === undefined ? {} : { title }) })
      : exportJsonl(records)
    downloadText(exportFilename(sessionId, ext), content,
      format === 'md' ? 'text/markdown;charset=utf-8' : 'application/x-ndjson;charset=utf-8')
    notice(`已导出 ${records.length} 条记录（${format.toUpperCase()}）`)
  } catch (error) {
    notice(`导出失败：${String(error).slice(0, 60)}`)
  }
}

/** 回退到某个 checkpoint：fork 出新会话，原会话不动，所以永远可撤销。 */
async function rewindTo(point: RewindPoint): Promise<void> {
  const transport = state.transport
  const source = state.active
  if (transport === undefined || source === undefined) return
  try {
    const result = await transport.call('session/fork', forkRequest(source, point))
    const sessionId = (result as { sessionId?: string })?.sessionId
    if (sessionId === undefined) {
      notice('回退失败：宿主没返回新会话号')
      return
    }
    state.sessions = [...state.sessions.filter(session => session.sessionId !== sessionId),
      { sessionId, title: `回退 · 第 ${point.index} 条` }]
    notice(`已回退到新会话 ${sessionId.slice(-6)}`)
    await openSession(sessionId)
  } catch (error) {
    notice(`回退失败：${String(error).slice(0, 60)}`)
  }
}

/** 发送按钮：空内容禁用；生成中变成可点的停止按钮。 */
function updateSendState(): void {
  const input = el<HTMLTextAreaElement>('input')
  const send = el<HTMLButtonElement>('send')
  const hasText = input.value.trim() !== ''
  const hasAttachments = (attachmentTools?.pending() ?? 0) > 0
  send.classList.toggle('ready', hasText || hasAttachments || state.busy)
  send.classList.toggle('busy', state.busy)
  send.disabled = !state.busy && !hasText && !hasAttachments
  send.title = state.busy ? T('composer.stop') : T('composer.send')
  send.setAttribute('aria-label', send.title)
}

function syncInputHeight(): void {
  const input = el<HTMLTextAreaElement>('input')
  input.style.height = 'auto'
  input.style.height = `${Math.min(input.scrollHeight, 180)}px`
}

async function cancelGeneration(): Promise<void> {
  const transport = state.transport
  if (transport === undefined || state.active === undefined) return
  state.aborted = true
  state.busy = false
  updateSendState()
  try {
    await transport.call('session/cancel', { request: { sessionId: state.active } })
    notice('已停止生成')
  } catch (error) {
    notice(`停止失败：${String(error).slice(0, 60)}`)
  }
}

/** 发送一条消息，并轮询到出现新记录（可随时停止）。 */
async function send(): Promise<void> {
  const transport = state.transport
  const input = el<HTMLTextAreaElement>('input')
  const text = input.value.trim()
  if (transport === undefined || state.active === undefined || state.busy) return
  const receipts = attachmentTools?.takeReceipts() ?? []
  if (text === '' && receipts.length === 0) return
  input.value = ''
  syncInputHeight()
  state.busy = true
  state.aborted = false
  updateSendState()
  if (isCommandLine(text)) {
    try { await executeCommand(text, receipts) } finally { state.busy = false; updateSendState() }
    return
  }
  const baseline = Number.parseInt(el('f-records').textContent ?? '0', 10)
  notice('发送中…')
  try {
    const context = await evaluateContext(transport, state.active)
    const brief = await loadBrief(transport)
    const body = composeChatMessage(text, brief)
    const picked = await ensureModel(state.active)
    if (picked !== undefined) notice(`模型 ${picked}`)
    await transport.call('session/prompt', {
      request: {
        requestId: `ui-${Date.now()}`,
        sessionId: state.active,
        mode: 'queue',
        content: [
          ...(body === '' ? [] : [{ type: 'text' as const, text: body }]),
          ...receipts.map(receiptId => ({ type: 'file' as const, receiptId })),
        ],
      },
    })
    notice(context.suggest
      ? `上下文已到 ${(context.usage.ratio * 100).toFixed(0)}%，建议 /compact（已投递）`
      : '已投递，等模型…')
    for (let i = 0; i < 60; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 1200))
      if (state.aborted) break
      const count = await openSession(state.active)
      if (count > baseline) { notice('已更新'); break }
    }
  } catch (error) {
    notice(`发送失败：${String(error).slice(0, 60)}`)
  } finally {
    state.busy = false
    updateSendState()
  }
}

async function main(): Promise<void> {
  initTheme()
  initLocale()
  readSavedModel()

  // 所有直接写 #f-state 的旧代码也自动获得 toast 反馈。
  new MutationObserver(() => showToast(el('f-state').textContent ?? '')).observe(el('f-state'), {
    childList: true, characterData: true, subtree: true,
  })

  try {
    if (globalThis.localStorage?.getItem(SIDEBAR_KEY) === '1') setSidebar(true)
  } catch { /* 忽略 */ }

  mountFlowEditor(el('flow'), flowSource)

  // —— 全局点击：侧栏折叠 / 抽屉 / 浮层 / 更多菜单 ——
  document.addEventListener('click', event => {
    const target = event.target as HTMLElement
    const sidebarBtn = target.closest<HTMLElement>('[data-sidebar]')
    if (sidebarBtn !== null) { toggleSidebar(); return }
    const detailBtn = target.closest<HTMLElement>('[data-detail]')
    if (detailBtn !== null) { setDetail(!el('detail').classList.contains('open')); return }
    const popBtn = target.closest<HTMLElement>('[data-popover]')
    if (popBtn !== null) { togglePopover(popBtn.dataset.popover ?? ''); return }
    if (target.closest('.popover') === null) closePopovers()
  })
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closePopovers() })

  el('btn-new').addEventListener('click', () => { void newSession() })
  el('btn-search').addEventListener('click', () => el<HTMLInputElement>('side-search').focus())
  el('btn-side-settings').addEventListener('click', () => mountedPanels?.activate('settings'))
  el<HTMLInputElement>('side-search').addEventListener('input', () => applySearch())
  el<HTMLInputElement>('side-search').addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      el<HTMLInputElement>('side-search').value = ''
      applySearch()
    }
  })
  el('sessions').addEventListener('click', event => {
    const target = event.target as HTMLElement
    const expand = target.closest<HTMLElement>('[data-expand-group]')
    if (expand !== null) {
      state.expandedGroups.add(expand.dataset.expandGroup ?? '')
      renderSessions()
      return
    }
    const toggle = target.closest<HTMLElement>('[data-toggle]')
    if (toggle !== null) {
      const group = toggle.dataset.toggle ?? ''
      if (state.collapsedGroups.has(group)) state.collapsedGroups.delete(group)
      else state.collapsedGroups.add(group)
      renderSessions()
      return
    }
    const rename = target.closest<HTMLElement>('[data-rename]')
    const row = target.closest<HTMLElement>('.srow[data-id]')
    if (rename !== null && row !== null) { startRename(row, rename.dataset.rename ?? ''); return }
    if (row !== null) void openSession(row.dataset.id ?? '')
  })

  el('model-menu').addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-model]')
    if (button === null) return
    const [provider, model] = (button.dataset.model ?? '|').split('|')
    void chooseModel(provider ?? '', model ?? '', button.dataset.name ?? model ?? '')
  })
  el('command-menu').addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-command]')
    if (button === null) return
    const input = el<HTMLTextAreaElement>('input')
    input.value = `/${button.dataset.command ?? ''} `
    closePopovers()
    syncInputHeight()
    updateSendState()
    input.focus()
    input.dispatchEvent(new Event('input'))
  })

  el('send').addEventListener('click', () => {
    if (state.busy) void cancelGeneration()
    else void send()
  })
  el<HTMLTextAreaElement>('input').addEventListener('input', () => { syncInputHeight(); updateSendState() })
  el('stream').addEventListener('click', event => {
    const target = event.target as HTMLElement
    const suggest = target.closest<HTMLElement>('[data-suggest]')
    if (suggest !== null) {
      const input = el<HTMLTextAreaElement>('input')
      input.value = suggest.dataset.suggest ?? ''
      syncInputHeight()
      updateSendState()
      input.focus()
      return
    }
    const copy = target.closest<HTMLElement>('[data-copy]')
    if (copy !== null) {
      const msg = copy.closest('.msg')
      const text = msg?.querySelector<HTMLElement>('.body')?.innerText ?? ''
      void navigator.clipboard?.writeText(text).then(() => notice(T('chat.copied'))).catch(() => notice('复制失败'))
      return
    }
    const button = target.closest<HTMLElement>('[data-rewind]')
    if (button === null) return
    const point = state.rewindPoints.find(item => item.seq === Number(button.dataset.rewind))
    if (point === undefined) return
    // 二次确认：不再弹系统 confirm，按钮原地变成「确认回退」。
    if (button.dataset.armed !== '1') {
      button.dataset.armed = '1'
      button.classList.add('armed')
      const label = button.querySelector('span')
      if (label !== null) label.textContent = '确认回退？'
      window.setTimeout(() => {
        button.dataset.armed = '0'
        button.classList.remove('armed')
        if (label !== null) label.textContent = '回退'
      }, 4000)
      return
    }
    void rewindTo(point)
  })
  document.querySelectorAll<HTMLButtonElement>('[data-export]').forEach(button => {
    button.addEventListener('click', () => { closePopovers(); void exportSession(button.dataset.export === 'jsonl' ? 'jsonl' : 'md') })
  })
  el('btn-theme').addEventListener('click', () => { toggleTheme() })
  el('btn-lang').addEventListener('click', () => { toggleLocale() })
  el('f-ctx-more').addEventListener('click', () => { el('ctx-popover').classList.toggle('hidden') })

  const token = new URLSearchParams(location.search).get('token')
  if (token === null) {
    el('conn').textContent = '缺少 token（用 npm run dev:ui 启动）'
  } else {
    const response = await fetch(`/connect?token=${encodeURIComponent(token)}&interactions=answer`, { redirect: 'manual' })
    const ok = response.type === 'opaqueredirect' || response.status === 302 || response.ok
    el('conn').textContent = ok ? '已连接' : `连接失败 ${response.status}`
    el('conn').style.color = ok ? 'var(--accent)' : 'var(--danger)'
  }

  state.transport = createTransport({
    origin: location.origin,
    credentials: 'same-origin',
    createWebSocket: url => {
      const socket = new WebSocket(url.replace(/^ws:\/\/[^/]+/, location.origin.replace('http', 'ws')))
      return {
        send: data => socket.send(data),
        close: () => socket.close(),
        onOpen: handler => socket.addEventListener('open', () => handler()),
        onMessage: handler => socket.addEventListener('message', event => handler(String(event.data))),
        onError: handler => socket.addEventListener('error', () => handler(new Error('socket error'))),
      }
    },
    onError: error => { quietNotice(`事件流错误：${String(error).slice(0, 50)}`) },
  })

  // 面板后台加载失败只写状态栏；toast 留给用户主动操作，避免启动就被错误弹窗刷屏。
  services = {
    transport: state.transport,
    agentId: () => state.active,
    notice: quietNotice,
    t: T,
  }

  mountCommandPalette({
    listCommands: async () => {
      if (state.commands.length === 0) await loadCommands()
      return state.commands
    },
    execute: async line => { await executeCommand(line) },
    send: () => { void send() },
    notice,
  })

  const memoryHost: MemoryHost = {
    list: async () => {
      const result = await state.transport!.call('ghostMemory/list' as never, {} as never)
      return (result as { items?: MemoryEntry[] })?.items ?? []
    },
    read: async name => {
      const result = await state.transport!.call('ghostMemory/read' as never, { input: { name } } as never)
      return (result as { content?: string })?.content
    },
    write: async input => {
      const result = await state.transport!.call('ghostMemory/write' as never, { input } as never)
      return result as MemoryWriteResult
    },
    remove: async name => {
      const result = await state.transport!.call('ghostMemory/remove' as never, { input: { name } } as never)
      return (result as { removed?: boolean })?.removed === true
    },
    status: async () => {
      const result = await state.transport!.call('ghostMemory/status' as never, {} as never)
      return { enabled: (result as { enabled?: boolean })?.enabled !== false }
    },
    toggle: async enabled => {
      const result = await state.transport!.call('ghostMemory/toggle' as never, { input: { enabled } } as never)
      return { enabled: (result as { enabled?: boolean })?.enabled ?? enabled }
    },
    notice: quietNotice,
  }
  mountMemoryPanel(el('memory'), memoryHost)

  attachmentTools = mountAttachmentTools(el('composer'), services)
  // 附件入口挪进输入区工具行，变成两个图标按钮（逻辑仍由 attachments.ts 管）。
  const attachRow = el('composer').querySelector<HTMLElement>('.attachtools')
  if (attachRow !== null) el('composer-left').prepend(attachRow)
  const attachStatus = el('composer').querySelector<HTMLElement>('.attachstatus')
  if (attachStatus !== null) {
    new MutationObserver(() => updateSendState()).observe(attachStatus, {
      childList: true, characterData: true, subtree: true,
    })
  }

  const panelServices = services
  const extensions = await loadExtensions(panelServices)
  applyPreset(currentPresetId())
  await applyCustomSkin(panelServices)
  const extensionDefs = extensions.panels.map(manifest => ({
    id: `ext-${manifest.id}`,
    labelKey: 'tab.extensions',
    label: manifest.title,
    order: 50 + manifest.order,
    mount: (host: HTMLElement) => mountExtensionPanel(host, panelServices, manifest),
  }))
  const chatSlots = el('chat-slots')
  chatSlots.innerHTML = slotButtons(extensions.slots, 'chat.toolbar')
  chatSlots.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-slot-endpoint]')
    if (button === null) return
    const endpoint = button.dataset.slotEndpoint ?? ''
    let args: Record<string, unknown> = {}
    try {
      args = JSON.parse(decodeURIComponent(button.dataset.slotArgs ?? '{}')) as Record<string, unknown>
    } catch { /* 参数坏了就按空参调 */ }
    void invokeSlot(panelServices, endpoint, args).then(result => panelServices.notice(result.text))
  })

  mountedPanels = mountPanels({
    tabs: el('tabs'),
    main: el('main'),
    staticPanes: [
      { id: 'chat', labelKey: 'tab.chat', order: 1 },
      { id: 'flow', labelKey: 'tab.flow', order: 2 },
      { id: 'memory', labelKey: 'tab.memory', order: 3 },
    ],
    // 分组按「用户要干什么」排，而不是按开发顺序：会话 / 工作区 / 智能体 / 系统 / 高级。
    // order 分段（1x / 2x / 3x / 4x）保证同组面板在排序后连续。
    groups: [
      { before: 'chat', labelKey: 'sidebar.conversations' },
      { before: 'workspace', labelKey: 'sidebar.workspaceGroup', collapsible: true },
      { before: 'team', labelKey: 'sidebar.agents', collapsible: true, collapsed: true },
      { before: 'settings', labelKey: 'sidebar.system' },
      { before: 'stats', labelKey: 'sidebar.advanced', collapsible: true, collapsed: true },
    ],
    defs: [
      ...extensionDefs,
      { id: 'workspace', labelKey: 'tab.workspace', order: 10, mount: mountWorkspacePanel },
      { id: 'changes', labelKey: 'tab.changes', order: 11, mount: mountChangesPanel },
      { id: 'terminal', labelKey: 'tab.terminal', order: 12, mount: mountTerminalPanel },
      { id: 'jobs', labelKey: 'tab.jobs', order: 13, mount: mountJobsPanel },
      { id: 'team', labelKey: 'tab.team', order: 20, mount: mountTeamPanel },
      { id: 'collab', labelKey: 'tab.collab', order: 21, mount: mountCollabPanel },
      { id: 'plan', labelKey: 'tab.plan', order: 22, mount: mountPlanPanel },
      { id: 'goals', labelKey: 'tab.goals', order: 23, mount: mountGoalsPanel },
      { id: 'skills', labelKey: 'tab.skills', order: 24, mount: mountSkillsPanel },
      { id: 'superagent', labelKey: 'tab.superagent', order: 25, mount: mountSuperagentPanel },
      { id: 'settings', labelKey: 'tab.settings', order: 30, mount: mountSettingsPanel },
      { id: 'plugins', labelKey: 'tab.plugins', order: 31, mount: mountPluginsPanel },
      { id: 'stats', labelKey: 'tab.stats', order: 40, mount: mountStatsPanel },
      { id: 'capabilities', labelKey: 'tab.capabilities', order: 41, mount: mountCapabilitiesPanel },
    ],
    services,
    onActivate: id => {
      state.activePanel = id
      updateHeadTitle()
      if (id === 'chat') void approvalLayer?.refresh()
    },
  })

  approvalLayer = mountApprovalLayer(services)

  const repaint = (): void => {
    mountedPanels?.applyLocale()
    paintText(document.body, { t: T })
    el<HTMLTextAreaElement>('input').placeholder = T('composer.placeholder')
    el<HTMLInputElement>('side-search').placeholder = T('sidebar.search')
    updateModelLabel()
    renderModelMenu()
    renderCommandMenu()
    applySearch()
    updateHeadTitle()
  }
  subscribeLocale(repaint)
  subscribeTheme(() => repaint())
  repaint()

  const combos = defaultCombos()
  const bindings: ShortcutBinding[] = []
  for (let i = 1; i <= 9; i += 1) {
    const id = mountedPanels.ids[i - 1]
    if (id === undefined) continue
    bindings.push({ combo: combos[`tab${i}`] ?? `Ctrl+${i}`, action: () => mountedPanels?.activate(id) })
  }
  bindings.push(
    {
      combo: combos.palette ?? 'Ctrl+K',
      allowInEditable: true,
      action: () => {
        const input = el<HTMLTextAreaElement>('input')
        if (input.value.trim() === '') input.value = '/'
        input.focus()
        input.dispatchEvent(new Event('input'))
      },
    },
    { combo: combos.settings ?? 'Ctrl+,', allowInEditable: true, action: () => mountedPanels?.activate('settings') },
    { combo: combos.exportMd ?? 'Ctrl+Shift+E', allowInEditable: true, action: () => { void exportSession('md') } },
    { combo: combos.theme ?? 'Ctrl+Shift+T', allowInEditable: true, action: () => { toggleTheme() } },
    { combo: combos.language ?? 'Ctrl+Shift+L', allowInEditable: true, action: () => { toggleLocale() } },
    { combo: 'Ctrl+B', allowInEditable: true, action: toggleSidebar },
    { combo: 'Ctrl+Shift+N', allowInEditable: true, action: () => { void newSession() } },
  )
  registerShortcuts(bindings)

  refresh = async (): Promise<void> => {
    try {
      const listed = await state.transport!.call('session/list', { _request: {} })
      const items = (listed as { items?: Session[] })?.items ?? []
      state.sessions = items.map(item => ({
        sessionId: item.sessionId,
        ...(item.title === undefined ? {} : { title: item.title }),
        ...(item.cwd === undefined ? {} : { cwd: item.cwd }),
      }))
      renderSessions()
      updateHeadTitle()
      // 事件流触发的刷新一旦恢复，把连接状态从「未连接宿主」改回来。
      if (el('conn').textContent === '未连接宿主') {
        el('conn').textContent = '已连接'
        el('conn').style.color = 'var(--accent)'
      }
      const first = state.sessions[0]
      if (state.active === undefined && first !== undefined) await openSession(first.sessionId)
    } catch (error) {
      el('conn').textContent = '未连接宿主'
      el('conn').style.color = 'var(--danger)'
      quietNotice(`取会话失败：${String(error).slice(0, 80)}`)
      if (state.active === undefined) renderStream([])
    }
  }
  await refresh()
  if (state.active === undefined) renderStream([])
  await loadModels()

  const pollTickets = async (): Promise<void> => {
    try {
      const view = await state.transport!.call('ghostTickets/list' as never, {} as never)
      renderTickets(view)
      const shell = (window as unknown as { shellApi?: { reportTickets?: (value: unknown) => Promise<unknown> } }).shellApi
      void shell?.reportTickets?.((view as { tickets?: unknown }).tickets ?? [])
    } catch { /* 插件没装时静默 */ }
  }
  await pollTickets()
  setInterval(() => { void pollTickets() }, 3000)

  renderModelMenu()
  renderCommandMenu()
  updateSendState()
  syncInputHeight()

  try {
    await state.transport.events(frame => {
      state.events += 1
      el('f-events').textContent = `${state.events} 个事件`
      if (frame.type === 'emit') {
        if (frame.event.startsWith('api-session/')) void refresh()
        approvalLayer?.onFrame({ event: frame.event, args: frame.args })
      }
    })
  } catch (error) {
    quietNotice(`事件订阅失败：${String(error).slice(0, 50)}`)
  }
}

void main()
