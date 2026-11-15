/**
 * 平台适配：把 Node 内置能力包装成 ports.ts 的最小接口（零 electron import）。
 * 纯模块通过注入拿这些实现；单测用 fakes.ts 的假实现，不碰真实系统。
 */
import {
  readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, statSync,
} from 'node:fs'
import { dirname } from 'node:path'
import { createServer } from 'node:net'
import type {
  Clock, FileSystem, HealthProbe, Logger, PortAllocator, Sleeper,
} from './ports.ts'
import { LOCAL_HOST } from './urls.ts'

export function createClock(): Clock {
  return { now: () => Date.now() }
}

export function createSleeper(): Sleeper {
  return { sleep: ms => new Promise(resolve => setTimeout(resolve, ms)) }
}

export function createFs(): FileSystem {
  return {
    readFile: path => readFileSync(path, 'utf8'),
    writeFile: (path, data) => {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, data, 'utf8')
    },
    exists: path => existsSync(path),
    mkdir: path => mkdirSync(path, { recursive: true }),
    readdir: path => readdirSync(path),
    remove: path => unlinkSync(path),
    stat: path => {
      const s = statSync(path)
      return { isFile: () => s.isFile(), mtimeMs: s.mtimeMs, size: s.size }
    },
  }
}

/** 日志脱敏：把当前会话敏感串（token 等）替换为占位符再输出。 */
export function createLogger(getSecrets: () => readonly string[]): Logger {
  const scrub = (message: string): string => {
    let out = message
    for (const secret of getSecrets()) {
      if (secret.length >= 4) out = out.split(secret).join('***')
    }
    return out
  }
  return {
    info: message => console.log('[shell]', scrub(message)),
    warn: message => console.warn('[shell]', scrub(message)),
    error: message => console.error('[shell]', scrub(message)),
  }
}

/** OS 分配空闲端口：listen(0) 取号后立即释放，避免固定 3080 / 3082 冲突。 */
export function createPortAllocator(): PortAllocator {
  return {
    allocate: () => new Promise<number>((resolve, reject) => {
      const server = createServer()
      server.once('error', reject)
      server.listen(0, LOCAL_HOST, () => {
        const address = server.address()
        const port = typeof address === 'object' && address !== null ? address.port : 0
        server.close(() => resolve(port))
      })
    }),
  }
}

/** 健康探测：打 /connect 换 API Cookie（事件订阅必须 interactions=answer）。 */
export function createHealthProbe(): HealthProbe {
  return {
    async probe(origin, token) {
      try {
        const response = await fetch(
          `${origin}/connect?token=${encodeURIComponent(token)}&interactions=answer`,
          { redirect: 'manual' },
        )
        return response.ok || response.status === 302 || response.type === 'opaqueredirect'
      } catch {
        return false
      }
    },
  }
}
