/**
 * harness 宿主启动器（适配层）：按真实 CLI 起 `dsh --profile <name> ...`。
 *
 * 关键事实（2026-11-16 实测）：
 * - Electron 主进程的 `process.execPath` 是 electron.exe，必须带
 *   `ELECTRON_RUN_AS_NODE=1` 才会当 Node 跑 bin.js；
 * - harness 对 Electron 指纹有白名单，44.x 只认 44.0.0 / 44.7.0，版本不能随便升；
 * - 它不接受外部注入 token，也不认 `--state-dir` / `--permission-mode`：
 *   DSH_HOME 走环境变量，token 由宿主生成并从 stdout 打印的 URL 里解析。
 */
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import type { ChildProcessHandle, HostLaunchInfo, Logger } from './ports.ts'
import type { HostLaunch, HostLauncher } from './runtime.ts'
import { redactTokenInText, LOCAL_HOST } from './urls.ts'

export interface HostLauncherDeps {
  /** @deepseek-ai/dsh/lib/bin.js 的绝对路径（由打包后的 resources 解析）。 */
  binPath: string
  /** DSH_HOME：宿主 profile / 插件 / 状态都在这下面。 */
  dshHome: string
  /** profile 名；开发态用 p05，打包态应为预先同步过插件的 profile。 */
  profile: string
  /** profile 不存在时用官方 web 模板初始化。 */
  fromDefaultProfile?: boolean
  /** 额外 patch 文件（可重复注入我们的插件）。 */
  patchPath?: string
  /** 宿主工作目录；缺省用 DSH_HOME。 */
  cwd?: string
  logger: Logger
  /** 注入给宿主的额外环境变量（WB_BASE_URL / WB_MODEL 等；密钥不进日志）。 */
  env: Record<string, string>
}

/** 宿主打印的入口 URL，形如 http://127.0.0.1:3917/?token=xxx。 */
const ENTRY_URL = /https?:\/\/127\.0\.0\.1:(\d+)\/\?token=([\w.-]+)/

/** 拼 CLI 参数（纯函数，便于单测；不含 bin 路径本身）。 */
export function buildHostArgs(input: {
  profile: string
  port: number
  fromDefaultProfile?: boolean
  patchPath?: string
}): string[] {
  return [
    '--profile', input.profile,
    ...(input.fromDefaultProfile === true ? ['--from-default-profile', 'web'] : []),
    ...(input.patchPath === undefined ? [] : ['--patch', input.patchPath]),
    '--host', LOCAL_HOST,
    '--port', String(input.port),
    '--no-open',
  ]
}

/** 从宿主输出里解析入口 URL；未打印时返回 undefined（纯函数）。 */
export function parseHostUrl(text: string): { port: number; token: string; url: string } | undefined {
  const match = ENTRY_URL.exec(text)
  if (match === null) return undefined
  const port = Number(match[1])
  const token = match[2]
  if (!Number.isInteger(port) || port <= 0 || token === undefined) return undefined
  return { port, token, url: `http://${LOCAL_HOST}:${port}/?token=${token}` }
}

function wrapChild(child: ReturnType<typeof spawn>): ChildProcessHandle {
  return {
    pid: child.pid ?? -1,
    onExit: listener => child.on('exit', (code, signal) => listener(code, signal === null ? null : String(signal))),
    onError: listener => child.on('error', error => listener(error)),
    kill: () => child.kill(),
  }
}

export function createHostLauncher(deps: HostLauncherDeps): HostLauncher {
  return {
    async launch(port: number): Promise<HostLaunch> {
      const args = [deps.binPath, ...buildHostArgs({
        profile: deps.profile,
        port,
        ...(deps.fromDefaultProfile === true ? { fromDefaultProfile: true } : {}),
        ...(deps.patchPath === undefined ? {} : { patchPath: deps.patchPath }),
      })]
      mkdirSync(deps.dshHome, { recursive: true })
      const child = spawn(process.execPath, args, {
        cwd: deps.cwd ?? deps.dshHome,
        env: {
          ...process.env,
          ...deps.env,
          ELECTRON_RUN_AS_NODE: '1',
          DSH_HOME: deps.dshHome,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      const info = await new Promise<HostLaunchInfo>((resolve, reject) => {
        let buffer = ''
        let settled = false
        const timer = setTimeout(() => {
          if (settled) return
          settled = true
          reject(new Error(`host did not print an entry URL within 120s: ${buffer.slice(-400)}`))
        }, 120_000)
        const finish = (value: HostLaunchInfo): void => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve(value)
        }
        const relay = (chunk: Buffer): void => {
          if (settled) return
          buffer = `${buffer}${chunk.toString('utf8')}`
          if (buffer.length > 64_000) buffer = buffer.slice(-32_000)
          const parsed = parseHostUrl(buffer)
          if (parsed === undefined) return
          // 解析到 token 后，把之前缓存的输出脱敏后补记，避免日志里漏 token。
          for (const line of buffer.split(/\r?\n/)) {
            if (line.trim() !== '') deps.logger.info(redactTokenInText(line.trim(), parsed.token))
          }
          buffer = ''
          finish({ port: parsed.port, token: parsed.token, url: parsed.url })
        }
        child.stdout?.on('data', relay)
        child.stderr?.on('data', relay)
        child.on('error', error => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          reject(error)
        })
        child.on('exit', (code, signal) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          reject(new Error(`host exited before ready: code=${String(code)} signal=${String(signal)}`))
        })
      })

      // 就绪后的输出继续脱敏转发。
      const relayAfter = (chunk: Buffer): void => {
        deps.logger.info(redactTokenInText(chunk.toString('utf8').trim(), info.token))
      }
      child.stdout?.on('data', relayAfter)
      child.stderr?.on('data', relayAfter)
      return { handle: wrapChild(child), info }
    },
  }
}
