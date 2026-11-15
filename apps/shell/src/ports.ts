/**
 * 注入端口（Ports）：主进程核心逻辑只依赖这里的最小接口。
 *
 * 约束：本文件零 electron import、零 DOM、零 node:fs / node:child_process 具体实现。
 * 具体实现由适配层（electron-*.ts）提供，单测里用假实现注入，
 * 因此 node:test 可以直接跑纯模块，不需要 Electron 或 GUI。
 */

/** 日志出口；实现方负责先脱敏（token / key / cookie）再落盘。 */
export interface Logger {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

/** 时间源；注入以便测试用假时钟推进退避，而不真的等待。 */
export interface Clock {
  now(): number
}

/** 异步等待；注入以便测试不真的 sleep。 */
export interface Sleeper {
  sleep(ms: number): Promise<void>
}

/** 文件状态的最小形状。 */
export interface FileStat {
  isFile(): boolean
  mtimeMs: number
  size: number
}

/** 最小文件系统端口；路径均为字符串，文本编码统一 UTF-8。 */
export interface FileSystem {
  readFile(path: string): string
  writeFile(path: string, data: string): void
  exists(path: string): boolean
  mkdir(path: string): void
  readdir(path: string): string[]
  remove(path: string): void
  stat(path: string): FileStat
}

/** 子进程句柄的最小抽象；不暴露 Node 的 EventEmitter 细节。 */
export interface ChildProcessHandle {
  readonly pid: number
  onExit(listener: (code: number | null, signal: string | null) => void): void
  onError(listener: (error: Error) => void): void
  kill(signal?: string): boolean
}

/** 启动子进程；command / args / env 由调用方决定，端口内不内置任何路径。 */
export interface ProcessSpawner {
  spawn(
    command: string,
    args: string[],
    options?: { env?: Record<string, string>; cwd?: string },
  ): ChildProcessHandle
}

/** 健康探测；true 表示宿主已可服务（可换取 API Cookie）。 */
export interface HealthProbe {
  probe(origin: string, token: string): Promise<boolean>
}

/** 端口分配；由 OS 分配空闲端口，避免固定 3080 / 3082 冲突。 */
export interface PortAllocator {
  allocate(): Promise<number>
}

/** Electron safeStorage 的最小抽象（Windows 下即 DPAPI）。 */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Uint8Array
  decryptString(encrypted: Uint8Array): string
}

/** 宿主启动后返回的本机入口信息；token 只在本次进程生命周期有效。 */
export interface HostLaunchInfo {
  port: number
  token: string
  url: string
}
