/**
 * 主进程 IPC 适配：把纯模块能力以最小通道暴露给 preload（contextBridge）。
 * 所有入参在纯模块里做严格校验 / 脱敏，不在适配层写业务逻辑。
 */
import { ipcMain, dialog } from 'electron'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { writeConfig, mergeConfig, type ShellConfig } from './config.ts'
import { collectDiagnostics, type DiagnosticCollector } from './diagnostics.ts'
import { checkWorkspaceWrite } from './workspace-write.ts'
import {
  execGit, fileDiff, listChanges, listConflicts, resolveConflictFile,
} from './git-view.ts'
import type { GitRunner } from '@dsh-ghost/git-view'
import { clipTickets } from './diagnostics.ts'
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
  /** 渲染层把最近一次票列表报给主进程，诊断包用。 */
  setTickets(value: unknown): void
  /** 「保存到工作区」的根目录；空配置时由 main 回退到 userData/workspace。 */
  workspaceRoot(): string
  /** 执行 git 的入口（测试可注入；默认走 execFile，不经 shell）。 */
  git?: GitRunner
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
    const isCredential = step === 'credential'
    onboarding = answerStep(onboarding, step as OnboardingStepId, value)
    // 凭据只进 vault（safeStorage / DPAPI），绝不写 settings.json。
    if (isCredential && onboarding.errors.length === 0) {
      const key = isPlain(value) ? value['apiKey'] : undefined
      if (typeof key === 'string' && key.trim() !== '') {
        const result = deps.vault.set('WB_KEY', key.trim())
        if (!result.stored) {
          // 不阻断向导：凭据可稍后在设置里再填，但要让用户知道没落盘。
          return { step: currentStep(onboarding), errors: [], warning: result.reason }
        }
      }
    }
    return { step: currentStep(onboarding), errors: onboarding.errors }
  })
  ipcMain.handle('onboarding:back', () => {
    onboarding = backStep(onboarding)
    return { step: currentStep(onboarding), errors: onboarding.errors }
  })
  ipcMain.handle('onboarding:finish', () => {
    if (currentStep(onboarding) !== 'done') return { ok: false, reason: 'incomplete' }
    let initial: Partial<ShellConfig>
    try {
      initial = buildInitialConfig(onboarding)
    } catch (error) {
      // 例如 BYOK 缺 key、跳步导致答案不全：返回可读原因，不让 IPC 直接 reject。
      return { ok: false, reason: String(error) }
    }
    const merged = mergeConfig(deps.getConfig(), initial)
    if (!merged.ok) return { ok: false, errors: merged.errors }
    writeConfig(deps.fs, deps.configPath, merged.value)
    deps.setConfig(merged.value)
    deps.onOnboardingFinished()
    return { ok: true, config: merged.value }
  })

  ipcMain.handle('tickets:report', (_event: unknown, value: unknown) => {
    deps.setTickets(clipTickets(value))
    return { ok: true }
  })

  // Git 视图：变更 / 差异 / 冲突 / 解决冲突。只暴露固定操作，不接受任意命令。
  ipcMain.handle('workspace:git', async (_event: unknown, op: unknown, payload: unknown) => {
    const runner = deps.git ?? execGit
    const cwd = deps.workspaceRoot()
    const args = isPlain(payload) ? payload : {}
    try {
      if (op === 'changes') return { ok: true, files: await listChanges(runner, cwd) }
      if (op === 'diff') {
        const path = typeof args.path === 'string' ? args.path : ''
        if (path === '') return { ok: false, error: '缺少 path' }
        return { ok: true, diff: await fileDiff(runner, cwd, path) }
      }
      if (op === 'conflicts') return { ok: true, files: await listConflicts(runner, cwd) }
      if (op === 'resolve') {
        const path = typeof args.path === 'string' ? args.path : ''
        const side = args.side === 'theirs' ? 'theirs' : 'ours'
        if (path === '') return { ok: false, error: '缺少 path' }
        const result = await resolveConflictFile(runner, cwd, path, side)
        return result.ok ? { ok: true } : { ok: false, error: result.error ?? '解决失败' }
      }
      return { ok: false, error: `未知操作：${String(op)}` }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('workspace:save', (_event: unknown, relativePath: string, content: string) => {
    const verdict = checkWorkspaceWrite(deps.workspaceRoot(), relativePath, content)
    if (!verdict.ok) return { ok: false, error: verdict.error }
    try {
      mkdirSync(dirname(verdict.path), { recursive: true })
      const temporary = `${verdict.path}.tmp`
      writeFileSync(temporary, content)
      renameSync(temporary, verdict.path)
      return { ok: true, path: verdict.path }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
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
