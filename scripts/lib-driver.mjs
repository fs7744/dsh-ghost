/** 验证脚本共用的启停与登录（薄封装，避免每个脚本重复实现）。 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { boot as rawBoot, stop as rawStop, DSH_HOME } from '../spikes/p05-transport/lib/harness-client.mjs'
export { WORKSPACE } from '../spikes/p05-transport/lib/harness-client.mjs'
export { login, createTransport } from '../packages/harness-port/src/index.ts'

const REPO = join(import.meta.dirname, '..')
const PATCH_TEMPLATE = join(import.meta.dirname, 'cordis.patch.template.yml')
/** 会被宿主 profile 加载的 workspace 包。 */
const HOST_PACKAGES = ['orchestrator-plugin', 'memory-plugin', 'memory', 'economizer', 'ui-plugin', 'ui-extensions', 'automation-plugin', 'automation', 'peer-agent-plugin', 'peer-agent', 'superagent', 'sink-github', 'source-github', 'source-hub', 'playbook', 'playbook-runtime', 'evolution']

/**
 * 渲染标准 patch：模板是唯一真相源，只有凭据地址与模型名允许被环境变量覆盖。
 * 曾经有两个验收脚本各自整份重写 profile 里的 patch，把 orchestrator 和默认模型冲掉，
 * 导致后续脚本 `ghostTickets/*` 404、`selectModel` 失败。现在统一从这里生成。
 */
export function renderPatch() {
  return readFileSync(PATCH_TEMPLATE, 'utf8')
    .replaceAll('{{REPO}}', REPO.replace(/\\/g, '/'))
    .replaceAll('{{BASE_URL}}', process.env.WB_BASE_URL ?? 'http://127.0.0.1:7864/v1')
    .replaceAll('{{MODEL}}', process.env.WB_MODEL ?? 'hy3')
    .replaceAll('{{PROVIDERS}}', renderProvidersYaml())
    .replaceAll('{{HOST_PLUGINS}}', renderHostPluginsYaml())
}

/**
 * 读用户在界面里登记的代理配置，转成宿主进程要用的 env。
 * 文件在 `.ghost/ui/proxy.json`（由 ghost-ui 插件写入，校验过才落盘）。
 */
export function readProxyEnv(root = join(REPO, '.ghost', 'ui')) {
  const file = join(root, 'proxy.json')
  if (!existsSync(file)) return {}
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    const env = {}
    if (typeof parsed?.http === 'string' && parsed.http !== '') {
      env.HTTP_PROXY = parsed.http
      env.http_proxy = parsed.http
    }
    if (typeof parsed?.https === 'string' && parsed.https !== '') {
      env.HTTPS_PROXY = parsed.https
      env.https_proxy = parsed.https
    }
    if (typeof parsed?.noProxy === 'string' && parsed.noProxy !== '') {
      env.NO_PROXY = parsed.noProxy
      env.no_proxy = parsed.noProxy
    }
    return env
  } catch {
    return {}
  }
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
export function renderHostPluginsYaml(root = join(REPO, '.ghost', 'ui')) {
  const file = join(root, 'host-plugins.json')
  if (!existsSync(file)) return ''
  let ids = []
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (Array.isArray(parsed)) ids = parsed.filter(id => typeof id === 'string')
  } catch {
    return ''
  }
  const runtimeModules = join(DSH_HOME, '..', 'node_modules', '@deepseek-ai')
  const lines = []
  for (const id of ids) {
    const name = HOST_PLUGIN_ALLOWLIST.get(id)
    if (name === undefined) continue
    if (!existsSync(join(runtimeModules, name.split('/')[1] ?? ''))) continue
    lines.push(`- id: host-${id}`)
    lines.push(`  name: '${name}'`)
  }
  return lines.length === 0 ? '' : lines.join('\n')
}

/**
 * 把用户在界面里登记的 LLM 服务渲染成 profile 的 providers 片段。
 * 读 `.ghost/ui/providers.json`（由 ghost-ui 插件写入，校验过才落盘）。
 */
export function renderProvidersYaml() {
  const file = join(REPO, '.ghost', 'ui', 'providers.json')
  if (!existsSync(file)) return ''
  let providers = []
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (Array.isArray(parsed)) providers = parsed
  } catch {
    return ''
  }
  const lines = []
  for (const provider of providers) {
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
      if (typeof model?.id !== 'string' || model.id === '') continue
      lines.push(`          - id: ${JSON.stringify(model.id)}`)
      lines.push(`            name: ${JSON.stringify(String(model.name ?? model.id))}`)
      const caps = model.capabilities ?? {}
      lines.push(`            contextWindow: ${Number(caps.contextWindow ?? 32768)}`)
      lines.push(`            maxTokens: ${Number(caps.maxTokens ?? 8192)}`)
    }
  }
  return lines.length === 0 ? '' : lines.join('\n')
}

/** 把 patch 写进指定 profile。 */
function writePatch(profile, content) {
  const target = join(DSH_HOME, 'profiles', profile, 'cordis.patch.yml')
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
}

/**
 * 把 workspace 里的最新插件同步进 profile 的 node_modules。
 *
 * 插件管理器装的是 tgz 快照，不会跟随源码变化；不同步就会一直加载旧代码
 * （曾经排查过"改了代码却没生效"就是这个原因）。每次启动前同步，验收永远跑最新产物。
 * 注意：先 `npm run build` 生成 lib/ 再启动，同步的是编译产物而非 .ts 源码。
 */
export function syncPlugins(profile = 'p05') {
  const target = join(DSH_HOME, 'profiles', profile, 'node_modules', '@dsh-ghost')
  mkdirSync(target, { recursive: true })
  for (const name of HOST_PACKAGES) {
    const from = join(REPO, 'packages', name)
    if (!existsSync(from)) continue
    const to = join(target, name)
    mkdirSync(to, { recursive: true })
    cpSync(join(from, 'package.json'), join(to, 'package.json'))
    for (const dir of ['lib', 'src']) {
      const source = join(from, dir)
      if (existsSync(source)) cpSync(source, join(to, dir), { recursive: true })
    }
  }
  // 自动化插件要用的 playwright-core 也得进 profile（它不在 profile 的依赖树里）。
  const playwrightFrom = join(REPO, 'node_modules', 'playwright-core')
  if (existsSync(playwrightFrom)) {
    const playwrightTo = join(DSH_HOME, 'profiles', profile, 'node_modules', 'playwright-core')
    rmSync(playwrightTo, { recursive: true, force: true })
    cpSync(playwrightFrom, playwrightTo, { recursive: true })
  }
}

let lastProfile = 'p05'

/**
 * 启动宿主；启动前同步插件并落盘 patch。
 * @param options - 支持 `patch`：临时覆盖整份 patch（假模型端点等），stop 时自动恢复标准版。
 */
export async function boot(options = {}) {
  const { patch, permissionMode, ...rest } = options
  // headless 验收是无人值守：审批请求必须立即被拒，否则模型回合会卡在 approval/asked。
  // 桌面 UI 显式传 'workspace-write'，保留人工审批闸门。
  process.env.DSH_PERMISSION_MODE = permissionMode ?? 'danger-full-access'
  // 用户在界面里登记的代理：注入宿主进程 env（宿主 dsh-http-proxy 会读它们）。
  Object.assign(process.env, readProxyEnv())
  lastProfile = rest.profile ?? 'p05'
  syncPlugins(lastProfile)
  writePatch(lastProfile, patch ?? renderPatch())
  return rawBoot(rest)
}

/** 结束宿主，并把 patch 恢复成标准版，避免特殊配置污染下一个脚本。 */
export async function stop(child) {
  await rawStop(child)
  writePatch(lastProfile, renderPatch())
}
