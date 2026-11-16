/**
 * 宿主插件层（cordis.patch.yml）的公共渲染件。
 *
 * 开发态（scripts/lib-driver.mjs）与打包态（apps/shell/src/host-profile.ts）
 * 各渲染一次，但必须**同一口径**：模板是 scripts/cordis.patch.template.yml，
 * 占位符名字与这里的渲染逻辑都是单一真相源，两边不能各写一份。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 把用户在界面里登记的 LLM 服务渲染成 profile 的 providers 片段。
 * 读 `<root>/providers.json`（由 ghost-ui 插件写入，校验过才落盘）。
 */
export function renderProvidersYaml(root: string): string {
  const file = join(root, 'providers.json')
  if (!existsSync(file)) return ''
  let providers: unknown
  try {
    providers = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return ''
  }
  if (!Array.isArray(providers)) return ''
  const lines: string[] = []
  for (const provider of providers as Array<Record<string, unknown>>) {
    if (typeof provider?.id !== 'string' || provider.id === '') continue
    lines.push(`      ${provider.id}:`)
    lines.push(`        displayName: ${JSON.stringify(String(provider.displayName ?? provider.id))}`)
    lines.push(`        api: ${JSON.stringify(String(provider.api ?? 'openai-completions'))}`)
    if (typeof provider.baseURL === 'string' && provider.baseURL !== '') {
      lines.push(`        baseURL: ${JSON.stringify(provider.baseURL)}`)
    }
    lines.push(`        apiKeyEnv: ${JSON.stringify(String(provider.apiKeyEnv ?? 'MODEL_KEY'))}`)
    lines.push('        models:')
    for (const model of Array.isArray(provider.models) ? provider.models : []) {
      const m = model as Record<string, unknown>
      lines.push(`          - id: ${JSON.stringify(String(m.id))}`)
      lines.push(`            name: ${JSON.stringify(String(m.name ?? m.id))}`)
      const caps = (m.capabilities ?? {}) as Record<string, unknown>
      lines.push(`            contextWindow: ${Number(caps.contextWindow ?? 32768)}`)
      lines.push(`            maxTokens: ${Number(caps.maxTokens ?? 8192)}`)
    }
  }
  return lines.length === 0 ? '' : lines.join('\n')
}

/**
 * 允许用户开启的宿主插件（白名单；不在名单里的一律忽略）。
 * 与 ghost-ui 插件的 HOST_PLUGIN_ALLOWLIST 保持一致——那份是界面口径，这份是装配口径。
 */
const HOST_PLUGIN_ALLOWLIST = new Map([
  ['cua', '@deepseek-ai/dsh-cua'],
  ['cua-bundle', '@deepseek-ai/dsh-cua-bundle'],
  ['schedule', '@deepseek-ai/dsh-schedule'],
  ['goal', '@deepseek-ai/dsh-goal'],
])

/**
 * 把用户在界面里开启的宿主插件渲染成 profile 的插件行。
 * 包必须真的装在运行时里，否则跳过（不能插入一个不存在的包）。
 */
export function renderHostPluginsYaml(root: string, runtimePackagesDir: string): string {
  const file = join(root, 'host-plugins.json')
  if (!existsSync(file)) return ''
  let ids: unknown
  try {
    ids = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return ''
  }
  if (!Array.isArray(ids)) return ''
  const lines: string[] = []
  for (const id of ids as unknown[]) {
    if (typeof id !== 'string') continue
    const name = HOST_PLUGIN_ALLOWLIST.get(id)
    if (name === undefined) continue
    if (!existsSync(join(runtimePackagesDir, name.split('/')[1] ?? ''))) continue
    lines.push(`- id: host-${id}`)
    lines.push(`  name: '${name}'`)
  }
  return lines.length === 0 ? '' : lines.join('\n')
}

/**
 * 去掉模板里用标记圈起来的一段。
 *
 * 模板用 `# :<name>-start` / `# :<name>-end` 圈出可选段：
 * 没有对应配置时整段删掉，而不是留下一个半截的 YAML。
 */
export function stripMarkedBlock(text: string, name: string): string {
  const start = `# :${name}-start`
  const end = `# :${name}-end`
  const from = text.indexOf(start)
  const to = text.indexOf(end)
  if (from === -1 || to === -1 || to < from) return text
  return `${text.slice(0, from)}${text.slice(to + end.length)}`
}
