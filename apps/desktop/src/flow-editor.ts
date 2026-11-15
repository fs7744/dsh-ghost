/**
 * 剧本编辑器（C9-04）：图给人看，文本给模型读。
 *
 * **单向数据流**：`state.text` 是唯一真相源。
 *   用户操作 → editText(text, edit) → 新文本 → parseFlow → validate → toGraph → 重绘
 * 任何一步都不直接改图对象；坐标永远是 toGraph() 现算的缓存。
 * 因此「图上改了、源文件没改」这种漂移不可能发生。
 */
import {
  compilePlaybook, editText, estimateTokens, parseFlow, renderBody,
  toGraph, validate, type Flow, type FlowEdit, type Graph,
} from '@dsh-ghost/playbook'

interface EditorState {
  text: string
  initial: string
  flow: Flow
  graph: Graph
  selected: string | undefined
  errors: string[]
  notes: string[]
}

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] as string))

/**
 * 把编辑器挂进「剧本」面板。
 * @param pane - `#flow` 容器
 * @param source - 初始 `.flow` 文本
 */
export function mountFlowEditor(pane: HTMLElement, source: string): void {
  pane.innerHTML = `
    <div class="flowbar">
      <button data-act="add-node">+ 节点</button>
      <button data-act="reset">还原</button>
      <button data-act="download">导出 .flow</button>
      <span id="fe-status"></span>
      <span class="fespacer"></span>
      <button data-act="apply" class="primary">应用文本 ⌃S</button>
    </div>
    <div class="flowbody">
      <div class="flowleft"><div id="fe-canvas"></div></div>
      <div class="flowright">
        <div id="fe-form"></div>
        <div class="felabel">.flow 源码 · 唯一真相源</div>
        <textarea id="fe-text" spellcheck="false"></textarea>
        <div id="fe-errors"></div>
      </div>
    </div>
  `

  const el = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T
  const bar = pane.querySelector<HTMLElement>('.flowbar')!
  const form = el('fe-form')
  const canvas = el('fe-canvas')
  const textarea = el<HTMLTextAreaElement>('fe-text')
  const detail = document.getElementById('node')

  const first = parseFlow(source)
  let state: EditorState = {
    text: source,
    initial: source,
    flow: first.flow,
    graph: toGraph(first.flow),
    selected: first.flow.nodes[0]?.name,
    errors: [...first.errors, ...validate(first.flow)],
    notes: [],
  }

  /** 从文本重建全部派生状态——唯一允许更新 state 的入口。 */
  const commit = (text: string, notes: string[] = []): void => {
    const parsed = parseFlow(text)
    if (state.selected !== undefined && !parsed.flow.nodes.some(node => node.name === state.selected)) {
      state.selected = parsed.flow.nodes[0]?.name
    }
    state = {
      ...state,
      text,
      flow: parsed.flow,
      graph: toGraph(parsed.flow),
      errors: [...parsed.errors, ...validate(parsed.flow)],
      notes,
    }
    render()
  }

  /** 执行一次编辑；失败只提示，不改动文本。 */
  const run = (edit: FlowEdit): void => {
    const result = editText(state.text, edit)
    if (result.errors.length > 0) {
      state = { ...state, notes: result.errors }
      render()
      return
    }
    if (edit.type === 'node.rename' && state.selected === edit.name) state.selected = edit.to
    if (edit.type === 'node.add') state.selected = edit.name
    if (edit.type === 'node.remove' && state.selected === edit.name) state.selected = result.flow.nodes[0]?.name
    commit(result.text, result.notes)
  }

  /** 生成一个不冲突的新名字。 */
  const fresh = (prefix: string, taken: (name: string) => boolean): string => {
    for (let index = 1; ; index += 1) {
      const name = `${prefix}-${index}`
      if (!taken(name)) return name
    }
  }

  /** 画 SVG：正交连线 + 条件标签 + 回边虚线（与 toGraph 的确定性布局一致）。 */
  const drawGraph = (): void => {
    const pad = 24
    const nodes = new Map(state.graph.nodes.map(node => [node.id, node]))
    const edges = state.graph.edges.map(edge => {
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
      const label = edge.on === undefined ? '' : `<text class="on" x="${(x1 + x2) / 2 + 6}" y="${mid - 4}">${escapeHtml(edge.on)}${edge.max === undefined ? '' : ` ×${edge.max}`}</text>`
      return `<path class="edge ${edge.kind}" d="${path}" marker-end="url(#arrow)"/>${label}`
    }).join('')
    const boxes = state.graph.nodes.map(node => {
      const selected = node.name === state.selected ? ' sel' : ''
      const kind = node.kind === 'gate' ? ' gate' : ''
      const meta = node.script ?? (node.kind === 'gate' ? '需人确认' : node.kind === 'call' ? '子剧本' : '')
      return `<g data-node="${escapeHtml(node.name)}" style="cursor:pointer">
        <rect class="node${kind}${selected}" x="${node.x + pad}" y="${node.y + pad}" width="${node.width}" height="${node.height}" rx="8"/>
        <text class="label" x="${node.x + pad + 12}" y="${node.y + pad + 22}">${escapeHtml(node.name)}</text>
        <text class="meta" x="${node.x + pad + 12}" y="${node.y + pad + 40}">${escapeHtml(meta)}</text>
      </g>`
    }).join('')
    const width = state.graph.bounds.width + pad * 2
    const height = state.graph.bounds.height + pad * 2
    canvas.innerHTML = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#8a8880"/></marker></defs>${edges}${boxes}</svg>`
    canvas.querySelectorAll<SVGGElement>('g[data-node]').forEach(group => {
      group.addEventListener('click', () => {
        state.selected = group.dataset.node
        render()
      })
    })
  }

  /** 选中节点的表单：字段用 change（失焦才提交），避免重绘打断输入。 */
  const drawForm = (): void => {
    const node = state.flow.nodes.find(item => item.name === state.selected)
    if (node === undefined) {
      form.innerHTML = '<div class="fehint">点左侧节点选中，或在下方源码里编辑。</div>'
      return
    }
    const edgeRows = node.edges.map(edge => `
      <div class="fedge" data-on="${escapeHtml(edge.on ?? '')}">
        <input data-act="edge-on" value="${escapeHtml(edge.on ?? '')}" title="条件" aria-label="条件">
        <span>→</span>
        <select data-act="edge-to" aria-label="目标">${state.flow.nodes.map(item => `<option value="${escapeHtml(item.name)}"${item.name === edge.to ? ' selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select>
        <input data-act="edge-max" type="number" min="1" value="${edge.max ?? ''}" placeholder="max" title="回退上限；留空清除" aria-label="回退上限">
        <button data-act="del-edge" title="删除这条边">×</button>
      </div>`).join('')
    form.innerHTML = `
      <div class="fetitle">节点 · ${escapeHtml(node.kind === 'gate' ? '人闸' : node.kind === 'call' ? '子剧本' : '步骤')}</div>
      <label class="fefield">名称<input data-act="name" value="${escapeHtml(node.name)}"></label>
      <label class="fefield">类型<select data-act="kind">
        <option value="step"${node.kind === 'step' ? ' selected' : ''}>步骤</option>
        <option value="gate"${node.kind === 'gate' ? ' selected' : ''}>人闸（需人确认）</option>
        <option value="call"${node.kind === 'call' ? ' selected' : ''}>子剧本</option>
      </select></label>
      <label class="fefield">脚本<input data-act="script" value="${escapeHtml(node.script ?? '')}" placeholder="scripts/x.mjs"></label>
      <div class="febtns">
        <button data-act="up" title="上移（改变语义顺序）">↑</button>
        <button data-act="down" title="下移（改变语义顺序）">↓</button>
        <button data-act="remove" class="danger">删除节点</button>
      </div>
      <div class="fetitle">条件边 <span class="fehint">回边必须写 max</span></div>
      <div class="fedgelist">${edgeRows || '<div class="fehint">没有条件边，走顺序边。</div>'}</div>
      <button data-act="add-edge" class="wide">+ 条件边</button>`
  }

  /** 右栏详情：只读摘要，编辑在中间栏完成。 */
  const drawDetail = (): void => {
    if (detail === null) return
    const node = state.flow.nodes.find(item => item.name === state.selected)
    if (node === undefined) { detail.innerHTML = '未选中'; return }
    detail.innerHTML = `<dl>
      <dt>名称</dt><dd>${escapeHtml(node.name)}</dd>
      <dt>类型</dt><dd>${node.kind === 'gate' ? '人闸' : node.kind === 'call' ? '子剧本' : '步骤'}</dd>
      <dt>条件边</dt><dd>${node.edges.length} 条</dd>
      <dt>脚本</dt><dd>${node.script === undefined ? '—' : escapeHtml(node.script)}</dd>
    </dl><div class="fehint">在中间栏编辑，改完立刻回写 .flow 源码。</div>`
  }

  const render = (): void => {
    drawGraph()
    drawForm()
    drawDetail()
    // 文本域正在被用户输入时不覆盖光标
    if (document.activeElement !== textarea) textarea.value = state.text
    const changed = state.text !== state.initial ? ' · 已改动' : ''
    const tokens = estimateTokens(renderBody(state.flow))
    el('fe-status').textContent = `${state.flow.nodes.length} 节点 · ${state.graph.edges.length} 边 · ${tokens} token${changed}`
    const compiled = compilePlaybook(state.text)
    const all = [...state.errors, ...state.notes, ...compiled.errors.filter(error => !state.errors.includes(error))]
    el('fe-errors').innerHTML = all.length === 0
      ? '<div class="feok">校验通过 · 可编译成 skill 包</div>'
      : all.map(item => `<div class="feerr">${escapeHtml(item)}</div>`).join('')
  }

  // 工具栏
  bar.addEventListener('click', event => {
    const action = (event.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act
    if (action === 'add-node') {
      const name = fresh('step', candidate => state.flow.nodes.some(node => node.name === candidate))
      const at = state.selected === undefined ? undefined : state.flow.nodes.findIndex(node => node.name === state.selected) + 1
      run({ type: 'node.add', name, ...(at === undefined ? {} : { at }) })
    } else if (action === 'reset') {
      commit(state.initial, ['已还原为初始文本'])
    } else if (action === 'apply') {
      commit(textarea.value, ['已应用源码'])
    } else if (action === 'download') {
      // 浏览器里没有后端写文件；导出让用户把编辑结果落盘，覆盖仓库里的 .flow。
      const blob = new Blob([state.text], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${state.flow.id || 'playbook'}.flow`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 0)
      state = { ...state, notes: ['已导出 .flow 文件'] }
      render()
    }
  })

  // 表单：字段变更（失焦 / 下拉切换）
  form.addEventListener('change', event => {
    const target = event.target as HTMLInputElement | HTMLSelectElement
    const action = target.dataset.act
    const name = state.selected
    if (name === undefined || action === undefined) return
    const row = target.closest<HTMLElement>('[data-on]')
    const on = row?.dataset.on ?? ''
    switch (action) {
      case 'name': run({ type: 'node.rename', name, to: target.value.trim() }); break
      case 'kind': run({ type: 'node.setKind', name, kind: target.value as 'step' | 'gate' | 'call' }); break
      case 'script': run({ type: 'node.setScript', name, script: target.value }); break
      case 'edge-on': run({ type: 'edge.set', from: name, on, newOn: target.value.trim() }); break
      case 'edge-to': run({ type: 'edge.set', from: name, on, to: target.value }); break
      case 'edge-max': run(target.value === ''
        ? { type: 'edge.set', from: name, on, clearMax: true }
        : { type: 'edge.set', from: name, on, max: Number(target.value) }); break
    }
  })

  // 表单：按钮
  form.addEventListener('click', event => {
    const trigger = (event.target as HTMLElement).closest<HTMLElement>('[data-act]')
    const action = trigger?.dataset.act
    const name = state.selected
    if (name === undefined || action === undefined) return
    const row = trigger?.closest<HTMLElement>('[data-on]')
    const on = row?.dataset.on ?? ''
    switch (action) {
      case 'up': run({ type: 'node.move', name, delta: -1 }); break
      case 'down': run({ type: 'node.move', name, delta: 1 }); break
      case 'remove': run({ type: 'node.remove', name }); break
      case 'del-edge': run({ type: 'edge.remove', from: name, on }); break
      case 'add-edge': {
        const condition = fresh('cond', candidate => state.flow.nodes.find(node => node.name === name)?.edges.some(edge => edge.on === candidate) === true)
        const to = state.flow.nodes.find(node => node.name !== name)?.name ?? name
        run({ type: 'edge.add', from: name, on: condition, to })
        break
      }
    }
  })

  // 源码：Ctrl/Cmd + S 应用
  textarea.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      commit(textarea.value, ['已应用源码'])
    }
  })

  render()
}
