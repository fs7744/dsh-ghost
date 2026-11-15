/**
 * 写入闸门：不是所有对话都能进记忆。
 *
 * 三问（docs/MEMORY.md §2）：
 *  1. 是稳定事实，还是一次性上下文？
 *  2. 下次真的会用到吗？
 *  3. 来源是哪次任务？（没来源 = 无法追溯 = 谣言）
 *
 * 这里只做**可判定的部分**：一次性措辞、缺来源、空内容、超长。
 * "下次会不会用到"是判断，交给模型或人，代码不假装能算。
 */

/** 一次写入请求（UI 与模型都走它）。 */
export interface MemoryWrite {
  /** 条目名，kebab-case，用作文件名。 */
  name: string
  /** 一行标题，进索引。 */
  title?: string
  /** 正文（Markdown）。 */
  text: string
  /** 来源：哪次任务/哪个文件/哪次对话。必填。 */
  source: string
}

/** 判定结果。 */
export interface GateResult {
  ok: boolean
  /** 拒绝原因；ok 为 true 时为空。 */
  reasons: string[]
  /** 命中"一次性"措辞时给出提示，供 UI 展示。 */
  oneShot?: boolean
}

const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/
const ONE_SHOT = /(本次|这次|临时|暂时|今天先|回头再说|临时方案|temporarily|for now|this time)/i
const MAX_TEXT = 8_000

/**
 * 校验一次写入。
 * @param write - 写入请求
 */
export function gate(write: MemoryWrite): GateResult {
  const reasons: string[] = []
  if (!NAME.test(write.name)) reasons.push('名字必须是 kebab-case（小写字母、数字、连字符）')
  if (write.text.trim() === '') reasons.push('正文为空')
  if (write.text.length > MAX_TEXT) reasons.push(`正文超过 ${MAX_TEXT} 字符：拆成条目，别当日记本`)
  if (write.source.trim() === '') reasons.push('缺少来源：没来源的记忆无法追溯，等于谣言')

  // 一次性措辞：不直接拒绝，但要求调用方确认（模型常把临时状态写成长期事实）。
  const oneShot = ONE_SHOT.test(`${write.title ?? ''} ${write.text}`)
  if (oneShot && write.title === undefined) {
    reasons.push('看起来是一次性上下文：请写清它为什么跨会话仍然成立')
  }
  return { ok: reasons.length === 0, reasons, ...(oneShot ? { oneShot } : {}) }
}

/**
 * 从一段对话里挑出**候选**记忆（不做最终判断，只给 UI/模型看）。
 * @param text - 一段对话或任务结论
 * @returns 候选句子（含"以后/总是/约定/不要"等信号词）
 */
export function candidates(text: string): string[] {
  const signal = /(以后|今后|总是|一律|统一|约定|习惯|不要|禁用|必须|默认|from now on|always|never|prefer)/i
  return text
    .split(/(?<=[。！？.!?])\s*/)
    .map(sentence => sentence.trim())
    .filter(sentence => sentence.length > 4 && signal.test(sentence))
    .slice(0, 12)
}
