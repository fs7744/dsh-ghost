/**
 * 剧本编辑器的数据层：UI 操作 → 纯函数编辑 → 回写成 `.flow` 文本。
 *
 * **单向数据流**：文本是唯一真相源。
 * `文本 → parseFlow → applyEdit → stringifyFlow → parseFlow → 渲染`
 * 每一步都从文本重新解析，所以图上看到的和文件里写的永远一致，
 * 不会出现「拖了一下节点、源文件没变」的漂移。
 *
 * 这里不碰 DOM、不碰坐标；布局由 toGraph() 从 Flow 现算。
 */
import { renderBody } from './compile.ts'
import { parseFlow, type Flow, type FlowEdge, type FlowNode } from './parse.ts'

/** 节点名约束：也要能被「条件 -> 目标」的解析器认出来。 */
export const NODE_NAME = /^[A-Za-z0-9_-]+$/

/**
 * Flow → `.flow` 文本（parseFlow 的逆运算）。
 * @param flow - 剧本
 * @returns 可直接写回文件的紧凑文本
 */
export function stringifyFlow(flow: Flow): string {
  const head = [`# @${flow.id}${flow.version === undefined ? '' : ` v${flow.version}`}`]
  if (flow.when !== undefined && flow.when !== '') head.push(`# when ${flow.when}`)
  if (flow.goal !== undefined && flow.goal !== '') head.push(`# goal ${flow.goal}`)
  if (flow.budget !== undefined && flow.budget !== '') head.push(`# budget ${flow.budget}`)
  return `${head.join('\n')}\n\n${renderBody(flow)}\n`
}

/** 一次可撤销的编辑操作（都是数据，方便记录与回放）。 */
export type FlowEdit =
  | { type: 'node.add'; name: string; kind?: FlowNode['kind']; at?: number; script?: string }
  | { type: 'node.remove'; name: string }
  | { type: 'node.rename'; name: string; to: string }
  | { type: 'node.setKind'; name: string; kind: FlowNode['kind'] }
  | { type: 'node.setScript'; name: string; script?: string }
  | { type: 'node.move'; name: string; delta: number }
  | { type: 'edge.add'; from: string; on: string; to: string; max?: number }
  | { type: 'edge.remove'; from: string; on: string }
  | { type: 'edge.set'; from: string; on: string; newOn?: string; to?: string; max?: number; clearMax?: boolean }

/** 编辑结果。`errors` 非空时 flow 保持原样；`notes` 是提示（如连带删除的边）。 */
export interface EditResult {
  flow: Flow
  errors: string[]
  notes: string[]
}

/** 一次编辑 + 文本往返的完整结果。 */
export interface TextEditResult extends EditResult {
  text: string
}

const fail = (flow: Flow, message: string): EditResult => ({ flow, errors: [message], notes: [] })
const done = (flow: Flow, notes: string[] = []): EditResult => ({ flow, errors: [], notes })

/** 深拷贝一份可改的 Flow（编辑是纯函数，不改入参）。 */
function clone(flow: Flow): Flow {
  return { ...flow, nodes: flow.nodes.map(node => ({ ...node, edges: node.edges.map(edge => ({ ...edge })) })) }
}

/** 改名时同步所有指向它的边，避免悬空跳转。 */
function relabel(flow: Flow, from: string, to: string): void {
  for (const node of flow.nodes) {
    if (node.name === from) node.name = to
    for (const edge of node.edges) if (edge.to === from) edge.to = to
  }
}

/**
 * 对剧本应用一次编辑。
 * @param source - 原剧本（不会被修改）
 * @param edit - 编辑操作
 * @returns 新剧本与错误/提示
 */
export function applyEdit(source: Flow, edit: FlowEdit): EditResult {
  const flow = clone(source)
  const find = (name: string): FlowNode | undefined => flow.nodes.find(node => node.name === name)

  switch (edit.type) {
    case 'node.add': {
      if (!NODE_NAME.test(edit.name)) return fail(source, `节点名 "${edit.name}" 只能用字母、数字、- 和 _`)
      if (find(edit.name) !== undefined) return fail(source, `节点 "${edit.name}" 已存在`)
      const kind = edit.kind ?? 'step'
      const node: FlowNode = {
        name: edit.name,
        kind,
        edges: [],
        line: 0,
        ...(kind === 'call' ? { call: edit.name } : {}),
        ...(edit.script === undefined ? {} : { script: edit.script }),
      }
      const at = edit.at === undefined ? flow.nodes.length : Math.max(0, Math.min(edit.at, flow.nodes.length))
      flow.nodes.splice(at, 0, node)
      return done(flow)
    }

    case 'node.remove': {
      const index = flow.nodes.findIndex(node => node.name === edit.name)
      if (index < 0) return fail(source, `节点 "${edit.name}" 不存在`)
      flow.nodes.splice(index, 1)
      let dropped = 0
      for (const node of flow.nodes) {
        const before = node.edges.length
        node.edges = node.edges.filter(edge => edge.to !== edit.name)
        dropped += before - node.edges.length
      }
      return done(flow, dropped > 0 ? [`连带删除 ${dropped} 条指向 "${edit.name}" 的跳转`] : [])
    }

    case 'node.rename': {
      if (!NODE_NAME.test(edit.to)) return fail(source, `节点名 "${edit.to}" 只能用字母、数字、- 和 _`)
      if (find(edit.name) === undefined) return fail(source, `节点 "${edit.name}" 不存在`)
      if (find(edit.to) !== undefined) return fail(source, `节点 "${edit.to}" 已存在`)
      relabel(flow, edit.name, edit.to)
      return done(flow)
    }

    case 'node.setKind': {
      const node = find(edit.name)
      if (node === undefined) return fail(source, `节点 "${edit.name}" 不存在`)
      node.kind = edit.kind
      if (edit.kind === 'call') node.call = node.call ?? node.name
      else delete node.call
      return done(flow)
    }

    case 'node.setScript': {
      const node = find(edit.name)
      if (node === undefined) return fail(source, `节点 "${edit.name}" 不存在`)
      if (edit.script === undefined || edit.script.trim() === '') delete node.script
      else node.script = edit.script.trim()
      return done(flow)
    }

    case 'node.move': {
      const index = flow.nodes.findIndex(node => node.name === edit.name)
      if (index < 0) return fail(source, `节点 "${edit.name}" 不存在`)
      const target = Math.max(0, Math.min(index + edit.delta, flow.nodes.length - 1))
      if (target === index) return done(flow)
      const [node] = flow.nodes.splice(index, 1)
      flow.nodes.splice(target, 0, node!)
      return done(flow)
    }

    case 'edge.add': {
      const node = find(edit.from)
      if (node === undefined) return fail(source, `节点 "${edit.from}" 不存在`)
      if (find(edit.to) === undefined) return fail(source, `目标节点 "${edit.to}" 不存在`)
      if (node.edges.some(edge => edge.on === edit.on)) return fail(source, `条件 "${edit.on}" 已存在`)
      const edge: FlowEdge = { on: edit.on, to: edit.to }
      if (edit.max !== undefined) edge.max = edit.max
      node.edges.push(edge)
      return done(flow)
    }

    case 'edge.remove': {
      const node = find(edit.from)
      if (node === undefined) return fail(source, `节点 "${edit.from}" 不存在`)
      const before = node.edges.length
      node.edges = node.edges.filter(edge => edge.on !== edit.on)
      if (node.edges.length === before) return fail(source, `节点 "${edit.from}" 没有条件 "${edit.on}"`)
      return done(flow)
    }

    case 'edge.set': {
      const node = find(edit.from)
      const edge = node?.edges.find(item => item.on === edit.on)
      if (node === undefined || edge === undefined) return fail(source, `节点 "${edit.from}" 没有条件 "${edit.on}"`)
      if (edit.newOn !== undefined && edit.newOn !== edit.on && node.edges.some(item => item.on === edit.newOn)) {
        return fail(source, `条件 "${edit.newOn}" 已存在`)
      }
      const to = edit.to ?? edge.to
      if (find(to) === undefined) return fail(source, `目标节点 "${to}" 不存在`)
      edge.to = to
      if (edit.newOn !== undefined) edge.on = edit.newOn
      if (edit.clearMax === true) delete edge.max
      else if (edit.max !== undefined) edge.max = edit.max
      return done(flow)
    }
  }
}

/**
 * 按顺序应用多步编辑；某步失败不会中断后面几步，错误会累积返回。
 * @param flow - 原剧本
 * @param edits - 编辑序列
 */
export function applyEdits(flow: Flow, edits: readonly FlowEdit[]): EditResult {
  let current = flow
  const errors: string[] = []
  const notes: string[] = []
  for (const edit of edits) {
    const result = applyEdit(current, edit)
    current = result.flow
    errors.push(...result.errors)
    notes.push(...result.notes)
  }
  return { flow: current, errors, notes }
}

/**
 * UI 用的完整一步：从文本出发，编辑，再回写成新文本并重新解析校验。
 * 只有新文本能被解析且没有编辑错误时才返回新文本；否则原文不变。
 * @param text - 当前 `.flow` 文本（唯一真相源）
 * @param edit - 编辑操作
 */
export function editText(text: string, edit: FlowEdit): TextEditResult {
  const parsed = parseFlow(text)
  if (parsed.errors.length > 0) return { text, flow: parsed.flow, errors: parsed.errors, notes: [] }
  const result = applyEdit(parsed.flow, edit)
  const errors = [...result.errors]
  if (errors.length > 0) return { text, flow: parsed.flow, errors, notes: result.notes }
  const next = stringifyFlow(result.flow)
  const recheck = parseFlow(next)
  return { text: next, flow: recheck.flow, errors: recheck.errors, notes: result.notes }
}

/** 同上，但一次走完多步编辑。 */
export function editTextAll(text: string, edits: readonly FlowEdit[]): TextEditResult {
  let current = text
  const errors: string[] = []
  const notes: string[] = []
  for (const edit of edits) {
    const result = editText(current, edit)
    current = result.text
    errors.push(...result.errors)
    notes.push(...result.notes)
  }
  const parsed = parseFlow(current)
  return { text: current, flow: parsed.flow, errors, notes }
}
