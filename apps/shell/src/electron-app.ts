/**
 * Electron app 适配层：单实例锁、协议注册、系统事件、开机启动、argv/深链解析。
 * 只有 electron-*.ts 允许 import 'electron'；main.ts 通过这里的接口装配。
 */
import { app, protocol, shell } from 'electron'
import { parseSecondInstanceArgs, type SecondInstancePayload } from './single-instance.ts'
import { DEEP_LINK_SCHEME } from './urls.ts'

export interface ShellAppApi {
  whenReady(): Promise<void>
  requestSingleInstanceLock(): boolean
  getPath(name: 'userData' | 'home' | 'appData' | 'temp' | 'logs' | 'exe'): string
  getVersion(): string
  getLocale(): string
  /** 是否运行在打包后的安装目录（决定 resources 路径与运行时位置）。 */
  isPackaged(): boolean
  quit(): void
  setLoginItemSettings(enabled: boolean): void
  setAsDefaultProtocolClient(): void
  onSecondInstance(handler: (payload: SecondInstancePayload) => void): void
  onOpenFile(handler: (path: string) => void): void
  /** macOS 深链走 open-url，不是 second-instance。 */
  onOpenUrl(handler: (url: string) => void): void
  onActivate(handler: () => void): void
  onBeforeQuit(handler: () => void): void
  onWindowAllClosed(handler: () => void): void
  openExternal(url: string): void
  initialPayload(): SecondInstancePayload
}

/** 必须在 app ready 之前调用：把 dsh-ghost 注册为安全/标准的自定义协议。 */
export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: DEEP_LINK_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ])
}

export function createShellApp(): ShellAppApi {
  return {
    whenReady: () => app.whenReady(),
    requestSingleInstanceLock: () => app.requestSingleInstanceLock(),
    getPath: name => app.getPath(name),
    getVersion: () => app.getVersion(),
    getLocale: () => app.getLocale(),
    isPackaged: () => app.isPackaged,
    quit: () => app.quit(),
    setLoginItemSettings: enabled => {
      // Linux 无「登录项」概念；平台不支持时静默降级，不让设置页崩。
      try { app.setLoginItemSettings({ openAtLogin: enabled }) } catch { /* unsupported */ }
    },
    setAsDefaultProtocolClient: () => {
      try { app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME) } catch { /* unsupported */ }
    },
    openExternal: url => {
      void shell.openExternal(url)
    },
    initialPayload: () => parseSecondInstanceArgs(process.argv, process.execPath, process.cwd()),
    onSecondInstance: handler => {
      app.on('second-instance', (_event: unknown, argv: string[], cwd: string) => {
        handler(parseSecondInstanceArgs(argv, process.execPath, cwd))
      })
    },
    onOpenFile: handler => {
      app.on('open-file', (event: { preventDefault(): void }, path: string) => {
        event.preventDefault()
        handler(path)
      })
    },
    onOpenUrl: handler => {
      app.on('open-url', (event: { preventDefault(): void }, url: string) => {
        event.preventDefault()
        handler(url)
      })
    },
    onActivate: handler => app.on('activate', handler),
    onBeforeQuit: handler => app.on('before-quit', handler),
    onWindowAllClosed: handler => app.on('window-all-closed', handler),
  }
}
