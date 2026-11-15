/**
 * C9-11：脚本输出协议 `{ok, code, fix, hint}` + `--help` 一行摘要。
 *
 * 对应 docs/PLAYBOOK.md §7.2：脚本「只跑不看」，模型只看到几行结构化结果。
 * 失败要自解释——code 给机器判定、fix 给下一步动作、hint 给人排障，
 * 模型不必读脚本源码、不必翻文档。`--help` 永远只输出一行，供模型判断要不要用。
 *
 * 这里全是纯函数：脚本实现与运行时都 import 同一份，避免两边协议漂移。
 */

/** 统一的脚本输出。附加数据放 `data`，不污染四个固定字段。 */
export interface ScriptOutput {
  ok: boolean
  code: string
  fix?: string
  hint?: string
  data?: Record<string, unknown>
}

/** 常用 code，脚本与运行时共用，避免各写一套字符串。 */
export const CODES = {
  OK: 'OK',
  HELP: 'HELP',
  ETIMEDOUT: 'ETIMEDOUT',
  EPROTOCOL: 'EPROTOCOL',
  EEXEC: 'EEXEC',
  EPATH: 'EPATH',
  EEXT: 'EEXT',
  ECMD: 'ECMD',
  ESHELL: 'ESHELL',
  EIDEMPOTENT: 'EIDEMPOTENT',
} as const

/** 构造成功输出。 */
export function success(data?: Record<string, unknown>): ScriptOutput {
  return { ok: true, code: CODES.OK, ...(data === undefined ? {} : { data }) }
}

/** 构造失败输出，fix/hint 可选。 */
export function failure(
  code: string,
  fields: { fix?: string; hint?: string; data?: Record<string, unknown> } = {},
): ScriptOutput {
  return {
    ok: false,
    code,
    ...(fields.fix === undefined ? {} : { fix: fields.fix }),
    ...(fields.hint === undefined ? {} : { hint: fields.hint }),
    ...(fields.data === undefined ? {} : { data: fields.data }),
  }
}

/** 序列化成一行 JSON（脚本 stdout 只写这一行最稳妥）。 */
export function formatOutput(output: ScriptOutput): string {
  return JSON.stringify(output)
}

/** 判断一个对象是不是合法协议输出。 */
function isScriptOutput(value: unknown): value is ScriptOutput {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.ok === 'boolean' && typeof record.code === 'string'
}

/**
 * 从脚本 stdout 里解析协议输出：逐行找最后一个合法 JSON 对象。
 * 允许脚本先打印别的行，最后一行是协议 JSON。
 */
export function parseOutput(raw: string): ScriptOutput | undefined {
  let found: ScriptOutput | undefined
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (isScriptOutput(parsed)) found = parsed
    } catch {
      // 非 JSON 行跳过
    }
  }
  return found
}

/** 把「没按协议输出」的 stdout 归一化成一个自解释的失败结果。 */
export function coerceOutput(raw: string): ScriptOutput {
  return failure(CODES.EPROTOCOL, {
    fix: '脚本必须输出一行 {ok,code,fix,hint} JSON；不要打印大段实现细节',
    ...(raw.trim() === '' ? {} : { hint: raw.trim().slice(0, 200) }),
  })
}

/** 判断参数里是否带了 `--help` / `-h`。 */
export function isHelp(args: readonly string[]): boolean {
  return args.some(arg => arg === '--help' || arg === '-h')
}

/**
 * 生成 `--help` 的一行摘要。永远单行、有长度上限。
 * @param name - 脚本名
 * @param summary - 一句话说明它做什么、什么时候用
 */
export function helpLine(name: string, summary: string): string {
  const single = `${name} - ${summary}`.replace(/[\r\n]+/g, ' ').trim()
  return single.slice(0, 160)
}
