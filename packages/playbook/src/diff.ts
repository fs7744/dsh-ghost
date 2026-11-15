/**
 * C9-05：两版 `.flow` 的结构化 diff 与校验提示。
 *
 * 设计取舍：**文本 diff 为主**（人 review 的是文本，git diff 友好），
 * 结构化 diff 为辅（给 UI 高亮到具体节点/边/条件）。两者都返回条目数组，
 * 前端不必自己再解析一遍文本。
 *
 * 这里是纯函数：零 DOM、零网络、不读写文件，输入两段文本即可。
 */
import { parseFlow, type Flow, type FlowEdge } from './parse.ts'
import { stringifyFlow } from './edit.ts'

/** 一条文本 diff 行。`sign` 沿用统一 diff 的 -/+/空格约定。 */
export interface DiffLine {
  sign: '-' | '+' | ' '
  text: string
  oldLine?: number
  newLine?: number
}

/** 结构化改动的类型。 */
export type DiffChange = 'added' | 'removed' | 'changed'

/** 一条可给 UI 直接展示的结构化改动。 */
export interface DiffEntry {
  category: 'node' | 'edge' | 'meta'
  change: DiffChange
  /** 人话描述，如「新增节点 verify」。 */
  text: string
  /** 定位用：节点名、条件名、meta 字段名。 */
  node?: string
  on?: string
  field?: string
  before?: string
  after?: string
}

/** 一次 diff 的完整结果。 */
export interface FlowDiff {
  entries: DiffEntry[] // 结构化条目（UI 高亮用）
  lines: DiffLine[] // 文本 diff（UI 主展示用）
  summary: { added: number; removed: number; changed: number }
}

/** 把节点渲染成一行，供 before/after 做可读对比。 */
function nodeLabel(node: { kind: string; call?: string; script?: string }): string {
  const bits = [node.kind]
  if (node.call !== undefined) bits.push(`call=${node.call}`)
  if (node.script !== undefined) bits.push(`@${node.script}`)
  return bits.join(',')
}

/** 把边渲染成一行。 */
function edgeLabel(edge: FlowEdge): string {
  return `${edge.on ?? ''} -> ${edge.to}${edge.max === undefined ? '' : ` (max ${edge.max})`}`
}

/** 条件名做 key：解析器与编辑器都以 on 为唯一键。 */
function edgeKey(edge: FlowEdge): string {
  return edge.on ?? ''
}

/**
 * 标准 LCS 行 diff。`.flow` 通常几十行，O(n*m) 足够。
 * 输出顺序稳定：相等行优先，其次删除，其次新增。
 */
function lineDiff(before: readonly string[], after: readonly string[]): DiffLine[] {
  const n = before.length
  const m = after.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0) as number[])
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i]![j] = before[i] === after[j]
        ? dp[i + 1]![j + 1]! + 1
        : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }
  const lines: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      lines.push({ sign: ' ', text: before[i]!, oldLine: i + 1, newLine: j + 1 })
      i += 1
      j += 1
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      lines.push({ sign: '-', text: before[i]!, oldLine: i + 1 })
      i += 1
    } else {
      lines.push({ sign: '+', text: after[j]!, newLine: j + 1 })
      j += 1
    }
  }
  while (i < n) {
    lines.push({ sign: '-', text: before[i]!, oldLine: i + 1 })
    i += 1
  }
  while (j < m) {
    lines.push({ sign: '+', text: after[j]!, newLine: j + 1 })
    j += 1
  }
  return lines
}

const META_KEYS = ['version', 'when', 'goal', 'budget'] as const

/**
 * 比较两版 `.flow` 文本。
 * @param beforeText - 旧版文本
 * @param afterText - 新版文本
 * @returns 结构化条目 + 文本 diff 行 + 汇总计数
 */
export function diffFlows(beforeText: string, afterText: string): FlowDiff {
  const before = parseFlow(beforeText).flow
  const after = parseFlow(afterText).flow
  const entries: DiffEntry[] = []

  // meta：按固定字段顺序，逐字段给一条变更
  for (const key of META_KEYS) {
    const a = before[key]
    const b = after[key]
    if (a === b) continue
    const change: DiffChange = a === undefined ? 'added' : b === undefined ? 'removed' : 'changed'
    entries.push({
      category: 'meta',
      change,
      field: key,
      text: `头信息 ${key} ${change === 'added' ? '新增' : change === 'removed' ? '删除' : '修改'}`,
      ...(a === undefined ? {} : { before: a }),
      ...(b === undefined ? {} : { after: b }),
    })
  }

  const beforeMap = new Map(before.nodes.map(node => [node.name, node]))
  const afterMap = new Map(after.nodes.map(node => [node.name, node]))

  // 节点：按旧顺序判 removed / changed，按新顺序判 added，保证确定性
  for (const node of before.nodes) {
    const other = afterMap.get(node.name)
    if (other === undefined) {
      entries.push({ category: 'node', change: 'removed', node: node.name, text: `删除节点 ${node.name}` })
      continue
    }
    const oldLabel = nodeLabel(node)
    const newLabel = nodeLabel(other)
    if (oldLabel !== newLabel) {
      entries.push({
        category: 'node',
        change: 'changed',
        node: node.name,
        before: oldLabel,
        after: newLabel,
        text: `节点 ${node.name} 属性变化：${oldLabel} → ${newLabel}`,
      })
    }
    // 该节点的条件边对比
    const oldEdges = new Map(node.edges.map(edge => [edgeKey(edge), edge]))
    const newEdges = new Map(other.edges.map(edge => [edgeKey(edge), edge]))
    for (const edge of node.edges) {
      const counterpart = newEdges.get(edgeKey(edge))
      if (counterpart === undefined) {
        entries.push({
          category: 'edge',
          change: 'removed',
          node: node.name,
          ...(edge.on === undefined ? {} : { on: edge.on }),
          text: `节点 ${node.name} 删除条件边 ${edgeLabel(edge)}`,
        })
      } else if (edgeLabel(edge) !== edgeLabel(counterpart)) {
        entries.push({
          category: 'edge',
          change: 'changed',
          node: node.name,
          ...(edge.on === undefined ? {} : { on: edge.on }),
          before: edgeLabel(edge),
          after: edgeLabel(counterpart),
          text: `节点 ${node.name} 条件边 ${edge.on ?? ''} 修改：${edgeLabel(edge)} → ${edgeLabel(counterpart)}`,
        })
      }
    }
    for (const edge of other.edges) {
      if (oldEdges.has(edgeKey(edge))) continue
      entries.push({
        category: 'edge',
        change: 'added',
        node: node.name,
        ...(edge.on === undefined ? {} : { on: edge.on }),
        text: `节点 ${node.name} 新增条件边 ${edgeLabel(edge)}`,
      })
    }
  }

  for (const node of after.nodes) {
    if (beforeMap.has(node.name)) continue
    entries.push({ category: 'node', change: 'added', node: node.name, text: `新增节点 ${node.name}` })
    for (const edge of node.edges) {
      entries.push({
        category: 'edge',
        change: 'added',
        node: node.name,
        ...(edge.on === undefined ? {} : { on: edge.on }),
        text: `节点 ${node.name} 新增条件边 ${edgeLabel(edge)}`,
      })
    }
  }

  const lines = lineDiff(beforeText.split(/\r?\n/), afterText.split(/\r?\n/))
  const summary = {
    added: entries.filter(entry => entry.change === 'added').length,
    removed: entries.filter(entry => entry.change === 'removed').length,
    changed: entries.filter(entry => entry.change === 'changed').length,
  }
  return { entries, lines, summary }
}

/** 只取文本 diff 的可打印形式（`git diff` 风格的一行一条）。 */
export function formatDiff(diff: FlowDiff): string[] {
  return diff.lines.map(line => `${line.sign}${line.text}`)
}

/** 便捷封装：直接比较 parse 后的 Flow（UI 内存里已有图对象时用）。 */
export function diffFlowTexts(before: Flow, after: Flow): FlowDiff {
  return diffFlows(stringifyFlow(before), stringifyFlow(after))
}
