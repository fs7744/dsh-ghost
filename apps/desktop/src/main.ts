/**
 * dsh-ghost 主界面：会话对话 + 剧本流程图。
 *
 * 数据全部来自 harness 的 Remote（经 vite 同源代理），不加载任何 harness 前端。
 * 对话读 `session/page`，写 `session/prompt`；图读 `.flow` 源文件现场编译。
 */
import { createTransport } from '@dsh-ghost/harness-port'
import flowSource from '../../../packages/playbook/examples/ticket-flow.flow?raw'
import { mountFlowEditor } from './flow-editor.ts'
import { mountCommandPalette } from './command-palette.ts'
import { isCommandLine, parseSlash, toCommandItems, type CommandItem } from './palette.ts'
import { toBubbles, type Bubble, type LogRecord } from './session-log.ts'
import { downloadText, exportFilename, exportJsonl, exportMarkdown } from './export.ts'
import { findRewindPoints, forkRequest, rewindLabel, type RewindPoint } from './rewind.ts'
import { mountMemoryPanel, type MemoryHost, type MemoryWriteResult } from './memory-panel.ts'
import type { MemoryEntry } from './memory-view.ts'

type Transport = ReturnType<typeof createTransport>

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <header>
    <span class="brand">dsh-ghost</span>
    <nav id="tabs">
      <button data-tab="chat" class="on">对话</button>
      <button data-tab="flow">剧本</button>
      <button data-tab="memory">记忆</button>
    </nav>
    <span class="status" id="conn">连接中…</span>
    <nav class="exports">
      <button data-export="md" title="导出当前会话为 Markdown">导出 MD</button>
      <button data-export="jsonl" title="导出当前会话原始日志为 JSONL">导出 JSONL</button>
    </nav>
  </header>
  <aside><h2>会话</h2><div id="sessions"></div></aside>
  <main>
    <div id="chat" class="pane">
      <div id="stream"></div>
      <div id="questions" class="hidden"></div>
      <div id="composer">
        <textarea id="input" rows="2" placeholder="说点什么…（Enter 发送，Shift+Enter 换行）"></textarea>
        <button id="send">发送</button>
      </div>
    </div>
    <div id="flow" class="pane hidden"><div id="canvas"></div></div>
    <div id="memory" class="pane hidden"></div>
  </main>
  <div id="detail">
    <h2>票</h2><div id="tickets"><div class="id">加载中…</div></div>
    <h2>详情</h2><div id="node">未选中</div>
  </div>
  <footer>
    <span id="f-sessions">— 个会话</span>
    <span id="f-records">— 条记录</span>
    <span id="f-events">— 个事件</span>
    <span id="f-ctx" title="上下文占用"><span class="track"><span id="f-ctx-bar"></span></span><span id="f-ctx-num">—</span></span>
    <span id="f-state">—</span>
  </footer>
`

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const state = {
  transport: undefined as Transport | undefined,
  sessions: [] as Array<{ sessionId: string; title?: string }>,
  active: undefined as string | undefined,
  commands: [] as CommandItem[],
  rewindPoints: [] as RewindPoint[],
  events: 0,
  busy: false,
}

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char] as string))

// 会话日志解析（toBubbles）与导出已抽到 session-log.ts / export.ts，纯函数、可单测。

/**
 * 待答问题（agent 通过 ask_user_question 提问）：渲染成横幅，点选项即应答。
 *
 * 应答走 `userQuestions/answer`（wire 参数：agentId / callId / answer）。
 * answer 的具体形状尚未用真实提问验证——失败时把错误原文显示出来，下一轮据此修正。
 */
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
    return `<div class="q"><div class="qtext">${escapeHtml(text)}</div><div class="qbtns">${buttons}</div></div>`
  }).join('')
  box.querySelectorAll<HTMLButtonElement>('button[data-call]').forEach(button => {
    button.addEventListener('click', () => { void answerQuestion(button.dataset.call ?? '', button.dataset.answer ?? '') })
  })
}

/** 应答一条问题。 */
async function answerQuestion(callId: string, value: string): Promise<void> {
  const transport = state.transport
  if (transport === undefined || state.active === undefined) return
  try {
    await transport.call('userQuestions/answer', {
      agentId: state.active,
      callId,
      answer: value === '' ? {} : { selected: [value] },
    })
    el('f-state').textContent = '已应答'
    await openSession(state.active)
  } catch (error) {
    el('f-state').textContent = `应答失败：${String(error).slice(0, 90)}`
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

/** 打开一张票的详情：走 ghostTickets/get Remote。 */
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

/** 上下文占用条：projectedTokens / contextWindow。 */
function renderProjections(projections: unknown): void {
  const values = (projections as { values?: { contextPressure?: { projectedTokens?: number; contextWindow?: number }; tokenUsage?: { outputTokens?: number }; sessionStats?: { turns?: number; llmMs?: number } } })?.values
  const pressure = values?.contextPressure
  const bar = el('f-ctx-bar')
  const num = el('f-ctx-num')
  if (pressure?.projectedTokens === undefined || pressure.contextWindow === undefined) {
    num.textContent = '—'
    return
  }
  const ratio = Math.min(1, pressure.projectedTokens / pressure.contextWindow)
  bar.style.width = `${(ratio * 100).toFixed(1)}%`
  bar.style.background = ratio > 0.8 ? 'var(--danger)' : 'var(--accent)'
  const turns = values?.sessionStats?.turns ?? 0
  num.textContent = `${(pressure.projectedTokens / 1000).toFixed(1)}k / ${(pressure.contextWindow / 1000).toFixed(0)}k · ${turns} 回合`
}

function renderStream(bubbles: readonly Bubble[], points: readonly RewindPoint[] = []): void {
  const stream = el('stream')
  if (bubbles.length === 0) {
    stream.innerHTML = '<div class="empty">这个会话还没有消息。</div>'
    return
  }
  let userIndex = 0
  stream.innerHTML = bubbles.map(bubble => {
    if (bubble.kind === 'note') return `<div class="note">${escapeHtml(bubble.text)}</div>`
    if (bubble.kind === 'toolcall') return `<div class="tcard call"><div class="thead">调用 ${escapeHtml(bubble.name)}</div><pre>${escapeHtml(bubble.text)}</pre></div>`
    if (bubble.kind === 'tool') return `<div class="tcard result"><div class="thead">${escapeHtml(bubble.name)} 结果</div><pre>${escapeHtml(bubble.text)}</pre></div>`
    if (bubble.kind === 'user') {
      const point = points[userIndex]
      userIndex += 1
      const rewind = point === undefined ? '' : `<button class="rewind" data-rewind="${point.seq}" title="从这条消息分叉出新会话">↩ 回退</button>`
      return `<div class="msg user"><div class="who">你${rewind}</div><div class="body">${escapeHtml(bubble.text)}</div></div>`
    }
    const chip = bubble.tool !== undefined ? `<div class="chip">调用 ${escapeHtml(bubble.tool)}</div>` : ''
    return `<div class="msg ${bubble.kind}"><div class="who">Ghost</div><div class="body">${escapeHtml(bubble.text) === '' ? '<i>（无文本）</i>' : escapeHtml(bubble.text)}</div>${chip}</div>`
  }).join('')
  stream.scrollTop = stream.scrollHeight
}

function renderSessions(): void {
  el('sessions').innerHTML = state.sessions.length === 0
    ? '<div class="row"><span class="id">还没有会话</span></div>'
    : state.sessions.map(session => `<div class="row${session.sessionId === state.active ? ' active' : ''}" data-id="${session.sessionId}">
        <span>${escapeHtml(session.title ?? '未命名会话')}</span>
        <span class="id">${session.sessionId.slice(-6)}</span>
      </div>`).join('')
  el('f-sessions').textContent = `${state.sessions.length} 个会话`
  el('sessions').querySelectorAll<HTMLDivElement>('.row[data-id]').forEach(row => {
    row.addEventListener('click', () => { void openSession(row.dataset.id ?? '') })
  })
}

// 流程图与编辑器已移到 flow-editor.ts（C9-04）：图与文本共用一条单向数据流。

/** 读一个会话的日志并渲染。 */
async function openSession(sessionId: string): Promise<number> {
  if (sessionId === '') return 0
  state.active = sessionId
  renderSessions()
  const transport = state.transport
  if (transport === undefined) return 0
  const page = await transport.call('session/page', { request: { address: { kind: 'session', sessionId }, maxMessages: 60 } })
  const records = (page as { records?: LogRecord[] })?.records ?? []
  el('f-records').textContent = `${records.length} 条记录`
  state.rewindPoints = findRewindPoints(records)
  renderStream(toBubbles(records), state.rewindPoints)
  try {
    const projections = await transport.call('session/projections', { request: { sessionId } })
    renderProjections(projections)
    renderQuestions(projections)
  } catch { /* 投影读不到就不显示占用 */ }
  el('node').innerHTML = `<dl><dt>会话</dt><dd>${sessionId}</dd><dt>记录</dt><dd>${records.length}</dd></dl>`
  void loadCommands()
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
}

/** 执行一行斜杠命令：不产生模型消息，结果只进会话日志。 */
async function executeCommand(line: string): Promise<void> {
  const transport = state.transport
  if (transport === undefined || state.active === undefined) return
  const name = parseSlash(line).name
  el('f-state').textContent = `执行 /${name}…`
  try {
    const result = await transport.call('commands/execute' as never, {
      agentId: state.active,
      line,
      submittedAttachments: [],
    } as never)
    el('f-state').textContent = result === undefined ? `命令 /${name} 未解析` : `命令 /${name} 已执行`
    await openSession(state.active)
  } catch (error) {
    el('f-state').textContent = `命令失败：${String(error).slice(0, 60)}`
  }
}

/**
 * 确保会话有模型可用：新会话默认指向未配置的 provider，会直接失败。
 * 从 modelCatalog 里挑第一个可路由的（开发环境里就是本地 wb 网关）。
 */
async function ensureModel(sessionId: string): Promise<string | undefined> {
  const transport = state.transport
  if (transport === undefined) return undefined
  try {
    const catalog = await transport.call('session/modelCatalog', {}) as { groups?: Array<{ id: string; models: Array<{ id: string }> }> }
    const group = catalog.groups?.[0]
    const model = group?.models[0]
    if (group === undefined || model === undefined) return undefined
    await transport.call('session/selectModel', { request: { sessionId, provider: group.id, model: model.id } })
    return `${group.id}/${model.id}`
  } catch {
    return undefined
  }
}

/** 导出当前会话：Markdown 从视图模型生成，JSONL 保留 session/page 的原始记录。 */
async function exportSession(format: 'md' | 'jsonl'): Promise<void> {
  const transport = state.transport
  const sessionId = state.active
  if (transport === undefined || sessionId === undefined) {
    el('f-state').textContent = '没有可导出的会话'
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
    el('f-state').textContent = `已导出 ${records.length} 条记录（${format.toUpperCase()}）`
  } catch (error) {
    el('f-state').textContent = `导出失败：${String(error).slice(0, 60)}`
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
      el('f-state').textContent = '回退失败：宿主没返回新会话号'
      return
    }
    // 先立刻在会话树里显示分支（400ms 内有反馈），事件流稍后会同步真实列表
    state.sessions = [...state.sessions.filter(session => session.sessionId !== sessionId),
      { sessionId, title: `回退 · 第 ${point.index} 条` }]
    el('f-state').textContent = `已回退到新会话 ${sessionId.slice(-6)}`
    await openSession(sessionId)
  } catch (error) {
    el('f-state').textContent = `回退失败：${String(error).slice(0, 60)}`
  }
}

/** 发送一条消息，并轮询到出现新记录。 */
async function send(): Promise<void> {
  const transport = state.transport
  const input = el<HTMLTextAreaElement>('input')
  const text = input.value.trim()
  if (transport === undefined || state.active === undefined || text === '' || state.busy) return
  input.value = ''
  state.busy = true
  // 斜杠命令走 commands/execute，绝不进模型消息（不浪费 token）。
  if (isCommandLine(text)) {
    try { await executeCommand(text) } finally { state.busy = false }
    return
  }
  const before = Number.parseInt(el('f-records').textContent ?? '0', 10)
  el('f-state').textContent = '发送中…'
  try {
    const picked = await ensureModel(state.active)
    if (picked !== undefined) el('f-state').textContent = `模型 ${picked}`
    await transport.call('session/prompt', {
      request: { requestId: `ui-${Date.now()}`, sessionId: state.active, mode: 'queue', content: [{ type: 'text', text }] },
    })
    el('f-state').textContent = '已投递，等模型…'
    for (let i = 0; i < 60; i += 1) {
      await new Promise(r => setTimeout(r, 1200))
      const count = await openSession(state.active)
      if (count > before) { el('f-state').textContent = '已更新'; break }
    }
  } catch (error) {
    el('f-state').textContent = `发送失败：${String(error).slice(0, 60)}`
  } finally {
    state.busy = false
  }
}

async function main(): Promise<void> {
  // 剧本页自己管文本、图与表单：编辑即回写 .flow，全部走单向数据流。
  mountFlowEditor(el('flow'), flowSource)

  el('tabs').querySelectorAll<HTMLButtonElement>('button').forEach(button => {
    button.addEventListener('click', () => {
      el('tabs').querySelectorAll('button').forEach(other => other.classList.toggle('on', other === button))
      for (const id of ['chat', 'flow', 'memory']) el(id).classList.toggle('hidden', button.dataset.tab !== id)
    })
  })
  el('send').addEventListener('click', () => { void send() })
  el('stream').addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-rewind]')
    if (button === null) return
    const point = state.rewindPoints.find(item => item.seq === Number(button.dataset.rewind))
    if (point !== undefined && window.confirm(rewindLabel(point))) void rewindTo(point)
  })
  document.querySelectorAll<HTMLButtonElement>('[data-export]').forEach(button => {
    button.addEventListener('click', () => { void exportSession(button.dataset.export === 'jsonl' ? 'jsonl' : 'md') })
  })
  // 输入框键盘事件由命令面板统一接管（普通 Enter 仍回到 send()）。

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
      // 浏览器不能自带 Cookie 头，但同源请求会自动带；把 ws 地址换成当前源即可走 vite 代理。
      const socket = new WebSocket(url.replace(/^ws:\/\/[^/]+/, location.origin.replace('http', 'ws')))
      return {
        send: data => socket.send(data),
        close: () => socket.close(),
        onOpen: handler => socket.addEventListener('open', () => handler()),
        onMessage: handler => socket.addEventListener('message', event => handler(String(event.data))),
        onError: handler => socket.addEventListener('error', () => handler(new Error('socket error'))),
      }
    },
    onError: error => { el('f-state').textContent = `事件流错误：${String(error).slice(0, 50)}` },
  })

  mountCommandPalette({
    listCommands: async () => {
      if (state.commands.length === 0) await loadCommands()
      return state.commands
    },
    execute: async line => { await executeCommand(line) },
    send: () => { void send() },
    notice: text => { el('f-state').textContent = text },
  })

  // 记忆页：所有读写都走 ghostMemory/* Remote，界面不碰文件。
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
    notice: text => { el('f-state').textContent = text },
  }
  mountMemoryPanel(el('memory'), memoryHost)

  const refresh = async (): Promise<void> => {
    try {
      const listed = await state.transport!.call('session/list', { _request: {} })
      const items = (listed as { items?: Array<{ sessionId: string; title?: string }> })?.items ?? []
      state.sessions = items.map(item => ({ sessionId: item.sessionId, ...(item.title === undefined ? {} : { title: item.title }) }))
      renderSessions()
      const first = state.sessions[0]
      if (state.active === undefined && first !== undefined) await openSession(first.sessionId)
    } catch (error) {
      el('conn').textContent = `取会话失败：${String(error).slice(0, 80)}`
    }
  }
  await refresh()

  const pollTickets = async (): Promise<void> => {
    try {
      // 走 Remote（插件注册的 ghostTickets/list），不再读文件
      const view = await state.transport!.call('ghostTickets/list' as never, {} as never)
      renderTickets(view)
    } catch { /* 插件没装时静默 */ }
  }
  await pollTickets()
  setInterval(() => { void pollTickets() }, 3000)

  try {
    await state.transport.events(frame => {
      state.events += 1
      el('f-events').textContent = `${state.events} 个事件`
      if (frame.type === 'emit' && frame.event.startsWith('api-session/')) void refresh()
    })
  } catch (error) {
    el('f-state').textContent = `事件订阅失败：${String(error).slice(0, 50)}`
  }
}

void main()
