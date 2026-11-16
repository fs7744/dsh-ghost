/** 验证脚本共用的启停与登录（薄封装，避免每个脚本重复实现）。 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { boot as rawBoot, stop as rawStop, DSH_HOME } from '../spikes/p05-transport/lib/harness-client.mjs'
export { WORKSPACE } from '../spikes/p05-transport/lib/harness-client.mjs'
export { login, createTransport } from '../packages/harness-port/src/index.ts'
import { HOST_PACKAGES } from './host-packages.mjs'
import {
  renderProvidersYaml, renderHostPluginsYaml, stripMarkedBlock,
} from '../apps/shell/src/host-patch.ts'

const REPO = join(import.meta.dirname, '..')
const PATCH_TEMPLATE = join(import.meta.dirname, 'cordis.patch.template.yml')

/**
 * 渲染标准 patch：模板是唯一真相源，只有凭据地址与模型名允许被环境变量覆盖。
 * 曾经有两个验收脚本各自整份重写 profile 里的 patch，把 orchestrator 和默认模型冲掉，
 * 导致后续脚本 `ghostTickets/*` 404、`selectModel` 失败。现在统一从这里生成。
 *
 * 路径类占位符在开发态一律指向仓库；打包态由 apps/shell/src/host-profile.ts
 * 渲染成用户数据目录——两边的占位符名字必须一致。
 */
export function renderPatch() {
  const repo = REPO.replace(/\\/g, '/')
  const baseUrl = process.env.WB_BASE_URL ?? 'http://127.0.0.1:7864/v1'
  const model = process.env.WB_MODEL ?? 'hy3'
  const template = readFileSync(PATCH_TEMPLATE, 'utf8')
  const runtimePackages = join(DSH_HOME, '..', 'node_modules', '@deepseek-ai')
  const rendered = template
    .replaceAll('{{MEMORY_ROOT}}', `${repo}/.ghost/memory`)
    .replaceAll('{{UI_ROOT}}', `${repo}/.ghost/ui`)
    .replaceAll('{{STATE_DIR}}', `${repo}/.ghost`)
    .replaceAll('{{WORKSPACE_DIR}}', repo)
    .replaceAll('{{TICKETS_FILE}}', `${repo}/.ghost/tickets.json`)
    .replaceAll('{{REPO_ROOT}}', repo)
    .replaceAll('{{SOURCE_HUB_EXAMPLE}}', `${repo}/packages/source-hub/examples/im.mjs`)
    .replaceAll('{{BASE_URL}}', baseUrl)
    .replaceAll('{{MODEL}}', model)
    .replaceAll('{{PROVIDERS}}', renderProvidersYaml(join(REPO, '.ghost', 'ui')))
    .replaceAll('{{HOST_PLUGINS}}', renderHostPluginsYaml(join(REPO, '.ghost', 'ui'), runtimePackages))
  // 网关 provider 是可选的：没有 baseURL 就整段删掉，别让 llm-pi-ai 因为空地址激活失败。
  return baseUrl.trim() === '' ? stripMarkedBlock(rendered, 'wb-provider') : rendered
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
