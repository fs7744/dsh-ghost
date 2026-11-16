/**
 * 打包态的宿主 profile 物化。
 *
 * 为什么需要：harness 的 `loadProfile(name)` 只认两种 profile ——
 * 1. `$DSH_HOME/profiles/<name>/package.json` 已存在（自己建的）；
 * 2. `name` 命中内置模板表（只有 acp / web / headless / sdk / sdk-minimal）。
 * 打包态原来用 `desktop` 这个名字，两条都不满足 → 宿主启动即抛
 * `profile "desktop" does not exist` → 进程退出 → 壳一直等不到 healthy，
 * 于是**一个窗口都不弹**，用户只看到后台进程。
 *
 * 这里在启动宿主前把 profile 物化出来：
 * - 写 `package.json`（manifest，声明要挂的 bundle）；
 * - 写 `cordis.patch.yml`（我们自己的插件层，用同一份模板渲染）。
 *
 * 插件包本身不复制：打包时它们已经在运行时 node_modules 的 `@dsh-ghost/*` 下，
 * harness 按包名从 install anchor（运行时 node_modules）就能解析到。
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderProvidersYaml, renderHostPluginsYaml, stripMarkedBlock } from './host-patch.ts'

/** profile 要挂的 bundle：与开发态 p05 一致（base + web-app 提供 API 网关）。 */
export const PROFILE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] as const

export interface HostProfileInput {
  /** DSH_HOME（宿主 profile 的根）。 */
  dshHome: string
  /** profile 名。 */
  profile: string
  /** 运行时 node_modules（插件包与 harness bundle 都在这里）。 */
  runtimeModules: string
  /** 应用数据目录：.ghost 类数据落在这里，不写安装目录。 */
  userData: string
  /** patch 模板路径（随包分发）。 */
  templatePath: string
  /** 模型服务地址。 */
  baseUrl: string
  /** 模型名。 */
  model: string
}

export interface HostProfileResult {
  ok: boolean
  profileDir?: string
  /** 本次同步进 profile 的插件包数。 */
  syncedPlugins?: number
  error?: string
}

/** 路径统一成正斜杠：YAML 单引号里反斜杠不是转义，但混用会让某些解析器困惑。 */
function posix(path: string): string {
  return path.replace(/\\/g, '/')
}

/**
 * 渲染我们自己的插件层。
 *
 * 占位符与 `scripts/lib-driver.mjs` 的 `renderPatch()` 一一对应，只是路径语义不同：
 * 开发态指向仓库，打包态指向用户数据目录。
 */
export function renderHostPatch(input: HostProfileInput): string {
  const template = readFileSync(input.templatePath, 'utf8')
  const userData = posix(input.userData)
  const ghost = `${userData}/ghost`
  const uiRoot = join(input.userData, 'ghost', 'ui')
  const runtimePackages = join(input.runtimeModules, '@deepseek-ai')
  const rendered = template
    .replaceAll('{{MEMORY_ROOT}}', `${ghost}/memory`)
    .replaceAll('{{UI_ROOT}}', uiRoot.replace(/\\/g, '/'))
    .replaceAll('{{STATE_DIR}}', ghost)
    .replaceAll('{{WORKSPACE_DIR}}', `${userData}/workspace`)
    .replaceAll('{{TICKETS_FILE}}', `${ghost}/tickets.json`)
    .replaceAll('{{REPO_ROOT}}', `${userData}/workspace`)
    // source-hub 的示例 mapper 随包分发在运行时里。
    .replaceAll('{{SOURCE_HUB_EXAMPLE}}', `${posix(input.runtimeModules)}/@dsh-ghost/source-hub/examples/im.mjs`)
    .replaceAll('{{BASE_URL}}', input.baseUrl)
    .replaceAll('{{MODEL}}', input.model)
    // 用户在界面里登记的 LLM 服务与宿主插件：ghost-ui 插件写在用户数据目录里，
    // 与开发态同一份口径（改完重启宿主生效）。
    .replaceAll('{{PROVIDERS}}', renderProvidersYaml(uiRoot))
    .replaceAll('{{HOST_PLUGINS}}', renderHostPluginsYaml(uiRoot, runtimePackages))
  // 没有模型地址就把网关 provider 整段删掉：留着会让 llm-pi-ai 因为空 baseURL 激活失败。
  return input.baseUrl.trim() === '' ? stripMarkedBlock(rendered, 'wb-provider') : rendered
}

/**
 * 物化 profile：写 manifest + 用户补丁层。
 *
 * 幂等：每次启动都重写（插件配置可能变了），但只在 profile 目录缺失或内容不同
 * 时才落盘，避免无谓地动用户的 DSH_HOME。
 */
export function materializeHostProfile(input: HostProfileInput): HostProfileResult {
  const profileDir = join(input.dshHome, 'profiles', input.profile)
  const manifest = `${JSON.stringify({
    name: `dsh-profile-${input.profile}`,
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: [...PROFILE_BUNDLES] } },
  }, null, 2)}\n`
  const patch = renderHostPatch(input)
  const manifestPath = join(profileDir, 'package.json')
  const patchPath = join(profileDir, 'cordis.patch.yml')

  try {
    mkdirSync(profileDir, { recursive: true })
    if (!sameFile(manifestPath, manifest)) writeFileSync(manifestPath, manifest, 'utf8')
    if (!sameFile(patchPath, patch)) writeFileSync(patchPath, patch, 'utf8')
    // 插件包必须落在 profile 的 node_modules 里，宿主才认（profile 作用域）。
    const plugins = syncProfilePlugins({ profileDir, runtimeModules: input.runtimeModules })
    return { ok: true, profileDir, syncedPlugins: plugins.synced }
  } catch (error) {
    return { ok: false, error: `物化宿主 profile 失败：${String(error)}` }
  }
}

/** 文件不存在或内容不同（读不出来一律当成"要写"）。 */
function sameFile(path: string, content: string): boolean {
  try {
    return readFileSync(path, 'utf8') === content
  } catch {
    return false
  }
}

/**
 * 把插件包同步进 profile 的 node_modules。
 *
 * 为什么必须放这儿：harness 的运行时分��表里，插件属于 **profile 作用域** ——
 * 只认 `$DSH_HOME/profiles/<name>/node_modules/` 下装着的包。放在运行时
 * node_modules 里不够（那是 harness 自己包的安装作用域），宿主会报
 * `Cannot find package '@dsh-ghost/xxx' imported from <profile dir>`。
 * 开发态是 scripts/lib-driver.mjs 的 syncPlugins() 干的同一件事。
 *
 * 只在源比目标新（或目标缺失）时才复制：每次启动都全量复制没必要，
 * 但源码改了要能跟上。
 */
export function syncProfilePlugins(input: {
  profileDir: string
  runtimeModules: string
}): { synced: number; skipped: number } {
  const source = join(input.runtimeModules, '@dsh-ghost')
  const target = join(input.profileDir, 'node_modules', '@dsh-ghost')
  if (!existsSync(source)) return { synced: 0, skipped: 0 }
  mkdirSync(target, { recursive: true })
  let synced = 0
  let skipped = 0
  for (const name of readdirSync(source)) {
    const from = join(source, name)
    const to = join(target, name)
    if (!existsSync(join(from, 'package.json'))) continue
    if (!isStale(from, to)) { skipped += 1; continue }
    mkdirSync(to, { recursive: true })
    cpSync(join(from, 'package.json'), join(to, 'package.json'))
    for (const dir of ['lib', 'src', 'examples']) {
      const dirSource = join(from, dir)
      if (existsSync(dirSource)) cpSync(dirSource, join(to, dir), { recursive: true })
    }
    synced += 1
  }
  return { synced, skipped }
}

/** 目标缺失或比源旧 → 需要同步。 */
function isStale(from: string, to: string): boolean {
  try {
    const sourceTime = statSync(join(from, 'package.json')).mtimeMs
    const targetTime = statSync(join(to, 'package.json')).mtimeMs
    return sourceTime > targetTime
  } catch {
    return true
  }
}
