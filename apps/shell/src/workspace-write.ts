/**
 * 工作区写入的路径与内容校验（剧本「保存到工作区」用）。
 *
 * 只允许写到用户配置的工作区目录内：拒绝绝对路径、`..` 逃逸、空字节与超大内容。
 * 纯函数，便于单测；真正的 mkdir/write 在 electron-ipc 适配层。
 */
import { isAbsolute, resolve, sep } from 'node:path'

export type WorkspaceWriteCheck =
  | { ok: true; path: string }
  | { ok: false; error: string }

/** 允许写入的扩展名：剧本、文档与配置，不给任意可执行文件开口子。 */
const ALLOWED_EXTENSIONS = ['.flow', '.md', '.json', '.txt', '.yml', '.yaml']
/** 2MB：足够放剧本/Markdown，又不至于把内存写爆。 */
const MAX_BYTES = 2 * 1024 * 1024

/**
 * 校验一次工作区写入。
 * @param base - 工作区根目录（绝对路径）
 * @param relativePath - 用户输入的相对路径
 * @param content - 待写入文本
 */
export function checkWorkspaceWrite(base: string, relativePath: string, content: string): WorkspaceWriteCheck {
  if (typeof relativePath !== 'string' || relativePath.trim() === '') return { ok: false, error: '路径不能为空' }
  if (relativePath.includes('\0')) return { ok: false, error: '路径不能包含空字符' }
  if (isAbsolute(relativePath)) return { ok: false, error: '只允许相对路径' }
  const root = resolve(base)
  const target = resolve(root, relativePath)
  if (target !== root && !target.startsWith(root + sep)) return { ok: false, error: '路径不能越出工作区' }
  const dot = target.lastIndexOf('.')
  const extension = dot < 0 ? '' : target.slice(dot).toLowerCase()
  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    return { ok: false, error: `只允许写入这些扩展名：${ALLOWED_EXTENSIONS.join(', ')}` }
  }
  if (Buffer.byteLength(content, 'utf8') > MAX_BYTES) return { ok: false, error: '内容超过 2MB' }
  return { ok: true, path: target }
}
