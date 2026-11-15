/**
 * 编译器：图模型 → 完整 skill 包（`SKILL.md` 等文本件）。
 *
 * 三条硬规则（对应 docs/PLAYBOOK.md §8）：
 *  1. 校验不过就不产出——不允许"写着玩的剧本"上线
 *  2. 常驻的描述必须短（description 是每轮都要付的钱）
 *  3. 模型只看流程图正文；脚本只跑不看
 */
import { parseFlow, sequenceEdges, type Flow } from './parse.ts'

/** 编译选项。 */
export interface CompileOptions {
  /** 判断 `@script` 指向的文件是否存在；不传则跳过该检查。 */
  scriptExists?: (path: string) => boolean
}

/** 一次编译的结果。 */
export interface CompiledPlaybook {
  flow: Flow
  errors: string[]
  /** 相对路径 → 文本内容。 */
  files: Record<string, string>
  /** 常驻成本（description）与按需成本（正文）的估算。 */
  tokens: { description: number; body: number }
}

/** 粗略 token 估算：CJK 按 1 字 1 token，其余按 3.6 字符 1 token。 */
export function estimateTokens(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  return Math.round(cjk + (text.length - cjk) / 3.6)
}

/**
 * 校验图模型。
 * @param flow - 解析结果
 * @param options - 脚本存在性检查
 * @returns 错误清单（空表示通过）
 */
export function validate(flow: Flow, options: CompileOptions = {}): string[] {
  const errors: string[] = []
  const names = new Set(flow.nodes.map(node => node.name))

  if (flow.goal === undefined || flow.goal === '') errors.push('缺少 goal（模型需要知道什么叫"做完了"）')
  if (flow.nodes.length === 0) errors.push('剧本没有任何节点')

  const firstSeen = new Map<string, number>()
  flow.nodes.forEach((node, index) => {
    firstSeen.set(node.name, index)
    for (const edge of node.edges) {
      if (!names.has(edge.to)) errors.push(`节点 "${node.name}" 跳转到不存在的 "${edge.to}"`)
      // 回边（目标出现在当前节点之前）必须写 max，否则可能无限循环。
      const target = firstSeen.get(edge.to)
      if (target !== undefined && target <= index && edge.max === undefined) {
        errors.push(`节点 "${node.name}" 的回边到 "${edge.to}" 没写 (max n)`)
      }
    }
    if (node.kind === 'call' && (node.call === undefined || node.call === '')) {
      errors.push(`节点 "${node.name}" 是子剧本但没写名字`)
    }
    if (node.script !== undefined && options.scriptExists !== undefined && !options.scriptExists(node.script)) {
      errors.push(`节点 "${node.name}" 的脚本不存在：${node.script}`)
    }
  })

  // 可达性：从第一个节点出发，沿顺序边与条件边遍历。
  if (flow.nodes.length > 0) {
    const next = sequenceEdges(flow)
    const reachable = new Set<string>()
    const queue = [flow.nodes[0]!.name]
    while (queue.length > 0) {
      const name = queue.shift()!
      if (reachable.has(name)) continue
      reachable.add(name)
      const successor = next.get(name)
      if (successor !== undefined) queue.push(successor)
      const node = flow.nodes.find(item => item.name === name)
      for (const edge of node?.edges ?? []) queue.push(edge.to)
    }
    for (const node of flow.nodes) {
      if (!reachable.has(node.name)) errors.push(`节点 "${node.name}" 永远走不到`)
    }
  }

  return errors
}

/** 把流程渲染成 SKILL.md 的正文（一行一节点，模型读的就是它）。 */
export function renderBody(flow: Flow): string {
  return flow.nodes
    .map(node => {
      const head = node.kind === 'gate' ? `?${node.name}` : node.kind === 'call' ? `call ${node.call ?? node.name}` : node.name
      const edges = node.edges.length === 0
        ? ''
        : ` : ${node.edges.map(edge => `${edge.on} -> ${edge.to}${edge.max === undefined ? '' : ` (max ${edge.max})`}`).join(' | ')}`
      const script = node.script === undefined ? '' : `  @${node.script}`
      return `${head}${edges}${script}`
    })
    .join('\n')
}

/** 生成 SKILL.md：常驻 description 必须短，正文才是流程图。 */
export function renderSkill(flow: Flow): { description: string; content: string } {
  const goal = flow.goal ?? flow.id
  const trigger = flow.when === undefined ? '' : `；触发：${flow.when}`
  const description = `${goal}${trigger}`.slice(0, 160)
  const content = [
    '---',
    `name: ${flow.id}`,
    `description: ${description}`,
    '---',
    '',
    renderBody(flow),
    '',
  ].join('\n')
  return { description, content }
}

/**
 * 一次编译：解析 → 校验 → 产出文本件。
 * @param text - `.flow` 内容
 * @param options - 编译选项
 */
export function compilePlaybook(text: string, options: CompileOptions = {}): CompiledPlaybook {
  const { flow, errors: parseErrors } = parseFlow(text)
  const errors = [...parseErrors, ...validate(flow, options)]
  const files: Record<string, string> = {}
  let tokens = { description: 0, body: 0 }
  if (errors.length === 0) {
    const skill = renderSkill(flow)
    files['SKILL.md'] = skill.content
    tokens = { description: estimateTokens(skill.description), body: estimateTokens(renderBody(flow)) }
  }
  return { flow, errors, files, tokens }
}
