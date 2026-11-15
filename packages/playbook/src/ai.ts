/**
 * C9-06 / C9-07：AI 生成流程图 与 AI 局部重写。
 *
 * 两条硬要求：
 *  1. **可注入的生成器接口**：默认实现是确定性的模板/规则生成（无需模型、无需 key），
 *     真模型实现只要实现同一个接口即可替换；
 *  2. **产物过同一道校验**：生成/重写的结果一律走 `parseFlow` + `validate`，
 *     非法即抛错，绝不落盘（对应 docs/PLAYBOOK.md §6.3）。
 *
 * 全部纯函数：零 DOM、零网络、零文件读写。
 */
import { parseFlow, type Flow } from './parse.ts'
import { validate } from './compile.ts'
import { editTextAll, type FlowEdit } from './edit.ts'

/** 生成请求：一句自然语言 + 目标。 */
export interface GenerateRequest {
  /** 用户那句话，如「收到 issue 后走一遍验证再回复」。 */
  prompt: string
  /** 剧本 id；缺省用确定性的 ai-flow。 */
  id?: string
  /** 验收目标，写进 `# goal`；缺省用 prompt。 */
  goal?: string
  /** 触发条件，写进 `# when`。 */
  when?: string
}

/** 可注入的生成器：输入请求，输出一段 `.flow` 文本（不负责校验）。 */
export interface FlowGenerator {
  generate(request: GenerateRequest): string
}

/** 选中的局部：节点名，或某节点上的一条条件边。 */
export interface RewriteSelection {
  node?: string
  on?: string
}

/** 局部重写请求：当前文本 + 一句指令 + 选中范围。 */
export interface RewriteRequest {
  text: string
  instruction: string
  selection: RewriteSelection
}

/** 可注入的局部重写器：输入请求，输出改写后的整段 `.flow` 文本。 */
export interface FlowRewriter {
  rewrite(request: RewriteRequest): string
}

/** 生成/重写的合法产物。 */
export interface Generated {
  text: string
  flow: Flow
  /** 恒为空数组：非法产物直接抛错，不会带着错误返回。 */
  errors: string[]
}

/** 关键词 → 额外步骤节点。命中越多，图越长；同样输入必定同样输出。 */
const KEYWORD_STEPS: ReadonlyArray<readonly [RegExp, string]> = [
  [/调研|分析|research|investigate/i, 'research'],
  [/设计|方案|design|plan/i, 'design'],
  [/测试|校验|验证|test|verify/i, 'test'],
  [/评审|审核|review/i, 'review'],
  [/部署|发布|上线|deploy|release/i, 'deploy'],
]

/** 生成合法 id：只保留 `[A-Za-z0-9_-]`，中文 prompt 回落到固定值。 */
function safeId(request: GenerateRequest): string {
  const raw = request.id ?? request.prompt.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  return raw === '' ? 'ai-flow' : raw.slice(0, 40)
}

/** 把单行里的换行压掉，防止 prompt 污染 `.flow` 的头信息行。 */
function oneLine(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').trim()
}

/**
 * 确定性模板生成：不需要模型、不需要 key。
 * 结构固定（顺序链 + 两条带 max 的回边 + 一个人闸），因此**必定**通过校验；
 * 关键词只决定中间插入哪些步骤，不影响合法性。
 */
export const templateGenerator: FlowGenerator = {
  generate(request: GenerateRequest): string {
    const id = safeId(request)
    const goal = oneLine(request.goal ?? request.prompt)
    const when = request.when === undefined ? '入口收到一条待处理请求' : oneLine(request.when)
    const extras = KEYWORD_STEPS.filter(([pattern]) => pattern.test(request.prompt)).map(([, name]) => name)
    // 去重且保持稳定顺序
    const middle = [...new Set(extras)]

    const head = [`# @${id} v1`, `# when ${when}`, `# goal ${goal}`]
    const lines: string[] = ['intake', 'plan', ...middle, 'work        : blocked -> escalate (max 3)',
      'verify      : fail -> work (max 2)', '?check      : reject -> work (max 2)',
      'deliver', 'quiet', 'escalate']
    return `${head.join('\n')}\n\n${lines.join('\n')}\n`
  },
}

/** 从指令里解析「重试几次」：支持「重试两次」的中文数字与阿拉伯数字。 */
function parseTimes(instruction: string): number {
  const arabic = /(\d+)\s*次/.exec(instruction)?.[1] ?? /(?:重试|再试|最多|上限|回退)\s*(\d+)/.exec(instruction)?.[1]
  if (arabic !== undefined) return Math.max(1, Math.min(9, Number(arabic)))
  const chinese: Record<string, number> = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5 }
  for (const [word, value] of Object.entries(chinese)) {
    if (instruction.includes(`${word}次`) || instruction.includes(`重试${word}`)) return value
  }
  return 2
}

/**
 * 确定性局部重写：只改选中节点自身的属性或出边，不增删/改名任何节点。
 * 因此「其它节点 id / 顺序 / 坐标语义」天然保留（坐标由 toGraph 现算，从不落盘）。
 */
export const templateRewriter: FlowRewriter = {
  rewrite(request: RewriteRequest): string {
    const { flow } = parseFlow(request.text)
    const first = flow.nodes[0]?.name
    const target = request.selection.node ?? first
    if (target === undefined) return request.text

    const instruction = request.instruction
    const times = parseTimes(instruction)
    const edits: FlowEdit[] = []
    if (/(人闸|审批|人工|确认|需要人|gate|review)/i.test(instruction)) {
      edits.push({ type: 'node.setKind', name: target, kind: 'gate' })
    } else if (/(脚本|自动|挂|script)/i.test(instruction)) {
      edits.push({ type: 'node.setScript', name: target, script: `scripts/${target}.mjs` })
    } else if (/(重试|回退|失败|再试|最多|超限|retry|back)/i.test(instruction)) {
      // 回退目标取第一个节点：一定是回边（或自身），必须带 max 才合法。
      const back = first ?? target
      const existing = flow.nodes.find(node => node.name === target)?.edges.find(edge => edge.on === 'retry')
      if (existing === undefined) edits.push({ type: 'edge.add', from: target, on: 'retry', to: back, max: times })
      else edits.push({ type: 'edge.set', from: target, on: 'retry', to: back, max: times })
    } else {
      // 无匹配指令时给一个安全的、可见的局部改动。
      edits.push({ type: 'node.setScript', name: target, script: `scripts/${target}.mjs` })
    }
    if (edits.length === 0) return request.text
    return editTextAll(request.text, edits).text
  },
}

/** 统一校验：解析 + 校验，任一错误都抛错（非法即报错，不落盘）。 */
function ensureValid(text: string): Generated {
  const { flow, errors: parseErrors } = parseFlow(text)
  const errors = [...parseErrors, ...validate(flow)]
  if (errors.length > 0) throw new Error(`AI 产物未通过校验：${errors.join('；')}`)
  return { text, flow, errors: [] }
}

/**
 * C9-06：一句话生成一张合法流程图。
 * @param request - 自然语言与目标
 * @param generator - 可注入生成器；缺省为确定性模板实现
 * @throws 产物未通过 `parseFlow` + `validate` 时抛错
 */
export function generateFlow(
  request: GenerateRequest,
  generator: FlowGenerator = templateGenerator,
): Generated {
  return ensureValid(generator.generate(request))
}

/** 比较两个名字数组是否逐项相等。 */
function sameNames(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((name, index) => name === right[index])
}

/**
 * C9-07：只重写局部，并强制守住「其它节点 id / 顺序不变」。
 * @param request - 当前文本 + 指令 + 选中节点
 * @param rewriter - 可注入重写器；缺省为确定性模板实现
 * @throws 产物非法，或改动蔓延到选中节点之外时抛错
 */
export function rewriteFlow(
  request: RewriteRequest,
  rewriter: FlowRewriter = templateRewriter,
): Generated {
  const result = ensureValid(rewriter.rewrite(request))
  const before = parseFlow(request.text).flow
  const selected = request.selection.node
  const beforeNames = before.nodes.map(node => node.name)
  const afterNames = result.flow.nodes.map(node => node.name)
  const strip = (names: readonly string[]): string[] => names.filter(name => name !== selected)
  if (!sameNames(strip(beforeNames), strip(afterNames))) {
    throw new Error('局部重写不得增删或改动选中节点之外的节点（其它节点 id/顺序必须保留）')
  }
  return result
}
