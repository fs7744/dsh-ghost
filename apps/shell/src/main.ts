/**
 * 主进程装配入口（C5 全条线）：只做组装与生命周期编排，不含业务逻辑。
 *
 * 业务逻辑全在纯模块（config / runtime / diagnostics / onboarding / updater /
 * credentials / single-instance / i18n / telemetry / window-state / static-server），
 * Electron import 只出现在 electron-*.ts / electron-preload.ts。
 *
 * 集成到根脚本的名字：test:shell、verify:shell、build:shell、release:check。
 * 本文件不加载任何远程页面；生产通过本机静态服务加载 apps/desktop/dist。
 */
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { registerSchemes, createShellApp } from './electron-app.ts'
import { createShellWindow, openInfoWindow, type ShellWindowApi } from './electron-window.ts'
import { createTray, type TrayApi } from './electron-tray.ts'
import { buildApplicationMenu } from './electron-menu.ts'
import { registerIpc, showOpenFileDialog } from './electron-ipc.ts'
import { createSafeStorage } from './electron-safe-storage.ts'
import { configureUpdater } from './electron-updater.ts'
import { startStaticServer, type StaticServer } from './electron-static.ts'
import { createHostLauncher } from './electron-host-launcher.ts'
import {
  createClock, createSleeper, createFs, createLogger, createPortAllocator, createHealthProbe,
} from './electron-platform.ts'
import {
  RuntimeController, DEFAULT_BACKOFF, acquireStateLock, releaseStateLock,
} from './runtime.ts'
import { readConfig, writeConfig, mergeConfig, type ShellConfig } from './config.ts'
import { resolveLocale, createTranslator } from './i18n.ts'
import { CredentialVault } from './credentials.ts'
import { TelemetryBuffer } from './telemetry.ts'
import { planSecondInstance } from './single-instance.ts'
import { iconFileFor, isSupportedPlatform, platformLabel, trayIconFileFor } from './platform.ts'
import type { ChannelEnv } from './updater.ts'
import type { DisplayBounds } from './window-state.ts'
import type { FileSystem, HostLaunchInfo } from './ports.ts'

// 必须在 app ready 之前注册自定义协议。
registerSchemes()

const shellApp = createShellApp()

// macOS 的 open-url / open-file 可能在 app ready 之前触发；先入队，等窗口就绪再补发。
const earlyOpenFiles: string[] = []
const earlyDeepLinks: string[] = []
let openFileSink: ((path: string) => void) | undefined
let deepLinkSink: ((url: string) => void) | undefined
shellApp.onOpenFile(path => {
  if (openFileSink === undefined) earlyOpenFiles.push(path)
  else openFileSink(path)
})
shellApp.onOpenUrl(url => {
  if (deepLinkSink === undefined) earlyDeepLinks.push(url)
  else deepLinkSink(url)
})

/**
 * 生产打包路径由 electron-builder 的 files / extraResources 决定。
 *
 * 关键点：运行时不打包进 asar，而是放在 `resources/runtime/node_modules`
 * （见 build/electron-builder.yml 的 extraResources）；这样 bin.js 仍能按
 * 包名解析 `@deepseek-ai/*` 依赖。开发态直接复用 spikes 的安装目录。
 */
function resolvePaths(userData: string, packaged: boolean) {
  const here = fileURLToPath(new URL('.', import.meta.url))
  const repoRoot = join(here, '..', '..', '..')
  // resourcesPath 是 Electron 注入的，@types/node 不认识；这里按最小形状读取。
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? ''
  const iconName = iconFileFor(process.platform)
  const trayIconName = trayIconFileFor(process.platform)
  const runtimeModules = process.env['DSH_GHOST_RUNTIME']
    ?? (packaged
      ? join(resourcesPath, 'runtime', 'node_modules')
      : join(repoRoot, 'spikes', 'p05-transport', 'node_modules'))
  return {
    userData,
    preloadPath: join(here, '..', 'preload.cjs'),
    distDir: join(here, '..', '..', 'desktop', 'dist'),
    onboardingPath: join(here, '..', 'onboarding.html'),
    aboutPath: join(here, '..', 'about.html'),
    // 图标走 extraResources（resources/resources/icon.ico），不在 asar 里。
    iconPath: packaged
      ? join(resourcesPath, 'resources', iconName)
      : join(repoRoot, 'build', 'resources', iconName),
    trayIconPath: packaged
      ? join(resourcesPath, 'resources', trayIconName)
      : join(repoRoot, 'build', 'resources', trayIconName),
    runtimeModules,
    binPath: join(runtimeModules, '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    // 开发态复用 spikes 的 profile（已同步插件）；打包态用独立 DSH_HOME。
    dshHome: process.env['DSH_GHOST_HOME']
      ?? (packaged ? join(userData, 'dsh-home') : join(repoRoot, 'spikes', 'p05-transport', '.dsh-home')),
    profile: process.env['DSH_GHOST_PROFILE'] ?? (packaged ? 'desktop' : 'p05'),
    patchPath: process.env['DSH_GHOST_PATCH'],
    stateDir: join(userData, 'state'),
  }
}

function loadOrCreateInstallId(fs: FileSystem, path: string): string {
  if (fs.exists(path)) return fs.readFile(path).trim()
  const id = randomBytes(16).toString('hex')
  fs.writeFile(path, id)
  return id
}

async function main(): Promise<void> {
  // 单实例：第二实例拿不到锁直接退出，参数由 app 的 second-instance 事件交给第一实例。
  if (!shellApp.requestSingleInstanceLock()) {
    shellApp.quit()
    return
  }
  await shellApp.whenReady()

  if (!isSupportedPlatform(process.platform)) {
    process.stderr.write(`dsh-ghost: unsupported platform ${platformLabel(process.platform)}\n`)
    shellApp.quit()
    return
  }

  const paths = resolvePaths(shellApp.getPath('userData'), shellApp.isPackaged())
  const fs = createFs()
  const clock = createClock()
  fs.mkdir(paths.userData)
  fs.mkdir(paths.stateDir)

  const configPath = join(paths.userData, 'settings.json')
  let config: ShellConfig = readConfig(fs, configPath).config
  const t = createTranslator(resolveLocale(shellApp.getLocale(), config.locale))

  let currentToken = ''
  const logger = createLogger(() => [currentToken])
  const vault = new CredentialVault({ safeStorage: createSafeStorage(), fs, path: configPath, logger })
  const telemetry = new TelemetryBuffer(clock)
  telemetry.setEnabled(config.telemetryEnabled)

  // C5-09 状态锁：避免两个 runtime 同时写同一 state 目录。
  const lockDeps = {
    fs,
    clock,
    pidAlive: (pid: number): boolean => {
      // 锁文件损坏时 holderPid 可能是 -1：process.kill(-1) 在 POSIX 上是「发给进程组」，
      // 不是探测一个进程。非法 pid 一律按已死处理，允许回收锁。
      if (!Number.isInteger(pid) || pid <= 0) return false
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    },
    staleAfterMs: 60_000,
  }
  if (!acquireStateLock(paths.stateDir, process.pid, lockDeps).acquired) {
    logger.error('state directory already in use, quitting')
    shellApp.quit()
    return
  }

  let staticSrv: StaticServer | null = null
  let staticPort = 0
  let shellWindow: ShellWindowApi | null = null
  let tray: TrayApi | null = null
  let runtime: RuntimeController | null = null
  let quitting = false
  let pendingFiles: string[] = shellApp.initialPayload().files
  pendingFiles.push(...earlyOpenFiles.splice(0))
  const pendingDeepLinks: string[] = [...earlyDeepLinks.splice(0)]
  // 渲染层每 3s 报一次票列表；诊断包读这个快照，而不是空占位。
  let ticketCache: unknown = []
  const logBuffer: string[] = []
  // 真实显示器信息由 screen 模块注入（外部依赖）；空数组时 sanitizeBounds 不判离屏。
  const displays: DisplayBounds[] = []

  const getConfig = (): ShellConfig => config
  const setConfig = (next: ShellConfig): void => {
    config = next
  }
  const appInfo = () => ({
    product: shellApp.getVersion(),
    shell: '0.0.0', // 与 apps/shell/package.json 版本一致（release:check 核对）
    electron: process.versions['electron'] ?? 'unknown',
    chromium: process.versions['chrome'] ?? 'unknown',
    node: process.versions['node'] ?? 'unknown',
  })
  const environment = (): Record<string, unknown> => ({
    platform: process.platform,
    arch: process.arch,
    locale: shellApp.getLocale(),
    node: process.versions['node'] ?? 'unknown',
    electron: process.versions['electron'] ?? 'unknown',
    chromium: process.versions['chrome'] ?? 'unknown',
    telemetryEnabled: config.telemetryEnabled,
    crashReportsEnabled: config.crashReportsEnabled,
  })

  const focusWindow = (): void => {
    if (shellWindow === null) return
    shellWindow.restore()
    shellWindow.focus()
  }

  openFileSink = path => {
    if (shellWindow === null) pendingFiles.push(path)
    else shellWindow.send('shell:open-files', [path])
    focusWindow()
  }
  deepLinkSink = url => {
    if (shellWindow === null) pendingDeepLinks.push(url)
    else shellWindow.send('shell:deep-links', [url])
    focusWindow()
  }

  const ensureWindow = async (token: string): Promise<void> => {
    if (shellWindow === null) {
      shellWindow = createShellWindow({
        config,
        staticPort,
        preloadPath: paths.preloadPath,
        iconPath: paths.iconPath,
        displays,
        isQuitting: () => quitting,
      })
      shellWindow.hideMenu()

      const ipc = registerIpc({
        fs, clock, logger, configPath,
        getConfig, setConfig, vault, telemetry,
        currentToken: () => currentToken,
        runtimeState: () => runtime?.getState() ?? 'stopped',
        appInfo,
        logTail: () => logBuffer.slice(-200).join('\n'),
        tickets: () => ticketCache,
        environment,
        onOnboardingFinished: () => {
          void ensureWindow(currentToken)
        },
        onLaunchOnStartupChanged: enabled => shellApp.setLoginItemSettings(enabled),
        setTickets: value => { ticketCache = value },
        workspaceRoot: () => config.workspaceDir !== '' ? config.workspaceDir : join(paths.userData, 'workspace'),
      })

      buildApplicationMenu({
        translate: t,
        onOpenFile: () => {
          void showOpenFileDialog().then(files => {
            if (files.length > 0) shellWindow?.send('shell:open-files', files)
          })
        },
        onDiagnostics: () => {
          void ipc.exportDiagnostics()
        },
        onSettings: () => shellWindow?.send('shell:open-settings', null),
        onAbout: () => openInfoWindow(paths.aboutPath, t),
        onLicenses: () => openInfoWindow(paths.aboutPath, t),
        onReload: () => shellWindow?.reload(),
      })

      try {
        tray = createTray({
        iconPath: paths.trayIconPath,
        template: process.platform === 'darwin',
        translate: t,
        onShow: focusWindow,
        onQuit: () => {
          quitting = true
          shellApp.quit()
        },
        })
      } catch (error) {
        // 无托盘资产/桌面环境（Linux 常见）不影响主窗口。
        process.stderr.write(`dsh-ghost: tray unavailable (${String(error)})\n`)
      }
    }
    if (!config.onboardingCompleted) {
      await shellWindow.loadFile(paths.onboardingPath)
    } else {
      await shellWindow.load(token)
    }
    if (pendingFiles.length > 0) {
      shellWindow.send('shell:open-files', pendingFiles)
      pendingFiles = []
    }
    if (pendingDeepLinks.length > 0) {
      shellWindow.send('shell:deep-links', [...pendingDeepLinks])
      pendingDeepLinks.length = 0
    }
  }

  const onHostReady = async (info: HostLaunchInfo): Promise<void> => {
    currentToken = info.token
    if (staticSrv === null) {
      staticSrv = await startStaticServer({
        distDir: paths.distDir,
        harnessPort: info.port,
        logger,
        modelsFile: join(paths.userData, 'models.json'),
      })
      staticPort = staticSrv.port
    } else {
      // 崩溃重启后宿主端口可能变化，只更新代理目标，不重建静态服务。
      staticSrv.setHarnessPort(info.port)
    }
    await ensureWindow(info.token)
  }

  runtime = new RuntimeController({
    ports: createPortAllocator(),
    launcher: createHostLauncher({
      binPath: paths.binPath,
      dshHome: paths.dshHome,
      profile: paths.profile,
      fromDefaultProfile: !fs.exists(join(paths.dshHome, 'profiles', paths.profile)),
      ...(paths.patchPath === undefined ? {} : { patchPath: paths.patchPath }),
      logger,
      env: {
        WB_BASE_URL: process.env['WB_BASE_URL'] ?? '',
        WB_MODEL: process.env['WB_MODEL'] ?? '',
      },
    }),
    probe: createHealthProbe(),
    clock,
    sleeper: createSleeper(),
    logger,
    policy: DEFAULT_BACKOFF,
    healthAttempts: 30,
    healthIntervalMs: 500,
    onState: state => {
      const line = `runtime state ${state}`
      logBuffer.push(line)
      logger.info(line)
    },
    onReady: info => {
      void onHostReady(info).catch(error => {
        logger.error(`host ready handling failed ${String(error)}`)
        tray?.notify('approval')
      })
    },
    onFatal: error => {
      logger.error(`runtime fatal ${error.message}`)
      tray?.notify('approval') // 宿主不可用，提示用户人工处理
    },
  })

  // 开机启动 / 深链协议 / 更新通道（只配置，不发布）。
  shellApp.setLoginItemSettings(config.launchOnStartup)
  shellApp.setAsDefaultProtocolClient()
  const channelEnv: ChannelEnv = {}
  if (process.env['SHELL_UPDATE_FEED_STABLE'] !== undefined) {
    channelEnv.stableFeed = process.env['SHELL_UPDATE_FEED_STABLE']
  }
  if (process.env['SHELL_UPDATE_FEED_BETA'] !== undefined) {
    channelEnv.betaFeed = process.env['SHELL_UPDATE_FEED_BETA']
  }
  configureUpdater({
    channel: config.updateChannel,
    currentVersion: shellApp.getVersion(),
    installId: loadOrCreateInstallId(fs, join(paths.userData, 'install-id')),
    rolloutPercent: Number(process.env['SHELL_ROLLOUT_PERCENT'] ?? '0'), // 灰度由 CI 注入，默认不放量
    env: channelEnv,
    logger,
  })

  // 第二实例 / open-file / 首启文件关联。
  shellApp.onSecondInstance(payload => {
    for (const action of planSecondInstance(payload)) {
      if (action.kind === 'focus') focusWindow()
      else if (action.kind === 'openFiles') shellWindow?.send('shell:open-files', action.files)
      else if (action.kind === 'navigate') shellWindow?.send('shell:deep-links', action.deepLinks)
    }
  })
  shellApp.onWindowAllClosed(() => {
    // Windows 下关窗隐藏到托盘，不退出进程。
  })
  shellApp.onActivate(() => focusWindow())
  shellApp.onBeforeQuit(() => {
    quitting = true
    runtime?.stop()
    void staticSrv?.close()
    releaseStateLock(paths.stateDir, process.pid, lockDeps)
    if (shellWindow !== null) {
      const bounds = shellWindow.getBounds()
      const merged = mergeConfig(config, { window: bounds })
      if (merged.ok) writeConfig(fs, configPath, merged.value)
    }
    tray?.destroy()
  })

  await runtime.start()
}

void main().catch(error => {
  // 没有这一步，main 里任何同步/异步异常都只会变成一条 unhandled rejection，
  // 用户看到的是「双击没反应」。
  process.stderr.write(`dsh-ghost shell failed: ${String(error)}\n`)
  shellApp.quit()
})
