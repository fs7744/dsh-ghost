/**
 * 本地 electron 类型占位声明。
 *
 * 背景：本机未安装 electron 包（按约定不 npm install、不启动 Electron），
 * 但 electron 适配层（electron-*.ts / electron-preload.ts）需要 import 'electron'
 * 才能通过 tsc。这里用最小宽松声明补齐符号；运行时由真实 Electron 提供，
 * 具体签名以官方文档为准。
 *
 * 约束：核心纯模块（config / runtime / diagnostics 等）不 import 本模块，
 * 因此不受此处宽松类型影响，仍保持严格类型与依赖注入。
 */
declare module 'electron' {
  export const app: any
  export const BrowserWindow: any
  export const ipcMain: any
  export const ipcRenderer: any
  export const contextBridge: any
  export const session: any
  export const Tray: any
  export const Menu: any
  export const Notification: any
  export const nativeImage: any
  export const safeStorage: any
  export const shell: any
  export const protocol: any
  export const globalShortcut: any
  export const dialog: any
}

declare module 'electron-updater' {
  export const autoUpdater: any
}
