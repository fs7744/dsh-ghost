#!/usr/bin/env node
/**
 * 把 harness 运行时复制到 `build/runtime/node_modules`，供 electron-builder 的
 * `extraResources` 打进安装包（asar 外）。
 *
 * 为什么需要：`@deepseek-ai/dsh/lib/bin.js` 按包名解析依赖，asar 内的相对路径
 * 解析不了原生模块（node-pty / koffi / node:sqlite）。运行时不能塞进 asar。
 *
 * 默认 **dry-run**：只检查来源、估算体积并打印计划；加 `--apply` 才真的复制。
 * 复制量在 1.3GB 量级，且依赖本机的 `DSH_DSH_MODULES` 安装，不进 git。
 *
 * 用法:
 *   node scripts/prepare-runtime.mjs [--apply] [--modules <dir>] [--json]
 *
 * 退出码: 0 计划打印完/复制成功；1 来源不完整；2 用法错误。
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveDshModules } from './harness-paths.mjs'
import { HOST_PACKAGES } from './host-packages.mjs'

const REPO = join(import.meta.dirname, '..')
const TARGET = join(REPO, 'build', 'runtime', 'node_modules')
const MANIFEST = join(REPO, 'build', 'runtime', 'manifest.json')

function parseArgs(argv) {
  const out = { apply: false, force: false, modules: undefined, json: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--apply') out.apply = true
    else if (arg === '--force') out.force = true
    else if (arg === '--json') out.json = true
    else if (arg === '--modules') {
      out.modules = argv[++index]
      if (out.modules === undefined) { process.stderr.write('--modules 需要目录\n'); process.exit(2) }
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write('用法: node scripts/prepare-runtime.mjs [--apply] [--modules <dir>] [--json]\n')
      process.exit(0)
    } else {
      process.stderr.write(`未知参数: ${arg}\n`)
      process.exit(2)
    }
  }
  return out
}

/** 粗略统计体积（只看顶层包目录，避免遍历 1.3GB 花太久）。 */
function estimate(dir) {
  let bytes = 0
  let count = 0
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue
    try {
      count += 1
      bytes += statSync(join(dir, name)).size
    } catch { /* 跳过不可读项 */ }
  }
  return { count, topLevelBytes: bytes }
}

const args = parseArgs(process.argv.slice(2))
const modules = resolveDshModules(args.modules)
const bin = join(modules, '@deepseek-ai', 'dsh', 'lib', 'bin.js')
if (!existsSync(bin)) {
  process.stderr.write(`来源不完整：找不到 ${bin}\n设 DSH_DSH_MODULES 指向含 @deepseek-ai/dsh 的 node_modules。\n`)
  process.exit(1)
}
const size = estimate(modules)
const plan = {
  source: modules,
  target: TARGET,
  bin,
  packages: size.count,
  apply: args.apply,
  note: '复制后由 electron-builder extraResources 打进 resources/runtime；不加 --apply 不改任何文件。',
}
if (args.json) process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`)
else {
  process.stdout.write(`来源  ${modules}（${size.count} 个顶层包）\n`)
  process.stdout.write(`目标  ${TARGET}\n`)
  process.stdout.write(`入口  ${bin}\n`)
}

if (!args.apply) {
  if (!args.json) {
    process.stdout.write('\nDRY-RUN：未复制。确认磁盘空间后加 --apply。\n')
    process.stdout.write('注意：复制后安装包会显著变大；正式发版前应改为 npm ci --omit=dev 的裁剪产物。\n')
  }
  process.exit(0)
}

/**
 * 目标里已经有同一份来源的运行时吗？
 *
 * 有就不重拷：580MB / 1.4 万文件每次全量复制十几分钟，而 harness 的包很少变。
 * 只同步我们的插件层（很便宜），再刷新 manifest。
 */
function targetUpToDate() {
  if (!existsSync(join(TARGET, '@deepseek-ai', 'dsh', 'lib', 'bin.js'))) return false
  if (!existsSync(MANIFEST)) return false
  try {
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
    return manifest.source === modules
  } catch {
    return false
  }
}

if (!args.force && targetUpToDate()) {
  process.stdout.write('运行时已是最新（同一来源），跳过 580MB 重拷，只同步插件层。\n')
} else {
  rmSync(TARGET, { recursive: true, force: true })
  mkdirSync(TARGET, { recursive: true })
  process.stdout.write('复制中（580MB / 1.4 万文件，几分钟）...\n')
  cpSync(modules, TARGET, { recursive: true, dereference: true })
}
const ghostCount = syncGhostPlugins()
writeFileSync(MANIFEST, `${JSON.stringify({
  preparedAt: new Date().toISOString(),
  packages: size.count,
  source: modules,
  ghostPlugins: ghostCount,
}, null, 2)}\n`)
process.stdout.write(`完成：${TARGET}\n`)

/**
 * 把我们的 workspace 插件包复制进运行时的 `@dsh-ghost/*`。
 *
 * 逻辑在 scripts/sync-host-plugins.mjs（同一份口径，可单独跑，不用重拷 1.3GB 运行时）。
 */
function syncGhostPlugins() {
  const result = spawnSync(process.execPath, [
    join(REPO, 'scripts', 'sync-host-plugins.mjs'), '--runtime', TARGET,
  ], { cwd: REPO, stdio: 'inherit', shell: false })
  if (result.status !== 0) {
    process.stderr.write('插件同步失败：宿主启动时会缺我们的插件层\n')
    process.exit(1)
  }
  return HOST_PACKAGES.length
}
