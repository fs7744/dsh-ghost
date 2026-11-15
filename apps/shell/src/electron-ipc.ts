/**
 * 主进程 IPC 适配：把纯模块能力以最小通道暴露给 preload（contextBridge）。
 * 所有入参在纯模块里做严格校验 / 脱敏，不在适配层写业务逻辑。
 */
import { ipcMain, dialog } from 'electron'
import { writeFileSync } from 'node:fs'
import { writeConfig, mergeConfig, type ShellConfig } from './config.ts'
import { collectDiagnostics, type DiagnosticCollector } from './diagnostics.ts'
import {
  createOnboarding, answerStep, backStep, currentStep, buildInitialConfig,
  type OnboardingState, type OnboardingStepId,
} from './onboarding.ts'
import type { CredentialVault } from './credentials.ts'
import type { TelemetryBuffer } from './telemetry.ts'
import type { Clock, FileSystem, Logger } from './ports.ts'

export interface IpcDeps {
  fs: FileSystem
  clock: Clock
  logger: Logger
  configPath: string
  getConfig(): ShellConfig
  setConfig(config: ShellConfig): void
  vault: CredentialVault
  telemetry: TelemetryBuffer
  currentToken(): string
  runtimeState(): string
  appInfo(): { product: string; shell: string; electron: string; chromium: string; node: string }
  logTail(): string
  tickets(): unknown
  environment(): Record<string, unknown>
  onOnboardingFinished(): void
  onLaunchOnStartupChanged(enabled: boolean): void
}

export interface IpcApi {
  exportDiagnostics(): Promise<{ saved: boolean; path?: string; files?: string[] }>
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 诊断导出：菜单与 IPC 共用一份逻辑，保证脱敏口径一致。 */
async function runExportDiagnostics(deps: IpcDeps): Promise<{ saved: boolean; path?: string; files?: string[] }> {
  // 已知敏感值只有当前一次性 token；其余靠正则兜底，导出前零命中。
  const collector: DiagnosticCollector = {
    versions: () => deps.appInfo(),
    logTail: () => deps.logTail(),
    hostHealth: () => ({
      ok: deps.runtimeState() === 'healthy',
      state: deps.runtimeState(),
      port: 0,
      restartCount: 0,
    }),
    tickets: () => deps.tickets(),
    environment: () => deps.environment(),
    knownSecrets: () => [deps.currentToken()],
  }
  const bundle = collectDiagnostics(collector, deps.clock)
  const result = await dialog.showSaveDialog({
    defaultPath: 'dsh-ghost-diagnostics.zip',
    filters: [{ name: 'ZIP', extensions: ['zip'] }],
  })
  if (result.canceled || result.filePath === undefined) return { saved: false }
  writeFileSync(result.filePath, Buffer.from(bundle.zip))
  return { saved: true, path: result.filePath, files: bundle.files.map(f => f.name) }
}

/** 菜单「打开文件」用：返回选择的文件路径列表。 */
export async function showOpenFileDialog(): Promise<string[]> {
  const result = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] })
  return result.canceled ? [] : result.filePaths
}

export function registerIpc(deps: IpcDeps): IpcApi {
  let onboarding: OnboardingState = createOnboarding()

  ipcMain.handle('config:get', () => deps.getConfig())

  ipcMain.handle('config:set', (_event: unknown, patch: unknown) => {
    const merged = mergeConfig(deps.getConfig(), (isPlain(patch) ? patch : {}) as Partial<ShellConfig>)
    if (!merged.ok) return { ok: false, errors: merged.errors }
    writeConfig(deps.fs, deps.configPath, merged.value)
    if (merged.value.launchOnStartup !== deps.getConfig().launchOnStartup) {
      deps.onLaunchOnStartupChanged(merged.value.launchOnStartup)
    }
    deps.setConfig(merged.value)
    return { ok: true, config: merged.value }
  })

  ipcMain.handle('diagnostics:export', () => runExportDiagnostics(deps))
  ipcMain.handle('credentials:set', (_event: unknown, name: string, plain: string) => deps.vault.set(name, plain))
  ipcMain.handle('credentials:get', (_event: unknown, name: string) => deps.vault.get(name))

  ipcMain.handle('onboarding:state', () => ({ step: currentStep(onboarding), errors: onboarding.errors }))
  ipcMain.handle('onboarding:answer', (_event: unknown, step: string, value: unknown) => {
    onboarding = answerStep(onboarding, step as OnboardingStepId, value)
    return { step: currentStep(onboarding), errors: onboarding.errors }
  })
  ipcMain.handle('onboarding:back', () => {
    onboarding = backStep(onboarding)
    return { step: currentStep(onboarding), errors: onboarding.errors }
  })
  ipcMain.handle('onboarding:finish', () => {
    if (currentStep(onboarding) !== 'done') return { ok: false, reason: 'incomplete' }
    const initial = buildInitialConfig(onboarding)
    const merged = mergeConfig(deps.getConfig(), initial)
    if (!merged.ok) return { ok: false, errors: merged.errors }
    writeConfig(deps.fs, deps.configPath, merged.value)
    deps.setConfig(merged.value)
    deps.onOnboardingFinished()
    return { ok: true, config: merged.value }
  })

  ipcMain.handle('app:info', () => deps.appInfo())
  ipcMain.handle('telemetry:export', () => deps.telemetry.export([deps.currentToken()]))
  ipcMain.handle('telemetry:clear', () => {
    deps.telemetry.clear()
    return { ok: true }
  })
  ipcMain.handle('telemetry:set-enabled', (_event: unknown, enabled: boolean) => {
    deps.telemetry.setEnabled(enabled)
    return { ok: true }
  })

  return { exportDiagnostics: () => runExportDiagnostics(deps) }
}
