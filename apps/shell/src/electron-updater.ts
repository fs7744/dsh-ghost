/**
 * 自动更新适配（C5-08 / C6）：只配置 feed 与灰度参数，绝不触发下载/安装/发布。
 * 真实发布、签名、latest.yml 由 CI 流水线负责，本地与未配置 feed 时一律关闭。
 */
import { createRequire } from 'node:module'

// electron-updater 是 CJS，ESM named-import 拿不到 autoUpdater；用 require 取。
const require = createRequire(import.meta.url)

/** 可选依赖：打包时未带 electron-updater 就让更新功能明确关闭，而不是启动失败。 */
function loadAutoUpdater(): typeof import('electron-updater').autoUpdater | undefined {
  try {
    return (require('electron-updater') as typeof import('electron-updater')).autoUpdater
  } catch {
    return undefined
  }
}
import { resolveChannel, shouldOfferUpdate, type ChannelEnv, type UpdateDecision } from './updater.ts'
import type { UpdateChannel } from './config.ts'
import type { Logger } from './ports.ts'

export interface UpdaterDeps {
  channel: UpdateChannel
  currentVersion: string
  installId: string
  rolloutPercent: number
  env: ChannelEnv
  logger: Logger
}

/** 配置更新通道；none 或缺 feed 时 enabled=false，autoDownload/autoInstall 始终关闭。 */
export function configureUpdater(deps: UpdaterDeps): { enabled: boolean; feedUrl: string | null } {
  const resolution = resolveChannel(deps.channel, deps.env)
  if (!resolution.enabled || resolution.feedUrl === null) {
    return { enabled: false, feedUrl: null }
  }
  const autoUpdater = loadAutoUpdater()
  if (autoUpdater === undefined) {
    deps.logger.warn('electron-updater unavailable: updates disabled')
    return { enabled: false, feedUrl: null }
  }
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.setFeedURL({ provider: 'generic', url: resolution.feedUrl, channel: resolution.channel })
  deps.logger.info(`updater channel=${resolution.channel} rollout=${deps.rolloutPercent}`)
  return { enabled: true, feedUrl: resolution.feedUrl }
}

/** 运行时拿到 candidate 元数据后再做灰度判定；此处纯逻辑，不联网。 */
export function evaluateUpdate(
  deps: UpdaterDeps,
  candidateVersion: string,
  candidateChannel: 'stable' | 'beta',
): UpdateDecision {
  return shouldOfferUpdate({
    channel: deps.channel,
    currentVersion: deps.currentVersion,
    candidateVersion,
    candidateChannel,
    rolloutPercent: deps.rolloutPercent,
    installId: deps.installId,
  })
}
