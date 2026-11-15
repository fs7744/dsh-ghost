/**
 * 平台差异（纯函数）：图标格式、macOS 深链事件、托盘可用性。
 *
 * 不 import electron；process.platform 由调用方注入，单测可直接覆盖三平台。
 */

/** 支持构建/运行的平台；其它平台明确拒绝，而不是静默跑半残。 */
export type ShellPlatform = 'win32' | 'darwin' | 'linux'

/** 应用图标文件名：Windows .ico / macOS .icns / Linux .png。 */
export function iconFileFor(platform: NodeJS.Platform | string): string {
  if (platform === 'darwin') return 'icon.icns'
  if (platform === 'win32') return 'icon.ico'
  return 'icon.png'
}

/**
 * 托盘图标：macOS 用模板图（单色，自动适配深浅色），其余用应用图标。
 * 资产未补齐时返回同名占位路径，由 createTray 的 try/catch 降级为无托盘。
 */
export function trayIconFileFor(platform: NodeJS.Platform | string): string {
  if (platform === 'darwin') return 'trayTemplate.png'
  return iconFileFor(platform)
}

/** 是否支持当前平台（不支持时 main 明确报错退出，而不是黑屏）。 */
export function isSupportedPlatform(platform: NodeJS.Platform | string): platform is ShellPlatform {
  return platform === 'win32' || platform === 'darwin' || platform === 'linux'
}

/** 平台展示名，用于日志与关于页。 */
export function platformLabel(platform: NodeJS.Platform | string): string {
  if (platform === 'darwin') return 'macOS'
  if (platform === 'win32') return 'Windows'
  if (platform === 'linux') return 'Linux'
  return String(platform)
}
