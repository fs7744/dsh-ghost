/**
 * harness 宿主启动器（适配层）：按与 scripts/lib-driver.mjs / dev-ui.mjs 同样的
 * 参数起 @deepseek-ai/dsh 的 bin.js，并生成一次性 token 注入渲染层。
 *
 * 外部依赖（P3 §8.5 前置核对）：bin.js 的真实命令行参数、token 是宿主自生成
 * 还是接受外部注入，需按真实 harness 实测对接。本骨架用环境变量 DSH_CONNECT_TOKEN
 * 注入壳生成的一次性 token；stdout 仅用于脱敏后的日志，不解析 URL。
 * 桌面 UI 用 permissionMode='workspace-write' 保留人工审批。
 */
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import type { ChildProcessHandle, HostLaunchInfo, Logger } from './ports.ts'
import type { HostLaunch, HostLauncher } from './runtime.ts'
import { buildEntryUrl, redactTokenInText, LOCAL_HOST } from './urls.ts'

export interface HostLauncherDeps {
  /** @deepseek-ai/dsh/lib/bin.js 的绝对路径（由打包后的 resources 解析）。 */
  binPath: string
  stateDir: string
  permissionMode: string
  logger: Logger
  /** 注入给宿主的额外环境变量（WB_BASE_URL / WB_MODEL 等；密钥不进日志）。 */
  env: Record<string, string>
}

function newToken(): string {
  // base64url 全为 URL 安全字符，满足 urls.isSafeToken。
  return randomBytes(24).toString('base64url')
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
      const token = newToken()
      const args = [
        deps.binPath,
        '--host', LOCAL_HOST,
        '--port', String(port),
        '--state-dir', deps.stateDir,
        '--permission-mode', deps.permissionMode,
      ]
      const child = spawn(process.execPath, args, {
        // Electron 主进程里 process.execPath 是 electron.exe，不是 node：
        // 不加这个变量会把 bin.js 当成第二个 Electron 应用的入口。
        // 代价是宿主跑在 Electron 内置 Node 上，原生模块 ABI 需按 §8.5 实测。
        env: {
          ...process.env,
          ...deps.env,
          ELECTRON_RUN_AS_NODE: '1',
          DSH_CONNECT_TOKEN: token,
          DSH_PORT: String(port),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const relay = (chunk: Buffer): void => {
        deps.logger.info(redactTokenInText(chunk.toString('utf8').trim(), token))
      }
      child.stdout?.on('data', relay)
      child.stderr?.on('data', relay)

      const info: HostLaunchInfo = {
        port,
        token,
        url: buildEntryUrl(port, token),
      }
      return { handle: wrapChild(child), info }
    },
  }
}
