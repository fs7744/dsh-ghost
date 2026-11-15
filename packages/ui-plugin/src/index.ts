/**
 * ghost-ui：让用户**用配置**扩展我们的界面与模型服务，不改我们的代码。
 *
 * 三件事：
 *  1. **加页面**：`<root>/panels/*.json` 放面板清单 → 桌面端多出一个页签；
 *  2. **改已有界面**：`<root>/slots/*.json` 放插槽贡献 → 注入聊天工具栏 / 设置分区 / 统计扩展；
 *  3. **加 LLM 服务**：`<root>/providers.json` 放 provider 规格 → 下次启动宿主时写进 profile，
 *     宿主就能用这个 provider（凭据只认 env 引用名，明文密钥一律拒）。
 *
 * 安全边界：扩展只能声明「去哪个宿主端点取数据 / 点了调哪个端点」，
 * 不能塞任意代码进来跑；清单都要过 `@dsh-ghost/ui-extensions` 的校验。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  normalizePanels, normalizeSlots,
  type PanelManifest, type SlotContribution,
} from '@dsh-ghost/ui-extensions'
import { validateProviderSpec, type ProviderSpec } from '@dsh-ghost/model-manager'

/** 插件名。 */
export const name = 'ghost-ui'

/** 依赖：工具注册表必需（与其它插件同口径）。 */
export const inject = ['tools']

/** 插件配置。 */
export interface Config {
  /** 扩展根目录：默认 `<workspace>/.ghost/ui`。 */
  root: string
}

/** 宿主侧可见的扩展内容。 */
export interface UiExtensionSnapshot {
  panels: PanelManifest[]
  slots: SlotContribution[]
  panelErrors: Array<{ id: string; errors: string[] }>
  slotErrors: Array<{ id: string; errors: string[] }>
}

/** 编程注册的扩展（别的插件可以在运行时塞进来）。 */
const registeredPanels: PanelManifest[] = []
const registeredSlots: SlotContribution[] = []

/** 编程注册一个面板（其它插件用）。 */
export function registerPanel(manifest: PanelManifest): void {
  registeredPanels.push(manifest)
}

/** 编程注册一条插槽贡献（其它插件用）。 */
export function registerSlot(slot: SlotContribution): void {
  registeredSlots.push(slot)
}

const readJsonFiles = (dir: string): unknown[] => {
  if (!existsSync(dir)) return []
  const out: unknown[] = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue
    try {
      out.push(JSON.parse(readFileSync(join(dir, name), 'utf8')))
    } catch {
      out.push({ id: name, __parseError: true })
    }
  }
  return out
}

const PROVIDERS_FILE = 'providers.json'
const PROXY_FILE = 'proxy.json'
const CUSTOM_CSS_FILE = 'custom.css'

/** 代理配置（空值表示不用代理）。 */
export interface ProxyConfig {
  http?: string
  https?: string
  noProxy?: string
}

/** 校验代理地址；空字符串表示「这一项不设」。非 http(s) 一律拒。 */
export function validateProxy(config: ProxyConfig): string[] {
  const errors: string[] = []
  for (const key of ['http', 'https'] as const) {
    const value = config[key]
    if (value === undefined || value === '') continue
    if (typeof value !== 'string' || !/^https?:\/\/[^\s]+$/.test(value)) {
      errors.push(`${key} 必须是 http(s) 地址`)
    }
  }
  if (config.noProxy !== undefined && config.noProxy !== '' && typeof config.noProxy !== 'string') {
    errors.push('noProxy 必须是字符串（逗号分隔的主机列表）')
  }
  return errors
}

/** 读代理配置（纯函数）。 */
export function readProxy(root: string): ProxyConfig {
  const target = join(root, PROXY_FILE)
  if (!existsSync(target)) return {}
  try {
    const parsed = JSON.parse(readFileSync(target, 'utf8')) as ProxyConfig
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

/** 写代理配置：校验后原子落盘（纯函数）。 */
export function saveProxy(root: string, config: ProxyConfig): { ok: boolean; errors: string[] } {
  const errors = validateProxy(config)
  if (errors.length > 0) return { ok: false, errors }
  try {
    mkdirSync(root, { recursive: true })
    const target = join(root, PROXY_FILE)
    const temporary = `${target}.tmp`
    writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`)
    renameSync(temporary, target)
    return { ok: true, errors: [] }
  } catch (error) {
    return { ok: false, errors: [String(error)] }
  }
}

/** 读用户自定义皮肤 CSS（纯函数）。没有文件就返回空串。 */
export function readCustomCss(root: string): string {
  const target = join(root, CUSTOM_CSS_FILE)
  if (!existsSync(target)) return ''
  try {
    return readFileSync(target, 'utf8')
  } catch {
    return ''
  }
}

/** 读面板清单（纯函数，测试直接用）。 */
export function readPanels(root: string): { panels: PanelManifest[]; errors: Array<{ id: string; errors: string[] }> } {
  const result = normalizePanels([...readJsonFiles(join(root, 'panels')), ...registeredPanels])
  return { panels: result.items, errors: result.errors }
}

/** 读插槽贡献（纯函数）。 */
export function readSlots(root: string): { slots: SlotContribution[]; errors: Array<{ id: string; errors: string[] }> } {
  const result = normalizeSlots([...readJsonFiles(join(root, 'slots')), ...registeredSlots])
  return { slots: result.items, errors: result.errors }
}

/** 读已登记的 provider（纯函数）。 */
export function readProviders(root: string): { providers: ProviderSpec[]; errors: string[] } {
  const raw = readProvidersFile(root)
  const providers = Array.isArray(raw) ? (raw as ProviderSpec[]) : []
  const errors: string[] = []
  for (const provider of providers) {
    for (const problem of validateProviderSpec(provider)) errors.push(`${provider?.id ?? '?'}: ${problem}`)
  }
  return { providers, errors }
}

/** 写 provider 规格：先校验，再原子写盘（纯函数）。 */
export function saveProviders(root: string, providers: ProviderSpec[]): { ok: boolean; errors: string[]; count: number } {
  const errors: string[] = []
  for (const provider of providers) {
    for (const problem of validateProviderSpec(provider)) errors.push(`${provider?.id ?? '?'}: ${problem}`)
  }
  if (errors.length > 0) return { ok: false, errors, count: 0 }
  try {
    mkdirSync(root, { recursive: true })
    const target = join(root, PROVIDERS_FILE)
    const temporary = `${target}.tmp`
    writeFileSync(temporary, `${JSON.stringify(providers, null, 2)}\n`)
    renameSync(temporary, target)
    return { ok: true, errors: [], count: providers.length }
  } catch (error) {
    return { ok: false, errors: [String(error)], count: 0 }
  }
}

/** 宿主 Remote 面。 */
export class GhostUiRemote extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, 'ghostUI', { namespace: 'ghostUI' })
  }

  /** 所有面板清单（含编程注册的）。 */
  @Remote('panels')
  panels(input: { root?: string }): { panels: PanelManifest[]; errors: Array<{ id: string; errors: string[] }> } {
    return readPanels(input?.root ?? currentRoot)
  }

  /** 所有插槽贡献（含编程注册的）。 */
  @Remote('slots')
  slots(input: { root?: string }): { slots: SlotContribution[]; errors: Array<{ id: string; errors: string[] }> } {
    return readSlots(input?.root ?? currentRoot)
  }

  /** 已登记的 LLM 服务（provider 规格）。 */
  @Remote('providers')
  providers(input: { root?: string }): { providers: ProviderSpec[]; errors: string[] } {
    return readProviders(input?.root ?? currentRoot)
  }

  /** 代理配置：读取。 */
  @Remote('proxy')
  proxy(input: { root?: string }): { proxy: ProxyConfig; errors: string[] } {
    const config = readProxy(input?.root ?? currentRoot)
    return { proxy: config, errors: validateProxy(config) }
  }

  /** 代理配置：保存（校验通过才写盘）。 */
  @Remote('proxySave')
  proxySave(input: { proxy: ProxyConfig; root?: string }): { ok: boolean; errors: string[] } {
    const config = input?.proxy ?? {}
    return saveProxy(input?.root ?? currentRoot, config)
  }

  /** 用户自定义皮肤 CSS（覆盖 CSS 变量即可换肤）。 */
  @Remote('customCss')
  customCss(input: { root?: string }): { css: string } {
    return { css: readCustomCss(input?.root ?? currentRoot) }
  }

  /**
   * 登记 LLM 服务：先过校验，再原子写盘。
   * 写完**下次启动宿主**生效（渲染 profile 时会把它写进 llm-pi-ai.providers）。
   */
  @Remote('providersSave')
  providersSave(input: { providers: ProviderSpec[]; root?: string }): { ok: boolean; errors: string[]; count: number } {
    const providers = Array.isArray(input?.providers) ? input.providers : []
    return saveProviders(input?.root ?? currentRoot, providers)
  }
}

let currentRoot = ''

const readProvidersFile = (root: string): unknown => {
  const target = join(root, PROVIDERS_FILE)
  if (!existsSync(target)) return []
  try {
    return JSON.parse(readFileSync(target, 'utf8'))
  } catch {
    return []
  }
}

/**
 * 挂载插件。
 * @param ctx - cordis 上下文
 * @param config - 扩展根目录
 */
export function apply(ctx: Context, config: Config): void {
  currentRoot = config.root
  const cordis = ctx as unknown as { reflect?: unknown }
  if (cordis.reflect !== undefined) new GhostUiRemote(ctx)
  // 自检文件：外部能确认「插件活着、根目录在哪、读到几个扩展」。
  try {
    mkdirSync(config.root, { recursive: true })
    const panels = normalizePanels(readJsonFiles(join(config.root, 'panels')))
    const slots = normalizeSlots(readJsonFiles(join(config.root, 'slots')))
    writeFileSync(join(config.root, 'plugin-state.json'), `${JSON.stringify({
      plugin: name,
      root: config.root,
      panels: panels.items.length,
      slots: slots.items.length,
      panelErrors: panels.errors.length,
      at: new Date().toISOString(),
      pid: process.pid,
    }, null, 2)}\n`)
  } catch {
    // 自检文件写不了不影响插件本身
  }
}
