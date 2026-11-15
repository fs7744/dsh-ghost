/**
 * dsh-ghost 第一屏：会话树 + 剧本流程图 + 节点详情。
 *
 * 数据全部来自 harness 的 Remote（经 vite 同源代理），不加载任何 harness 前端。
 * 剧本用 `.flow` 源文件现场编译成图——与将来编辑器的数据通路完全一致。
 */
import { createTransport, login } from '@dsh-ghost/harness-port'
import { parseFlow, toGraph } from '@dsh-ghost/playbook'
import type { Graph, GraphEdge, GraphNode } from '@dsh-ghost/playbook'
import flowSource from '../../../packages/playbook/examples/ticket-flow.flow?raw'

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <header>
    <span class="brand">dsh-ghost</span>
    <span class="status" id="conn">连接中…</span>
  </header>
  <aside><h2>会话</h2><div id="sessions"></div></aside>
  <main><div id="canvas"></div></main>
  <div id="detail"><h2>节点</h2><div id="node">未选中</div></div>
  <footer>
    <span id="f-sessions">— 个会话</span>
    <span id="f-nodes">— 个节点</span>
    <span id="f-events">— 个事件</span>
    <span id="f-token">—</span>
  </footer>
`

const el = (id: string) => document.getElementById(id)!
const state = {
  graph: undefined as Graph | undefined,
  selected: undefined as string | undefined,
  events: 0,
  sessions: [] as Array<{ sessionId: string; title?: string }>,
}

/** 拿 token：开发期由启动脚本拼在 URL 上，登录后浏览器自动持有 Cookie。 */
async function authenticate(): Promise<void> {
  const token = new URLSearchParams(location.search).get('token')
  if (token === null) {
    el('conn').textContent = '缺少 token（用 npm run dev:ui 启动）'
    return
  }
  // interactions=answer 才能订阅事件（none 会被网关拒）
  const response = await fetch(`/connect?token=${encodeURIComponent(token)}&interactions=answer`, { redirect: 'manual' })
  el('conn').textContent = response.ok || response.status === 302 || response.status === 0 ? '已连接' : `连接失败 ${response.status}`
  el('conn').style.color = response.status === 200 || response.status === 302 || response.type === 'opaqueredirect' ? 'var(--accent)' : 'var(--danger)'
}

/** 画流程图：正交连线 + 条件标签 + 回边虚线。 */
function renderGraph(graph: Graph): void {
  const pad = 24
  const width = graph.bounds.width + pad * 2
  const height = graph.bounds.height + pad * 2
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
      // 回边：从右侧绕上去
      ? `M ${x1} ${y1} C ${x1 + 90} ${y1 + 10}, ${x2 + 90} ${y2 - 10}, ${x2} ${y2}`
      : `M ${x1} ${y1} L ${x1} ${mid} L ${x2} ${mid} L ${x2} ${y2}`
    const label = edge.on === undefined ? '' : `<text class="on" x="${(x1 + x2) / 2 + 6}" y="${mid - 4}">${edge.on}${edge.max === undefined ? '' : ` ×${edge.max}`}</text>`
    return `<path class="edge ${edge.kind}" d="${path}" marker-end="url(#arrow)"/>${label}`
  }).join('')

  const boxes = graph.nodes.map(node => {
    const selected = node.id === state.selected ? ' sel' : ''
    const kind = node.kind === 'gate' ? ' gate' : ''
    const meta = node.script === undefined ? (node.kind === 'gate' ? '需人确认' : '') : node.script
    return `<g data-node="${node.id}" style="cursor:pointer">
      <rect class="node${kind}${selected}" x="${node.x + pad}" y="${node.y + pad}" width="${node.width}" height="${node.height}" rx="8"/>
      <text class="label" x="${node.x + pad + 12}" y="${node.y + pad + 22}">${escapeHtml(node.name)}</text>
      <text class="meta" x="${node.x + pad + 12}" y="${node.y + pad + 40}">${escapeHtml(meta)}</text>
    </g>`
  }).join('')

  el('canvas').innerHTML = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#8a8880"/></marker></defs>
    ${edges}${boxes}
  </svg>`

  el('canvas').querySelectorAll<SVGGElement>('g[data-node]').forEach(group => {
    group.addEventListener('click', () => {
      state.selected = group.dataset.node
      renderGraph(graph)
      const node = graph.nodes.find(item => item.id === state.selected)
      el('node').innerHTML = node === undefined ? '未选中' : `
        <dl>
          <dt>名称</dt><dd>${escapeHtml(node.name)}</dd>
          <dt>类型</dt><dd>${node.kind === 'gate' ? '人闸' : node.kind === 'call' ? '子剧本' : '步骤'}</dd>
          <dt>层级</dt><dd>${node.depth}</dd>
          <dt>脚本</dt><dd>${node.script === undefined ? '—' : escapeHtml(node.script)}</dd>
        </dl>`
    })
  })
  el('f-nodes').textContent = `${graph.nodes.length} 个节点 / ${graph.edges.length} 条边`
}

function renderSessions(): void {
  el('sessions').innerHTML = state.sessions.length === 0
    ? '<div class="row"><span class="id">还没有会话</span></div>'
    : state.sessions.map(session => `<div class="row" data-id="${session.sessionId}">
        <span>${escapeHtml(session.title ?? '未命名')}</span>
        <span class="id">${session.sessionId.slice(-6)}</span>
      </div>`).join('')
  el('f-sessions').textContent = `${state.sessions.length} 个会话`
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char] as string))
}

async function main(): Promise<void> {
  // 流程图先出来——它不依赖网络
  const { flow, errors } = parseFlow(flowSource)
  if (errors.length > 0) {
    el('canvas').innerHTML = `<div class="err">剧本有问题：\n${errors.join('\n')}</div>`
  } else {
    state.graph = toGraph(flow)
    renderGraph(state.graph)
  }

  await authenticate()
  const transport = createTransport({
    origin: location.origin,
    credentials: 'same-origin',
    createWebSocket: url => {
      const socket = new WebSocket(url.replace(location.origin, location.origin.replace('http', 'ws')).replace(/^ws:\/\/127\.0\.0\.1:\d+/, location.origin.replace('http', 'ws')))
      return {
        send: data => socket.send(data),
        close: () => socket.close(),
        onOpen: handler => socket.addEventListener('open', () => handler()),
        onMessage: handler => socket.addEventListener('message', event => handler(String(event.data))),
        onError: handler => socket.addEventListener('error', () => handler(new Error('socket error'))),
      }
    },
    onError: error => { el('conn').textContent = `事件流错误：${String(error).slice(0, 60)}` },
  })

  const refresh = async (): Promise<void> => {
    try {
      const listed = await transport.call('session/list', { _request: {} })
      const items = (listed as { items?: Array<{ sessionId: string; title?: string }> })?.items ?? []
      state.sessions = items.map(item => ({ sessionId: item.sessionId, ...(item.title === undefined ? {} : { title: item.title }) }))
      renderSessions()
    } catch (error) {
      el('conn').textContent = `取会话失败：${String(error).slice(0, 80)}`
    }
  }
  await refresh()

  // 事件驱动刷新：新会话出现时自动更新
  try {
    await transport.events(frame => {
      state.events += 1
      el('f-events').textContent = `${state.events} 个事件`
      if (frame.type === 'emit' && frame.event.startsWith('api-session/')) void refresh()
    })
  } catch (error) {
    el('conn').textContent = `事件订阅失败：${String(error).slice(0, 60)}`
  }
  setInterval(() => { el('f-token').textContent = new Date().toLocaleTimeString('zh-CN') }, 1000)
}

void main()
