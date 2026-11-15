/**
 * 桌面壳配置（C5-01/05/08/12/13 与 C7）：schema、默认值、迁移、非法值拒绝、读写。
 * 纯模块；文件系统通过 FileSystem 端口注入，单测用假实现。
 */
import type { FileSystem } from './ports.ts'

export const CONFIG_VERSION = 1

export type LocaleSetting = 'system' | 'zh-CN' | 'en-US'
export type UpdateChannel = 'stable' | 'beta' | 'none'
export type ApprovalPreset = 'workspace-write' | 'danger-full-access' | 'read-only'
export type ModelSource = 'byok' | 'local' | 'deepseek-account'

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface ShellConfig {
  version: number
  locale: LocaleSetting
  launchOnStartup: boolean
  updateChannel: UpdateChannel
  telemetryEnabled: boolean
  crashReportsEnabled: boolean
  approvalPreset: ApprovalPreset
  modelSource: ModelSource
  workspaceDir: string
  infoSources: Record<string, boolean>
  onboardingCompleted: boolean
  window: WindowBounds
}

/** 默认值：遥测/崩溃上报默认关闭，桌面 UI 保留人工审批（workspace-write）。 */
export const DEFAULT_CONFIG: ShellConfig = {
  version: CONFIG_VERSION,
  locale: 'system',
  launchOnStartup: false,
  updateChannel: 'stable',
  telemetryEnabled: false,
  crashReportsEnabled: false,
  approvalPreset: 'workspace-write',
  modelSource: 'byok',
  workspaceDir: '',
  infoSources: {},
  onboardingCompleted: false,
  window: { x: 100, y: 100, width: 1280, height: 800 },
}

const LOCALES: readonly string[] = ['system', 'zh-CN', 'en-US']
const CHANNELS: readonly string[] = ['stable', 'beta', 'none']
const APPROVALS: readonly string[] = ['workspace-write', 'danger-full-access', 'read-only']
const MODEL_SOURCES: readonly string[] = ['byok', 'local', 'deepseek-account']
const KNOWN_KEYS: readonly string[] = Object.keys(DEFAULT_CONFIG)
/** 旧版本字段别名 -> 当前字段，用于 v0 配置迁移。 */
const ALIASES: Record<string, string> = {
  lang: 'locale',
  autoStart: 'launchOnStartup',
  channel: 'updateChannel',
  permissionMode: 'approvalPreset',
  workdir: 'workspaceDir',
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

function isStringEnum(value: unknown, allowed: readonly string[]): value is string {
  return typeof value === 'string' && allowed.includes(value)
}

function isBoolRecord(value: unknown): value is Record<string, boolean> {
  return isPlainObject(value) && Object.values(value).every(v => typeof v === 'boolean')
}

function isBounds(value: unknown): value is WindowBounds {
  if (!isPlainObject(value)) return false
  const { x, y, width, height } = value
  const nums = [x, y, width, height]
  if (!nums.every(n => typeof n === 'number' && Number.isFinite(n))) return false
  return typeof width === 'number' && width > 0 && typeof height === 'number' && height > 0
}

function cloneDefault(): ShellConfig {
  return { ...DEFAULT_CONFIG, infoSources: { ...DEFAULT_CONFIG.infoSources }, window: { ...DEFAULT_CONFIG.window } }
}

export type ValidationResult =
  | { ok: true; value: ShellConfig }
  | { ok: false; errors: string[] }

/**
 * 严格校验：缺字段用默认补齐；存在但类型/枚举非法则记入 errors 并整体拒绝。
 * 用于写入前校验与首启向导产出校验（非法值拒绝，不静默接受）。
 */
export function validateConfig(raw: unknown): ValidationResult {
  if (!isPlainObject(raw)) return { ok: false, errors: ['config-not-object'] }
  const errors: string[] = []
  const value: ShellConfig = cloneDefault()

  if (hasOwn(raw, 'version')) {
    const v = raw['version']
    if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= CONFIG_VERSION) value.version = v
    else errors.push('invalid:version')
  }
  if (hasOwn(raw, 'locale')) {
    const v = raw['locale']
    if (isStringEnum(v, LOCALES)) value.locale = v as LocaleSetting
    else errors.push('invalid:locale')
  }
  for (const key of ['launchOnStartup', 'telemetryEnabled', 'crashReportsEnabled', 'onboardingCompleted'] as const) {
    if (!hasOwn(raw, key)) continue
    const v = raw[key]
    if (typeof v === 'boolean') value[key] = v
    else errors.push(`invalid:${key}`)
  }
  if (hasOwn(raw, 'updateChannel')) {
    const v = raw['updateChannel']
    if (isStringEnum(v, CHANNELS)) value.updateChannel = v as UpdateChannel
    else errors.push('invalid:updateChannel')
  }
  if (hasOwn(raw, 'approvalPreset')) {
    const v = raw['approvalPreset']
    if (isStringEnum(v, APPROVALS)) value.approvalPreset = v as ApprovalPreset
    else errors.push('invalid:approvalPreset')
  }
  if (hasOwn(raw, 'modelSource')) {
    const v = raw['modelSource']
    if (isStringEnum(v, MODEL_SOURCES)) value.modelSource = v as ModelSource
    else errors.push('invalid:modelSource')
  }
  if (hasOwn(raw, 'workspaceDir')) {
    const v = raw['workspaceDir']
    if (typeof v === 'string' && !v.includes('\0')) value.workspaceDir = v
    else errors.push('invalid:workspaceDir')
  }
  if (hasOwn(raw, 'infoSources')) {
    const v = raw['infoSources']
    if (isBoolRecord(v)) value.infoSources = { ...v }
    else errors.push('invalid:infoSources')
  }
  if (hasOwn(raw, 'window')) {
    const v = raw['window']
    if (isBounds(v)) value.window = { ...v }
    else errors.push('invalid:window')
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value }
}

export interface MigrationResult {
  config: ShellConfig
  migrated: boolean
  dropped: string[]
}

/**
 * 旧结构迁移到当前 schema：别名映射、缺失补齐、非法字段回退默认、未知字段丢弃。
 * 启动时总返回一个可用配置（宽松），保证应用能起来；写入仍走 validateConfig（严格）。
 */
export function migrateConfig(raw: unknown): MigrationResult {
  if (!isPlainObject(raw)) return { config: cloneDefault(), migrated: true, dropped: [] }

  const dropped: string[] = []
  for (const key of Object.keys(raw)) if (!KNOWN_KEYS.includes(key)) dropped.push(key)

  const normalized: Record<string, unknown> = { ...raw }
  let aliasUsed = false
  for (const [oldKey, newKey] of Object.entries(ALIASES)) {
    if (hasOwn(normalized, oldKey)) {
      aliasUsed = true
      if (!hasOwn(normalized, newKey)) normalized[newKey] = normalized[oldKey]
      delete normalized[oldKey]
    }
  }

  const cleaned: Record<string, unknown> = {}
  for (const key of KNOWN_KEYS) if (hasOwn(normalized, key)) cleaned[key] = normalized[key]

  const checked = validateConfig(cleaned)
  let config: ShellConfig
  if (checked.ok) {
    config = checked.value
  } else {
    const repaired: Record<string, unknown> = { ...cleaned }
    for (const err of checked.errors) {
      if (err.startsWith('invalid:')) delete repaired[err.slice('invalid:'.length)]
    }
    const again = validateConfig(repaired)
    config = again.ok ? again.value : cloneDefault()
  }
  config = { ...config, version: CONFIG_VERSION }

  const migrated = dropped.length > 0 || aliasUsed || !checked.ok || raw['version'] !== CONFIG_VERSION
  return { config, migrated, dropped }
}

/** 读配置：文件缺失或 JSON 损坏都回退默认，并回写一份合法配置。 */
export function readConfig(fs: FileSystem, path: string): { config: ShellConfig; migrated: boolean } {
  let raw: unknown = {}
  if (fs.exists(path)) {
    try {
      raw = JSON.parse(fs.readFile(path)) as unknown
    } catch {
      raw = {}
    }
  }
  const result = migrateConfig(raw)
  if (result.migrated || !fs.exists(path)) writeConfig(fs, path, result.config)
  return { config: result.config, migrated: result.migrated }
}

/** 写配置：先严格校验，非法配置直接抛错拒绝写入。 */
export function writeConfig(fs: FileSystem, path: string, config: ShellConfig): void {
  const check = validateConfig(config)
  if (!check.ok) throw new Error(`refuse invalid config: ${check.errors.join(',')}`)
  fs.writeFile(path, JSON.stringify(check.value, null, 2))
}

/** 合并局部更新（IPC 设置项）；结果仍走严格校验。 */
export function mergeConfig(base: ShellConfig, patch: Partial<ShellConfig>): ValidationResult {
  const merged: Record<string, unknown> = { ...base }
  for (const [key, val] of Object.entries(patch)) {
    if (val !== undefined) merged[key] = val
  }
  return validateConfig(merged)
}
