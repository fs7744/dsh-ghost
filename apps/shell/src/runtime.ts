/**
 * runtime 子进程管理（C5-02）与崩溃恢复状态锁（C5-09）。
 *
 * 纯模块：进程启动、健康探测、端口分配、时钟、等待、日志全部经依赖注入，
 * 因此 node:test 可以用假 Electron / 假子进程把状态机跑到底，不需要真实 harness。
 *
 * 设计要点：
 * - 端口由 OS 分配（PortAllocator），避免固定 3080 / 3082 冲突；
 * - 每次 launch 生成新的一次性 token，健康后通过 onReady 注入渲染层；
 * - 崩溃后按指数退避重启，超过 maxRestarts 进入 failed 并 onFatal；
 * - 用 generation 让旧句柄的退出回调失效，配合状态锁避免两个 runtime 同时写同一 state 目录。
 */
import type {
  ChildProcessHandle, Clock, FileSystem, HealthProbe, HostLaunchInfo, Logger,
  PortAllocator, Sleeper,
} from './ports.ts'
import { LOCAL_HOST } from './urls.ts'

export type RuntimeState = 'stopped' | 'starting' | 'healthy' | 'restarting' | 'failed'

export interface BackoffPolicy {
  baseMs: number
  factor: number
  maxMs: number
  maxRestarts: number
}

export const DEFAULT_BACKOFF: BackoffPolicy = {
  baseMs: 500,
  factor: 2,
  maxMs: 30_000,
  maxRestarts: 5,
}

/** 指数退避并封顶；attempt 从 0 起。非法/溢出输入返回 0，不产生 NaN。 */
export function backoffDelay(attempt: number, policy: BackoffPolicy): number {
  const safeAttempt = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0
  const raw = policy.baseMs * Math.pow(policy.factor, safeAttempt)
  if (!Number.isFinite(raw) || raw <= 0) return 0
  return Math.min(policy.maxMs, Math.round(raw))
}

/** 一次宿主启动的产物：进程句柄 + 本机入口信息（含一次性 token）。 */
export interface HostLaunch {
  handle: ChildProcessHandle
  info: HostLaunchInfo
}

/** 由适配层实现：按 OS 分配的端口起 harness / bin.js 并解析出 URL 与 token。 */
export interface HostLauncher {
  launch(port: number): Promise<HostLaunch>
}

export interface RuntimeDeps {
  ports: PortAllocator
  launcher: HostLauncher
  probe: HealthProbe
  clock: Clock
  sleeper: Sleeper
  logger: Logger
  policy: BackoffPolicy
  healthAttempts: number
  healthIntervalMs: number
  onState(state: RuntimeState): void
  onReady(info: HostLaunchInfo): void
  onFatal(error: Error): void
}

export class RuntimeController {
  private state: RuntimeState = 'stopped'
  private restarts = 0
  private current: HostLaunch | null = null
  private stopping = false
  private generation = 0
  private handlingCrash = false

  constructor(private readonly deps: RuntimeDeps) {}

  getState(): RuntimeState {
    return this.state
  }

  getRestartCount(): number {
    return this.restarts
  }

  getCurrentInfo(): HostLaunchInfo | null {
    return this.current?.info ?? null
  }

  private set(next: RuntimeState): void {
    this.state = next
    this.deps.onState(next)
  }

  /** 启动到首次 healthy（或 failed）；后续崩溃由已挂载的退出回调驱动。 */
  async start(): Promise<void> {
    if (this.state !== 'stopped' && this.state !== 'failed') return
    this.stopping = false
    this.restarts = 0
    const ok = await this.startOnce()
    if (!ok && !this.stopping) await this.handleCrash()
  }

  /** 单次启动：分配端口 -> 起宿主 -> 挂崩溃回调 -> 健康检查；返回是否健康。 */
  private async startOnce(): Promise<boolean> {
    const gen = ++this.generation
    this.set('starting')
    let launch: HostLaunch
    try {
      const port = await this.deps.ports.allocate()
      launch = await this.deps.launcher.launch(port)
    } catch (error) {
      // 启动失败（bin 缺失 / 端口分配失败 / spawn 报错）要回到可重试路径，
      // 不能让异常穿出 start() 把状态永远留在 starting。
      this.deps.logger.error(`host launch failed: ${String(error)}`)
      this.current = null
      return false
    }
    this.current = launch
    this.attachCrashHandlers(gen, launch)

    const origin = `http://${LOCAL_HOST}:${launch.info.port}`
    let healthy = false
    for (let i = 0; i < this.deps.healthAttempts; i += 1) {
      if (gen !== this.generation || this.stopping) return false
      try {
        if (await this.deps.probe.probe(origin, launch.info.token)) {
          healthy = true
          break
        }
      } catch {
        // 探测异常视作尚未就绪，继续重试
      }
      if (i + 1 < this.deps.healthAttempts) await this.deps.sleeper.sleep(this.deps.healthIntervalMs)
    }
    if (!healthy) {
      this.deps.logger.warn('host failed health check')
      return false
    }
    if (gen !== this.generation || this.stopping) return false
    this.set('healthy')
    this.deps.onReady(launch.info)
    return true
  }

  private attachCrashHandlers(gen: number, launch: HostLaunch): void {
    launch.handle.onExit((code, signal) => {
      if (gen !== this.generation || this.stopping) return
      this.deps.logger.warn(`host exited code=${String(code)} signal=${String(signal)}`)
      void this.handleCrash()
    })
    launch.handle.onError(error => {
      if (gen !== this.generation || this.stopping) return
      this.deps.logger.error(`host error ${error.message}`)
      void this.handleCrash()
    })
  }

  /**
   * 崩溃恢复循环：退避 -> 重启 -> 健康检查；健康失败继续下一轮，
   * 超过上限进入 failed。handlingCrash 防止 exit/error 双触发造成并发重启。
   */
  private async handleCrash(): Promise<void> {
    if (this.stopping || this.state === 'failed' || this.handlingCrash) return
    this.handlingCrash = true
    try {
      while (!this.stopping) {
        if (this.restarts >= this.deps.policy.maxRestarts) {
          this.set('failed')
          this.deps.onFatal(new Error('runtime exceeded max restarts'))
          return
        }
        const delay = backoffDelay(this.restarts, this.deps.policy)
        this.restarts += 1
        this.set('restarting')
        this.killCurrent()
        await this.deps.sleeper.sleep(delay)
        if (this.stopping) return
        // startOnce 会递增 generation，使旧句柄的退出回调失效
        if (await this.startOnce()) return
      }
    } finally {
      this.handlingCrash = false
    }
  }

  private killCurrent(): void {
    const cur = this.current
    this.current = null
    if (cur !== null) cur.handle.kill()
  }

  /** 主动停止：使所有在途回调失效，杀掉句柄，回到 stopped。 */
  stop(): void {
    this.stopping = true
    this.generation += 1
    this.killCurrent()
    this.set('stopped')
  }
}

// ---------------------------------------------------------------------------
// 状态锁（C5-09）：防止两个 runtime 同时写同一 state 目录；崩溃后 stale 锁可回收。
// ---------------------------------------------------------------------------

export interface StateLockDeps {
  fs: Pick<FileSystem, 'readFile' | 'writeFile' | 'exists' | 'remove'>
  clock: Clock
  pidAlive(pid: number): boolean
  staleAfterMs: number
}

export interface StateLockResult {
  acquired: boolean
  reason: 'acquired' | 'in-use' | 'stale-reclaimed'
}

const LOCK_FILE = 'runtime.lock'

function lockPath(dir: string): string {
  return `${dir.replace(/[/\\]+$/, '')}/${LOCK_FILE}`
}

/** 尝试持有 state 目录锁；已存在且 pid 存活、未过期则拒绝（in-use），否则回收。 */
export function acquireStateLock(dir: string, pid: number, deps: StateLockDeps): StateLockResult {
  const path = lockPath(dir)
  if (deps.fs.exists(path)) {
    let holderPid = -1
    let ts = 0
    try {
      const parsed = JSON.parse(deps.fs.readFile(path)) as { pid?: unknown; ts?: unknown }
      if (typeof parsed.pid === 'number') holderPid = parsed.pid
      if (typeof parsed.ts === 'number') ts = parsed.ts
    } catch {
      // 锁文件损坏：按 stale 处理，允许重建
      holderPid = -1
      ts = 0
    }
    const stale = !deps.pidAlive(holderPid) || deps.clock.now() - ts > deps.staleAfterMs
    if (!stale) return { acquired: false, reason: 'in-use' }
    deps.fs.writeFile(path, JSON.stringify({ pid, ts: deps.clock.now() }))
    return { acquired: true, reason: 'stale-reclaimed' }
  }
  deps.fs.writeFile(path, JSON.stringify({ pid, ts: deps.clock.now() }))
  return { acquired: true, reason: 'acquired' }
}

/** 仅当锁属于自己时才释放，避免误删新 runtime 的锁。 */
export function releaseStateLock(dir: string, pid: number, deps: StateLockDeps): boolean {
  const path = lockPath(dir)
  if (!deps.fs.exists(path)) return false
  try {
    const parsed = JSON.parse(deps.fs.readFile(path)) as { pid?: unknown }
    if (parsed.pid !== pid) return false
    deps.fs.remove(path)
    return true
  } catch {
    return false
  }
}
