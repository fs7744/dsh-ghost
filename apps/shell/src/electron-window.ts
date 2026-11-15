/**
 * 主窗口适配层（C5-01）：BrowserWindow 创建、CSP 注入、ready-to-show、
 * 只加载本机地址、窗口状态持久化、不加载远程页面。
 */
import { BrowserWindow, session } from 'electron'
import { buildEntryUrl } from './urls.ts'
import { sanitizeBounds } from './window-state.ts'
import { DEFAULT_CONFIG, type ShellConfig, type WindowBounds } from './config.ts'
import type { DisplayBounds } from './window-state.ts'
import type { Translator } from './i18n.ts'

/**
 * 收紧的 CSP：不开放 eval 执行、无远程源；connect 仅同源
 * （静态服务同源代理 /connect 与 /api，事件流 ws 也走同源）。
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join('; ')

export interface WindowDeps {
  config: ShellConfig
  staticPort: number
  preloadPath: string
  iconPath: string
  displays: DisplayBounds[]
  isQuitting(): boolean
}

export interface ShellWindowApi {
  load(token: string): Promise<void>
  loadFile(path: string): Promise<void>
  show(): void
  focus(): void
  restore(): void
  isMinimized(): boolean
  getBounds(): WindowBounds
  hideMenu(): void
  reload(): void
  send(channel: string, payload: unknown): void
}

let cspInstalled = false

function installCsp(): void {
  if (cspInstalled) return
  cspInstalled = true
  session.defaultSession.webRequest.onHeadersReceived((details: any, callback: any) => {
    // 只对本地静态服务响应注入 CSP；file:// 的向导/关于页用本地内联脚本，不注入。
    if (!String(details.url ?? '').startsWith('http://127.0.0.1:')) {
      callback({ responseHeaders: details.responseHeaders })
      return
    }
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CONTENT_SECURITY_POLICY],
      },
    })
  })
}

export function createShellWindow(deps: WindowDeps): ShellWindowApi {
  installCsp()
  const bounds = sanitizeBounds(deps.config.window, DEFAULT_CONFIG.window, deps.displays)
  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    show: false,
    icon: deps.iconPath,
    webPreferences: {
      preload: deps.preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  })

  const localOrigin = `http://127.0.0.1:${deps.staticPort}/`
  // 不加载远程页面：任何离开本机静态服务的导航一律拦下。
  win.webContents.on('will-navigate', (event: any, url: string) => {
    if (!url.startsWith(localOrigin)) event.preventDefault()
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.once('ready-to-show', () => win.show())
  // 关窗隐藏到托盘，只有退出流程才真正销毁（单实例 + 托盘常驻）。
  win.on('close', (event: any) => {
    if (!deps.isQuitting()) {
      event.preventDefault()
      win.hide()
    }
  })

  return {
    load: token => win.loadURL(buildEntryUrl(deps.staticPort, token)),
    loadFile: path => win.loadFile(path),
    show: () => win.show(),
    focus: () => win.focus(),
    restore: () => win.restore(),
    isMinimized: () => win.isMinimized(),
    getBounds: () => win.getBounds(),
    hideMenu: () => win.setMenu(null),
    reload: () => win.webContents.reload(),
    send: (channel, payload) => win.webContents.send(channel, payload),
  }
}

/** 关于 / 第三方许可声明页（C7）：独立小窗口，同样关闭 nodeIntegration、打开 contextIsolation。 */
export function openInfoWindow(filePath: string, translate: Translator): void {
  const win = new BrowserWindow({
    width: 680,
    height: 520,
    title: translate('menu.about'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })
  win.setMenu(null)
  void win.loadFile(filePath)
}
