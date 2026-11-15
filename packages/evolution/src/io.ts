/**
 * 可注入的文件 IO：进化相关模块全靠它落盘，node:test 用内存实现即可跑。
 * 真实实现只负责「目录自动创建 + UTF-8 读写」，不掺任何业务逻辑。
 */
import { access, appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** 进化模块需要的最小文件系统能力。 */
export interface FileIo {
  read(path: string): Promise<string>
  write(path: string, content: string): Promise<void>
  append(path: string, content: string): Promise<void>
  exists(path: string): Promise<boolean>
  /** 列出目录下的直接子项名字（目录不存在返回空数组）。 */
  list(dir: string): Promise<string[]>
}

/** 真实磁盘实现（默认）。 */
export function nodeFileIo(): FileIo {
  return {
    async read(path) {
      return readFile(path, 'utf8')
    },
    async write(path, content) {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, content, 'utf8')
    },
    async append(path, content) {
      await mkdir(dirname(path), { recursive: true })
      await appendFile(path, content, 'utf8')
    },
    async exists(path) {
      try {
        await access(path)
        return true
      } catch {
        return false
      }
    },
    async list(dir) {
      try {
        return await readdir(dir)
      } catch {
        return []
      }
    },
  }
}

/** 内存实现：测试用，`files` 暴露出来便于断言「驳回不落盘」。 */
export interface MemoryFileIo extends FileIo {
  files: Map<string, string>
}

/** 构造内存 IO，可给一份初始文件表。 */
export function memoryFileIo(initial: Readonly<Record<string, string>> = {}): MemoryFileIo {
  const files = new Map<string, string>(Object.entries(initial))
  return {
    files,
    async read(path) {
      const value = files.get(path)
      if (value === undefined) throw new Error(`ENOENT: ${path}`)
      return value
    },
    async write(path, content) {
      files.set(path, content)
    },
    async append(path, content) {
      files.set(path, `${files.get(path) ?? ''}${content}`)
    },
    async exists(path) {
      return files.has(path)
    },
    async list(dir) {
      // 统一按 '/' 归一化，兼容 Windows 的 '\\' 与 POSIX 的 '/'。
      const normalizedPrefix = `${dir.replace(/[\\/]+$/, '').replace(/[\\/]+/g, '/')}/`
      const names = new Set<string>()
      for (const path of files.keys()) {
        const normalized = path.replace(/[\\/]+/g, '/')
        if (!normalized.startsWith(normalizedPrefix)) continue
        const head = normalized.slice(normalizedPrefix.length).split('/')[0]
        if (head !== undefined && head !== '') names.add(head)
      }
      return [...names]
    },
  }
}
