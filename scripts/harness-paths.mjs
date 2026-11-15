/**
 * harness 路径解析：两个路径不是一回事，别混。
 *
 * - **源码检出**（`DSH_HARNESS_ROOT`）：契约探针 / 升级流水线只读扫描，纯源码、
 *   有 `packages/` 与 `pnpm-workspace.yaml`，**没有构建产物，不能拿来启动宿主**。
 *   缺省取与本仓库同级的 `D:\code\deepseek-harness`。
 * - **运行时安装**（`DSH_DSH_MODULES`）：启动宿主用的 `@deepseek-ai/dsh` npm 包，
 *   含 `lib/bin.js` 与 `lib/typert.remote-client.js`。缺省在
 *   `spikes/p05-transport/node_modules`（已 gitignore）。
 *
 * 优先级：命令行显式参数 > 环境变量 > `.env` > 默认布局。
 * 换本地检出位置只需设 `DSH_HARNESS_ROOT`，不用改代码。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const REPO = join(HERE, '..')

/** 从 `.env` 读一个键（不引入第三方依赖；`.env` 已 gitignore）。 */
export function envFileValue(key) {
  const file = join(REPO, '.env')
  if (!existsSync(file)) return undefined
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (match !== null && match[1] === key && match[2] !== '') return match[2]
  }
  return undefined
}

/** 显式配置的源码检出位置（命令行 > 环境变量 > .env）；没有则 undefined。 */
export function explicitHarnessRoot(explicit) {
  const value = explicit ?? process.env.DSH_HARNESS_ROOT ?? envFileValue('DSH_HARNESS_ROOT')
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * 依次尝试的源码检出位置（用于报错时列出）。
 * **显式指定过就只认这一个**：写错路径要立刻报错，不能悄悄回退到默认检出，
 * 否则契约探针会在用户不知情的情况下校验了另一份源码。
 */
export function harnessCandidates(explicit) {
  const configured = explicitHarnessRoot(explicit)
  if (configured !== undefined) return [resolve(configured)]
  return [
    join(REPO, '..', 'deepseek-harness'),
    join(REPO, '..', 'deepseek-harness-master'),
    join(REPO, 'harness'),
  ].map(value => resolve(value))
}

/**
 * 解析 harness 源码检出根目录。
 * @param explicit - 命令行传入的 `--harness`
 * @returns 绝对路径；找不到返回 undefined
 */
export function resolveHarnessRoot(explicit) {
  for (const dir of harnessCandidates(explicit)) {
    if (existsSync(join(dir, 'packages')) && existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
  }
  return undefined
}

/**
 * 解析运行时 `@deepseek-ai/*` 所在的 node_modules。
 * @param explicit - 命令行传入的 `--modules`
 */
export function resolveDshModules(explicit) {
  return resolve(explicit ?? process.env.DSH_DSH_MODULES ?? envFileValue('DSH_DSH_MODULES')
    ?? join(REPO, 'spikes', 'p05-transport', 'node_modules'))
}

/** 读某个 package.json 的 version；文件不存在返回 undefined。 */
export function readVersion(packageJsonPath) {
  if (!existsSync(packageJsonPath)) return undefined
  try {
    return JSON.parse(readFileSync(packageJsonPath, 'utf8')).version
  } catch {
    return undefined
  }
}
