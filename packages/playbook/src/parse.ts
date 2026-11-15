/**
 * `.flow` 解析器：紧凑文本 → 图模型。
 *
 * 语法（设计目标：人可读、git diff 友好、模型省 token）：
 *
 *   # @ticket-flow v2                ← 剧本 id 与版本
 *   # when 触发条件（一行）
 *   # goal 验收目标（一行）
 *   # budget 可选配额（一行）
 *   # schedule 可选计划（一行，如 daily 09:00:00 Asia/Shanghai）
 *
 *   admit      : deny -> quiet       ← 条件跳转
 *   open-ticket                      ← 顺序步骤
 *   work       : blocked -> escalate (max 3)   ← 回退上限
 *   ?merge                           ← 人闸（需要人确认）
 *   call sub-flow                    ← 子剧本
 *   verify     @scripts/verify.mjs   ← 挂脚本
 *
 * 规则：顺序即边；一行一节点；名字即 id；`#` 开头是头/注释；空行忽略。
 */

/** 一条条件边。 */
export interface FlowEdge {
  /** 触发条件，如 `deny`；省略表示顺序边。 */
  on?: string
  /** 目标节点名。 */
  to: string
  /** 回边最多走几次；未写表示不限制（校验会要求回边必须写）。 */
  max?: number
}

/** 一个节点。 */
export interface FlowNode {
  name: string
  /** `step` 普通步骤；`gate` 需要人确认；`call` 子剧本。 */
  kind: 'step' | 'gate' | 'call'
  /** 子剧本 id（kind === 'call'）。 */
  call?: string
  /** 挂载的脚本相对路径（kind 无关）。 */
  script?: string
  /** 条件边与非顺序边。 */
  edges: FlowEdge[]
  /** 源码行号，供 UI 定位。 */
  line: number
}

/** 一张完整的剧本图。 */
export interface Flow {
  id: string
  version?: string
  when?: string
  goal?: string
  budget?: string
  /** 计划声明（定时交给宿主 schedule 执行；见 schedule.ts）。 */
  schedule?: string
  nodes: FlowNode[]
}

/** 解析结果。 */
export interface ParseResult {
  flow: Flow
  errors: string[]
}

const HEADER = /^#\s*@([A-Za-z0-9_-]+)(?:\s+v(\S+))?\s*$/
const META = /^#\s*(when|goal|budget|schedule)\s+(.+)$/
const SCRIPT = /\s+@(\S+)\s*$/
const EDGE_LIST = /\s*:\s*(.+)$/
const EDGE = /^(.+?)\s*->\s*([A-Za-z0-9_-]+)\s*(?:\(\s*max\s+(\d+)\s*\))?$/

/**
 * 解析一段 `.flow` 文本。
 * @param text - 文件内容
 * @returns 图模型与错误清单（有错误时 flow 仍尽量返回，便于 UI 部分渲染）
 */
export function parseFlow(text: string): ParseResult {
  const errors: string[] = []
  const flow: Flow = { id: '', nodes: [] }
  const seen = new Set<string>()
  const lines = text.split(/\r?\n/)

  lines.forEach((raw, index) => {
    const line = raw.trim()
    if (line === '') return
    const lineNo = index + 1

    if (line.startsWith('#')) {
      const header = HEADER.exec(line)
      if (header !== null) {
        if (flow.id !== '') errors.push(`第 ${lineNo} 行：重复的剧本头 @${header[1]}`)
        flow.id = header[1] ?? ''
        if (header[2] !== undefined) flow.version = header[2]
        return
      }
      const meta = META.exec(line)
      if (meta !== null) {
        const key = meta[1] as 'when' | 'goal' | 'budget' | 'schedule'
        const value = meta[2]?.trim()
        if (value !== undefined && value !== '') flow[key] = value
        return
      }
      return
    }

    let rest = line
    let script: string | undefined
    const scriptMatch = SCRIPT.exec(rest)
    if (scriptMatch !== null) {
      script = scriptMatch[1]
      rest = rest.slice(0, scriptMatch.index).trimEnd()
    }

    // 先剥类型前缀，再统一解析「名称 : 条件边」——人闸与子剧本同样可以带出边。
    let kind: FlowNode['kind'] = 'step'
    let call: string | undefined
    let body = rest
    if (body.startsWith('?')) {
      kind = 'gate'
      body = body.slice(1).trim()
    } else if (body.startsWith('call ')) {
      kind = 'call'
      call = body.slice(5).trim()
      body = call
    }

    const colon = EDGE_LIST.exec(body)
    const nodeName = (colon === null ? body : body.slice(0, colon.index)).trim()
    const edges: FlowEdge[] = []
    if (colon !== null) {
      for (const part of colon[1]!.split('|')) {
        const edge = EDGE.exec(part.trim())
        if (edge === null) {
          errors.push(`第 ${lineNo} 行：无法解析跳转 "${part.trim()}"（应为 条件 -> 目标 (max n)）`)
          continue
        }
        const parsed: FlowEdge = { on: edge[1]!.trim(), to: edge[2]! }
        if (edge[3] !== undefined) parsed.max = Number(edge[3])
        edges.push(parsed)
      }
    }

    if (nodeName === '') {
      errors.push(`第 ${lineNo} 行：节点名为空`)
      return
    }
    if (seen.has(nodeName)) errors.push(`第 ${lineNo} 行：节点重名 "${nodeName}"`)
    seen.add(nodeName)
    if (kind === 'call') call = nodeName
    flow.nodes.push({
      name: nodeName,
      kind,
      edges,
      line: lineNo,
      ...(call === undefined ? {} : { call }),
      ...(script === undefined ? {} : { script }),
    })
  })

  if (flow.id === '') errors.push('缺少剧本头，例如 `# @ticket-flow v1`')
  return { flow, errors }
}

/** 顺序边：节点 i → 节点 i+1（最后一个是终点）。 */
export function sequenceEdges(flow: Flow): Map<string, string> {
  const next = new Map<string, string>()
  for (let i = 0; i < flow.nodes.length - 1; i += 1) {
    next.set(flow.nodes[i]!.name, flow.nodes[i + 1]!.name)
  }
  return next
}
