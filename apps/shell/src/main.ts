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
import { createShellWindow, openInfoWindow, openFatalWindow, type ShellWindowApi } from './electron-window.ts'
import { createTray, type TrayApi } from './electron-tray.ts'
import { buildApplicationMenu } from './electron-menu.ts'
import { registerIpc, showOpenFileDialog } from './electron-ipc.ts'
import { createSafeStorage } from './electron-safe-storage.ts'
import { configureUpdater } from './electron-updater.ts'
import { startStaticServer, type StaticServer } from './electron-static.ts'
import { createLlmBalancer } from './llm-balancer.ts'
import { createFileCatalogStore } from './models-store.ts'
import { createHostLauncher } from './electron-host-launcher.ts'
import { materializeHostProfile } from './host-profile.ts'
import { readProxyEnv } from './proxy-env.ts'
import { createPairingStore } from './extension-pairing.ts'
import { LOCAL_HOST } from './urls.ts'
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
    // profile 名不能叫 desktop：harness 把这个名字留给自家 Electron 载体，
    // 从 CLI 启动会被直接拒绝（"managed exclusively by the Electron application"）。
    // 我们自己物化 profile（见 host-profile.ts），用产品自己的名字。
    profile: process.env['DSH_GHOST_PROFILE'] ?? (packaged ? 'ghost' : 'p05'),
    patchPath: process.env['DSH_GHOST_PATCH'],
    // 我们自己的插件层模板：开发态在仓库里，打包态随包进 asar。
    // 两条路径用同一个相对位置（here = <root>/apps/shell/dist/），
    // 所以开发态指向 <repo>/scripts/，打包态指向 app.asar/scripts/。
    patchTemplatePath: join(here, '..', '..', '..', 'scripts', 'cordis.patch.template.yml'),
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
  const modelsFile = join(paths.userData, 'models.json')

  /**
   * 本地 LLM 负载均衡代理。有多个启用的 OpenAI 兼容服务时才启用，
   * 作为 wb provider 的 baseURL 注入 patch —— harness 仍只认一个 provider，
   * 实际请求由这里按策略分发到多个真实服务。开发态模型库是 demo，不启动。
   */
  const balancer = shellApp.isPackaged()
    ? await createLlmBalancer({
      modelsFile,
      getCredential: name => {
        const secret = vault.get(name)
        return secret === null ? undefined : secret
      },
      fallbackBaseURL: process.env['WB_BASE_URL'] ?? '',
      fallbackModel: process.env['WB_MODEL'] ?? '',
      logger,
    })
    : undefined
  const effectiveBaseUrl = balancer?.baseURL ?? (process.env['WB_BASE_URL'] ?? '')

  // 打包态先把宿主 profile 物化出来（manifest + 我们自己的插件层）。
  // 不做这一步，harness 会因为 profile 不存在直接退出，壳就永远等不到宿主，
  // 结果是「只有后台进程、没有窗口」。
  if (shellApp.isPackaged()) {
    const profile = materializeHostProfile({
      dshHome: paths.dshHome,
      profile: paths.profile,
      runtimeModules: paths.runtimeModules,
      userData: paths.userData,
      templatePath: paths.patchTemplatePath,
      baseUrl: effectiveBaseUrl,
      model: process.env['WB_MODEL'] ?? '',
    })
    if (!profile.ok) {
      process.stderr.write(`dsh-ghost: ${profile.error ?? 'profile 物化失败'}\n`)
      openFatalWindow('dsh-ghost 无法启动', profile.error ?? '宿主 profile 物化失败')
      shellApp.quit()
      return
    }
  }

  /**
   * 把界面登记的每个服务的 apiKeyEnv 引用名映射到 vault 里的明文，注入宿主进程环境。
   * 只在启动时求值：密钥存的是引用名，真正的值由宿主按 env 名读取；明文绝不经配置或日志。
   */
  const modelCredentialEnv = (): Record<string, string> => {
    const catalog = createFileCatalogStore(modelsFile)
    let env: Record<string, string> = {}
    try {
      // 文件版 store 的 read 是同步的（CatalogStore 接口允许异步，这里确定是同步实现）。
      const state = catalog.read() as { providers: readonly { apiKeyEnv: string }[] }
      for (const provider of state.providers) {
        const secret = vault.get(provider.apiKeyEnv)
        if (secret !== null && secret !== '') env[provider.apiKeyEnv] = secret
      }
    } catch {
      env = {}
    }
    return env
  }

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
    // 无边框窗口（Windows / Linux）：界面要把侧栏头部标成拖动区。
    frameless: process.platform !== 'darwin',
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
        issuePairingCode: () => pairing.issue(),
        // 无边框窗口：界面自己的窗口按钮。
        windowAction: action => {
          if (shellWindow === null) return
          if (action === 'minimize') shellWindow.minimize()
          else if (action === 'maximize') shellWindow.toggleMaximize()
          else shellWindow.close()
        },
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
    // 首启不再弹向导：直接进工作台。模型 / 密钥 / 职责等配置都放在「模型库」页与设置里，
    // 随用随改，不必在第一次启动时一次性填完（见 docs/MODELS.md）。
    await shellWindow.load(token)
    if (pendingFiles.length > 0) {
      shellWindow.send('shell:open-files', pendingFiles)
      pendingFiles = []
    }
    if (pendingDeepLinks.length > 0) {
      shellWindow.send('shell:deep-links', [...pendingDeepLinks])
      pendingDeepLinks.length = 0
    }
  }

  // 浏览器扩展配对：应用里出 6 位码，扩展输入后换到宿主地址与 Cookie（token 不出壳）。
  const pairing = createPairingStore()
  let harnessPortNow = 0

  const pairExtension = async (code: string): Promise<
    { origin: string; cookieName: string; cookieValue: string; cwd: string } | undefined
  > => {
    if (!pairing.verify(code)) return undefined
    const port = harnessPortNow
    if (port === 0) return undefined
    const origin = `http://${LOCAL_HOST}:${port}`
    try {
      const response = await fetch(`${origin}/connect?token=${encodeURIComponent(currentToken)}&interactions=answer`, {
        redirect: 'manual',
      })
      const raw = (response.headers.getSetCookie?.() ?? []).map(value => value.split(';')[0]).join('; ')
      if (raw === '') return undefined
      const [cookieName = '', ...rest] = raw.split('=')
      const cookieValue = rest.join('=')
      if (cookieName === '') return undefined
      const cwd = config.workspaceDir !== '' ? config.workspaceDir : join(paths.userData, 'workspace')
      return { origin, cookieName, cookieValue, cwd }
    } catch {
      return undefined
    }
  }

      const onHostReady = async (info: HostLaunchInfo): Promise<void> => {
    currentToken = info.token
    harnessPortNow = info.port
    if (staticSrv === null) {
      staticSrv = await startStaticServer({
        distDir: paths.distDir,
        harnessPort: info.port,
        logger,
        modelsFile,
        // 与宿主的 ghost-ui 插件同一路径：模型库保存后立即反映到 cordis patch。
        providersFile: join(paths.userData, 'ghost', 'ui', 'providers.json'),
        getCredential: name => {
          const secret = vault.get(name)
          return secret === null ? undefined : secret
        },
        pairExtension,
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
        // 界面登记的服务密钥：从安全存储取出，按各自 apiKeyEnv 引用名注入宿主。
        ...modelCredentialEnv(),
        WB_BASE_URL: process.env['WB_BASE_URL'] ?? '',
        WB_MODEL: process.env['WB_MODEL'] ?? '',
        // 权限档位：宿主的 sandbox-policy 与 user-approval 策略在加载 patch 时读它。
        // 引导页问过用户，却一直没传过去——这里补上，用户的选择才真正生效。
        DSH_PERMISSION_MODE: config.approvalPreset,
        // 用户在界面里登记的代理：宿主 dsh-http-proxy 读这些 env。
        ...readProxyEnv(config.workspaceDir !== '' ? config.workspaceDir : join(paths.userData, 'workspace')),
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
      // 宿主彻底起不来：必须给用户一个能看见的窗口，否则表现就是「双击没反应」。
      openFatalWindow(
        'dsh-ghost 启动失败',
        `本地宿主（harness）没能启动：${error.message}`,
        logBuffer.join('\n'),
      )
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
    void balancer?.close()
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
