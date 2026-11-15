/**
 * 测试用假实现：满足 ports.ts 的最小接口，零 Electron / 零真实子进程 / 零真实时钟。
 * 本文件不是测试文件（不含用例），仅被各 *.test.ts 复用。
 */
import type {
  ChildProcessHandle, Clock, FileStat, FileSystem, HealthProbe, HostLaunchInfo,
  Logger, PortAllocator, SafeStorageLike, Sleeper,
} from '../src/ports.ts'
import type { HostLaunch, HostLauncher } from '../src/runtime.ts'

export class FakeClock implements Clock {
  constructor(public nowMs = 1_000) {}
  now(): number {
    return this.nowMs
  }
}

export class FakeSleeper implements Sleeper {
  readonly waits: number[] = []
  async sleep(ms: number): Promise<void> {
    this.waits.push(ms)
  }
}

export class FakeLogger implements Logger {
  readonly infos: string[] = []
  readonly warns: string[] = []
  readonly errors: string[] = []
  info(message: string): void {
    this.infos.push(message)
  }
  warn(message: string): void {
    this.warns.push(message)
  }
  error(message: string): void {
    this.errors.push(message)
  }
}

export class FakeFs implements FileSystem {
  readonly files = new Map<string, string>()
  readFile(path: string): string {
    const value = this.files.get(path)
    if (value === undefined) throw new Error('ENOENT')
    return value
  }
  writeFile(path: string, data: string): void {
    this.files.set(path, data)
  }
  exists(path: string): boolean {
    return this.files.has(path)
  }
  mkdir(_path: string): void {}
  readdir(_path: string): string[] {
    return []
  }
  remove(path: string): void {
    this.files.delete(path)
  }
  stat(_path: string): FileStat {
    return { isFile: () => true, mtimeMs: 0, size: 0 }
  }
}

export class FakePorts implements PortAllocator {
  value = 41_000
  async allocate(): Promise<number> {
    this.value += 1
    return this.value
  }
}

export class FakeProbe implements HealthProbe {
  readonly calls: string[] = []
  private readonly queue: boolean[]
  constructor(results: readonly boolean[] = []) {
    this.queue = [...results]
  }
  async probe(origin: string, token: string): Promise<boolean> {
    this.calls.push(`${origin}|${token}`)
    return this.queue.shift() ?? true
  }
}

export class FakeProcess implements ChildProcessHandle {
  readonly pid: number
  killed = false
  private readonly exitListeners: Array<(code: number | null, signal: string | null) => void> = []
  private readonly errorListeners: Array<(error: Error) => void> = []
  constructor(pid: number) {
    this.pid = pid
  }
  onExit(listener: (code: number | null, signal: string | null) => void): void {
    this.exitListeners.push(listener)
  }
  onError(listener: (error: Error) => void): void {
    this.errorListeners.push(listener)
  }
  kill(): boolean {
    this.killed = true
    return true
  }
  emitExit(code: number | null = 1): void {
    for (const listener of this.exitListeners) listener(code, null)
  }
  emitError(error: Error): void {
    for (const listener of this.errorListeners) listener(error)
  }
}

export class FakeLauncher implements HostLauncher {
  readonly launches: Array<{ port: number; process: FakeProcess; info: HostLaunchInfo }> = []
  private counter = 0
  async launch(port: number): Promise<HostLaunch> {
    this.counter += 1
    const token = `tk_${this.counter}_FAKE`
    const process = new FakeProcess(2_000 + this.counter)
    const info: HostLaunchInfo = { port, token, url: `http://127.0.0.1:${port}/?token=${token}` }
    this.launches.push({ port, process, info })
    return { handle: process, info }
  }
  get last(): FakeProcess | null {
    const item = this.launches[this.launches.length - 1]
    return item === undefined ? null : item.process
  }
}

/** 可逆的假加密（字节取反），仅用于测试，绝不是真加密。 */
export class FakeSafeStorage implements SafeStorageLike {
  constructor(public available = true) {}
  isEncryptionAvailable(): boolean {
    return this.available
  }
  encryptString(plain: string): Uint8Array {
    return Uint8Array.from(Buffer.from(plain, 'utf8'), b => b ^ 0x5a)
  }
  decryptString(encrypted: Uint8Array): string {
    return Buffer.from(Uint8Array.from(encrypted, b => b ^ 0x5a)).toString('utf8')
  }
}

/** 让已排队的微任务链跑完（崩溃回调是 void async，不阻塞调用方）。 */
export async function settle(): Promise<void> {
  await new Promise<void>(resolve => setImmediate(resolve))
  await new Promise<void>(resolve => setImmediate(resolve))
}
