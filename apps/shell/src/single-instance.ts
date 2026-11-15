/**
 * 单实例与深链唤醒（C5-03）、argv / 文件关联解析（C5-06）。
 *
 * 第二实例把命令行参数、dsh-ghost:// 深链、待打开的文件路径交给第一实例；
 * 本模块只做纯粹的解析与动作规划，真实 second-instance / open-file 事件绑定
 * 在 electron-app.ts 适配层。零 electron import、零 DOM。
 */
import { isDeepLink, parseDeepLink, type DeepLinkResult } from './urls.ts'

export interface SecondInstancePayload {
  deepLinks: string[]
  files: string[]
  flags: string[]
  cwd: string
}

/**
 * 解析第二实例 argv。Windows 下 argv[0] 常是 exe 路径，用 execPath 剔除；
 * 以 - 开头视为开关；dsh-ghost:// 视为深链；其余按文件路径候选收集。
 */
export function parseSecondInstanceArgs(
  argv: readonly string[],
  execPath: string,
  cwd: string,
): SecondInstancePayload {
  const payload: SecondInstancePayload = { deepLinks: [], files: [], flags: [], cwd }
  const normalizedExec = execPath.replace(/\\/g, '/').toLowerCase()
  for (const raw of argv) {
    if (raw === '') continue
    const lower = raw.replace(/\\/g, '/').toLowerCase()
    if (lower === normalizedExec) continue
    if (raw.startsWith('-')) {
      payload.flags.push(raw)
    } else if (isDeepLink(raw)) {
      payload.deepLinks.push(raw)
    } else if (looksLikeFilePath(raw)) {
      payload.files.push(raw)
    }
  }
  payload.deepLinks = dedupe(payload.deepLinks)
  payload.files = dedupe(payload.files)
  return payload
}

function looksLikeFilePath(value: string): boolean {
  if (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\') || value.startsWith('/')) return true
  return /\.[A-Za-z0-9]{1,8}$/.test(value)
}

function dedupe(items: readonly string[]): string[] {
  return [...new Set(items)]
}

/** open-file 事件给来的路径去重并过滤空串。 */
export function collectOpenFiles(paths: readonly string[]): string[] {
  return dedupe(paths.filter(p => p !== ''))
}

/** 把转发的深链字符串逐个解析，便于主进程按 action 分发。 */
export function parseForwardedDeepLinks(payload: SecondInstancePayload): DeepLinkResult[] {
  return payload.deepLinks.map(parseDeepLink)
}

export type SecondInstanceAction =
  | { kind: 'focus' }
  | { kind: 'openFiles'; files: string[] }
  | { kind: 'navigate'; deepLinks: string[] }

/** 规划第一实例收到第二实例参数后的动作：先聚焦窗口，再打开文件，再导航深链。 */
export function planSecondInstance(payload: SecondInstancePayload): SecondInstanceAction[] {
  const actions: SecondInstanceAction[] = [{ kind: 'focus' }]
  if (payload.files.length > 0) actions.push({ kind: 'openFiles', files: [...payload.files] })
  if (payload.deepLinks.length > 0) actions.push({ kind: 'navigate', deepLinks: [...payload.deepLinks] })
  return actions
}
