/**
 * dsh-ghost 主界面：会话对话 + 剧本流程图。
 *
 * 数据全部来自 harness 的 Remote（经 vite 同源代理），不加载任何 harness 前端。
 * 对话读 `session/page`，写 `session/prompt`；图读 `.flow` 源文件现场编译。
 */
import { createTransport, login } from '@dsh-ghost/harness-port'
import { parseFlow, toGraph } from '@dsh-ghost/playbook'
import type { Graph } from '@dsh-ghost/playbook'
import flowSource from '../../../packages/playbook/examples/ticket-flow.flow?raw'

type Transport = ReturnType<typeof createTransport>
type LogRecord = { type: string; event?: { type: string; seq: number; data: Record<string, unknown> } }

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <header>
    <span class="brand">dsh-ghost</span>
    <nav id="tabs">
      <button data-tab="chat" class="on">对话</button>
      <button data-tab="flow">剧本</button>
    </nav>
    <span class="status" id="conn">连接中…</span>
  </header>
  <aside><h2>会话</h2><div id="sessions"></div></aside>
  <main>
    <div id="chat" class="pane">
      <div id="stream"></div>
      <div id="composer">
        <textarea id="input" rows="2" placeholder="说点什么…（Enter 发送，Shift+Enter 换行）"></textarea>
        <button id="send">发送</button>
      </div>
    </div>
    <div id="flow" class="pane hidden"><div id="canvas"></div></div>
  </main>
  <div id="detail"><h2>详情</h2><div id="node">未选中</div></div>
  <footer>
    <span id="f-sessions">— 个会话</span>
    <span id="f-records">— 条记录</span>
    <span id="f-events">— 个事件</span>
    <span id="f-state">—</span>
  </footer>
`

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const state = {
  transport: undefined as Transport | undefined,
  sessions: [] as Array<{ sessionId: string; title?: string }>,
  active: undefined as string | undefined,
  graph: undefined as Graph | undefined,
  selected: undefined as string | undefined,
  events: 0,
  busy: false,
}

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char] as string))

type Bubble =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string; tool?: string }
  | { kind: 'tool'; text: string }
  | { kind: 'note'; text: string }

/** 从会话日志里抽出可显示的消息。 */
function toBubbles(records: readonly LogRecord[]): Bubble[] {
  const bubbles: Bubble[] = []
  for (const record of records) {
    const event = record.type === 'event' ? record.event : undefined
    if (event === undefined) continue
    const data = event.data as {
      message?: { content?: Array<{ type: string; text?: string; name?: string }> }
      content?: Array<{ type: string; text?: string }>
      result?: unknown
      reason?: { kind?: string }
    }
    if (event.type === 'user/message') {
      const text = (data.content ?? []).filter(part => part.type === 'text').map(part => part.text ?? '').join('\n')
      if (text !== '') bubbles.push({ kind: 'user', text })
    } else if (event.type === 'assistant/message') {
      const parts = data.message?.content ?? []
      const text = parts.filter(part => part.type === 'text').map(part => part.text ?? '').join('')
      const tool = parts.find(part => part.type === 'tool-call')?.name
      if (text !== '' || tool !== undefined) bubbles.push({ kind: 'assistant', text, ...(tool === undefined ? {} : { tool }) })
    } else if (event.type === 'tool/result') {
      bubbles.push({ kind: 'tool', text: JSON.stringify(data.result ?? data).slice(0, 400) })
    } else if (event.type === 'turn/end') {
      const reason = data.reason?.kind
      if (reason !== undefined) bubbles.push({ kind: 'note', text: `回合结束（${reason}）` })
    }
  }
  return bubbles
}

function renderStream(bubbles: readonly Bubble[]): void {
  const stream = el('stream')
  if (bubbles.length === 0) {
    stream.innerHTML = '<div class="empty">这个会话还没有消息。</div>'
    return
  }
  stream.innerHTML = bubbles.map(bubble => {
    if (bubble.kind === 'note') return `<div class="note">${escapeHtml(bubble.text)}</div>`
    if (bubble.kind === 'tool') return `<details class="tool"><summary>工具结果</summary><pre>${escapeHtml(bubble.text)}</pre></details>`
    const who = bubble.kind === 'user' ? '你' : 'Ghost'
    const chip = bubble.kind === 'assistant' && bubble.tool !== undefined ? `<div class="chip">调用 ${escapeHtml(bubble.tool)}</div>` : ''
    return `<div class="msg ${bubble.kind}"><div class="who">${who}</div><div class="body">${escapeHtml(bubble.text) === '' ? '<i>（无文本）</i>' : escapeHtml(bubble.text)}</div>${chip}</div>`
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

/** 画流程图（正交连线 + 条件标签 + 回边虚线）。 */
function renderGraph(graph: Graph): void {
  const pad = 24
  const nodes = new Map(graph.nodes.map(node => [node.id, node]))
  const edges = graph.edges.map(edge => {
    const from = nodes.get(edge.from)
    const to = nodes.get(edge.to)
    if (from === undefined || to === undefined) return ''
    const x1 = from.x + pad + from.width / 2
    const y1 = from.y + pad + from.height
    const x2 = to.x + pad + to.width / 2
    const y2 = to.y + pad
    const mid = (y1 + y2) / 2
    const path = edge.kind === 'back' || y2 < y1
      ? `M ${x1} ${y1} C ${x1 + 90} ${y1 + 10}, ${x2 + 90} ${y2 - 10}, ${x2} ${y2}`
      : `M ${x1} ${y1} L ${x1} ${mid} L ${x2} ${mid} L ${x2} ${y2}`
    const label = edge.on === undefined ? '' : `<text class="on" x="${(x1 + x2) / 2 + 6}" y="${mid - 4}">${edge.on}${edge.max === undefined ? '' : ` ×${edge.max}`}</text>`
    return `<path class="edge ${edge.kind}" d="${path}" marker-end="url(#arrow)"/>${label}`
  }).join('')
  const boxes = graph.nodes.map(node => {
    const selected = node.id === state.selected ? ' sel' : ''
    const kind = node.kind === 'gate' ? ' gate' : ''
    const meta = node.script ?? (node.kind === 'gate' ? '需人确认' : '')
    return `<g data-node="${node.id}" style="cursor:pointer">
      <rect class="node${kind}${selected}" x="${node.x + pad}" y="${node.y + pad}" width="${node.width}" height="${node.height}" rx="8"/>
      <text class="label" x="${node.x + pad + 12}" y="${node.y + pad + 22}">${escapeHtml(node.name)}</text>
      <text class="meta" x="${node.x + pad + 12}" y="${node.y + pad + 40}">${escapeHtml(meta)}</text>
    </g>`
  }).join('')
  const width = graph.bounds.width + pad * 2
  const height = graph.bounds.height + pad * 2
  el('canvas').innerHTML = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#8a8880"/></marker></defs>${edges}${boxes}</svg>`
  el('canvas').querySelectorAll<SVGGElement>('g[data-node]').forEach(group => {
    group.addEventListener('click', () => {
      state.selected = group.dataset.node
      renderGraph(graph)
      const node = graph.nodes.find(item => item.id === state.selected)
      el('node').innerHTML = node === undefined ? '未选中' : `<dl>
        <dt>名称</dt><dd>${escapeHtml(node.name)}</dd>
        <dt>类型</dt><dd>${node.kind === 'gate' ? '人闸' : node.kind === 'call' ? '子剧本' : '步骤'}</dd>
        <dt>层级</dt><dd>${node.depth}</dd>
        <dt>脚本</dt><dd>${node.script === undefined ? '—' : escapeHtml(node.script)}</dd>
      </dl>`
    })
  })
}

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
  renderStream(toBubbles(records))
  el('node').innerHTML = `<dl><dt>会话</dt><dd>${sessionId}</dd><dt>记录</dt><dd>${records.length}</dd></dl>`
  return records.length
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

/** 发送一条消息，并轮询到出现新记录。 */
async function send(): Promise<void> {
  const transport = state.transport
  const input = el<HTMLTextAreaElement>('input')
  const text = input.value.trim()
  if (transport === undefined || state.active === undefined || text === '' || state.busy) return
  state.busy = true
  const before = Number.parseInt(el('f-records').textContent ?? '0', 10)
  input.value = ''
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
  const { flow, errors } = parseFlow(flowSource)
  if (errors.length > 0) {
    el('canvas').innerHTML = `<div class="err">剧本有问题：\n${escapeHtml(errors.join('\n'))}</div>`
  } else {
    state.graph = toGraph(flow)
    renderGraph(state.graph)
  }

  el('tabs').querySelectorAll<HTMLButtonElement>('button').forEach(button => {
    button.addEventListener('click', () => {
      el('tabs').querySelectorAll('button').forEach(other => other.classList.toggle('on', other === button))
      el('chat').classList.toggle('hidden', button.dataset.tab !== 'chat')
      el('flow').classList.toggle('hidden', button.dataset.tab !== 'flow')
    })
  })
  el('send').addEventListener('click', () => { void send() })
  el('input').addEventListener('keydown', event => {
    const keyboard = event as KeyboardEvent
    if (keyboard.key === 'Enter' && !keyboard.shiftKey) { keyboard.preventDefault(); void send() }
  })

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

  const refresh = async (): Promise<void> => {
    try {
      const listed = await state.transport!.call('session/list', { _request: {} })
      const items = (listed as { items?: Array<{ sessionId: string; title?: string }> })?.items ?? []
      state.sessions = items.map(item => ({ sessionId: item.sessionId, ...(item.title === undefined ? {} : { title: item.title }) }))
      renderSessions()
      if (state.active === undefined && state.sessions.length > 0) await openSession(state.sessions[0].sessionId)
    } catch (error) {
      el('conn').textContent = `取会话失败：${String(error).slice(0, 80)}`
    }
  }
  await refresh()

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
