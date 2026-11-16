#!/usr/bin/env node
/**
 * 打「非安装版」Windows 包（免安装 / 便携），供本地反复验证测试。
 *
 * 和 release.yml 的安装版（NSIS .exe）区别：
 *   - target 用 dir / zip / portable，**不写注册表、不建快捷方式、不进卸载项**；
 *   - `--publish never`，不产生任何更新 feed 文件、不上传；
 *   - 产物落在 out/win-portable/，不污染 CI 的 out/shell-release/。
 *
 * 产物形态：
 *   - out/win-portable/win-unpacked/                    免安装目录，双击 dsh-ghost.exe 即跑
 *   - out/win-portable/dsh-ghost-<v>-win-x64.zip         解压即用的压缩包
 *   - out/win-portable/dsh-ghost-<v>-win-x64-portable.exe 单文件便携版（--exe）
 *
 * harness 运行时（@deepseek-ai/dsh，约 580MB）默认打进 resources/runtime：
 * 打包后的壳要从 resources/runtime/node_modules 里解析 bin.js 与原生模块。
 * 首次构建前自动跑 scripts/prepare-runtime.mjs --apply；已就绪则复用，不重复复制。
 *
 * 离线与免权限：electron-builder 打包 Windows 时要用 winCodeSign（改 exe 图标/版本信息），
 * 那东西要从 GitHub 下载，解压还要求「创建符号链接」权限（非管理员/未开开发者模式必失败）。
 * 所以这里关掉 electron-builder 的 signAndEditExecutable，改用缓存里的 rcedit-x64.exe
 * 自己打图标与版本信息：零下载、零特权，产物一样带图标。
 *
 * 用法:
 *   node scripts/pack-win-portable.mjs                 # 默认：dir + zip，带运行时
 *   node scripts/pack-win-portable.mjs --skip-runtime  # 快速版：不带运行时（只看 UI）
 *   node scripts/pack-win-portable.mjs --exe           # 额外产出单文件 portable .exe
 *   node scripts/pack-win-portable.mjs --no-zip        # 只出免安装目录
 *   node scripts/pack-win-portable.mjs --skip-build    # 不重新编译，沿用现有 dist
 *   node scripts/pack-win-portable.mjs --force-runtime # 强制重新复制 harness 运行时
 *   node scripts/pack-win-portable.mjs --no-brand      # 不改 exe 图标/版本信息
 *   node scripts/pack-win-portable.mjs --out-dir <dir>
 *   node scripts/pack-win-portable.mjs --json          # 机器可读结果
 *
 * 退出码：0 成功；1 构建/复制失败；2 参数错误。
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { resolveDshModules } from './harness-paths.mjs'

const REPO = join(import.meta.dirname, '..')
const BASE_CONFIG = join(REPO, 'build', 'electron-builder.yml')
const DEFAULT_OUT = join(REPO, 'out', 'win-portable')
const RUNTIME_DIR = join(REPO, 'build', 'runtime')
const RUNTIME_MODULES = join(RUNTIME_DIR, 'node_modules')
const RUNTIME_BIN = join(RUNTIME_MODULES, '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const ICON_PATH = join(REPO, 'build', 'resources', 'icon.ico')

const USAGE = `用法: node scripts/pack-win-portable.mjs [选项]

  --out-dir <dir>       产物目录（默认 out/win-portable）
  --skip-build          跳过 packages / shell / ui 编译，沿用现有 dist
  --skip-runtime        不带 harness 运行时（快速 UI 验证）
  --force-runtime       强制重新复制 harness 运行时
  --exe                 额外产出单文件 portable .exe
  --no-zip              不产出 zip
  --no-brand              不改 exe 图标/版本信息
  --json                输出机器可读 JSON
  -h, --help            显示本帮助
`

function parseArgs(argv) {
  const out = {
    outDir: DEFAULT_OUT,
    skipBuild: false,
    skipRuntime: false,
    forceRuntime: false,
    exe: false,
    zip: true,
    noBrand: false,
    json: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--out-dir') {
      const value = argv[++index]
      if (value === undefined) { process.stderr.write('--out-dir 需要目录参数\n'); process.exit(2) }
      out.outDir = resolve(REPO, value)
    } else if (arg === '--skip-build') out.skipBuild = true
    else if (arg === '--skip-runtime') out.skipRuntime = true
    else if (arg === '--force-runtime') out.forceRuntime = true
    else if (arg === '--exe') out.exe = true
    else if (arg === '--no-zip') out.zip = false
    else if (arg === '--no-brand') out.noBrand = true
    else if (arg === '--json') out.json = true
    else if (arg === '--help' || arg === '-h') { process.stdout.write(USAGE); process.exit(0) }
    else { process.stderr.write(`未知参数: ${arg}\n${USAGE}`); process.exit(2) }
  }
  return out
}

const args = parseArgs(process.argv.slice(2))

function log(message) {
  if (!args.json) process.stdout.write(`${message}\n`)
}

function step(message) {
  if (!args.json) process.stdout.write(`\n=== ${message} ===\n`)
}

/** 统计目录体积（递归 statSync；十几万文件会慢，但只跑一次）。 */
function dirSize(dir) {
  let bytes = 0
  let files = 0
  const walk = current => {
    let entries
    try { entries = readdirSync(current, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else {
        try { bytes += statSync(full).size; files += 1 } catch { /* 忽略读不到的文件 */ }
      }
    }
  }
  walk(dir)
  return { bytes, files }
}

/**
 * 定位 npm 的入口 JS。Windows 上不能直接 spawn npm.cmd（EINVAL），
 * 必须走 node + npm-cli.js。
 */
function resolveNpmCli() {
  const fromEnv = process.env.npm_execpath
  if (fromEnv !== undefined && existsSync(fromEnv)) return fromEnv
  const beside = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  if (existsSync(beside)) return beside
  return undefined
}

/** 跑 npm 脚本：优先复用 npm-cli.js，避免 PATH 上 npm.cmd 找不到 / spawn 失败。 */
function runNpm(scriptArgs, label) {
  const npmCli = resolveNpmCli()
  const command = npmCli === undefined ? 'npm' : process.execPath
  const commandArgs = npmCli === undefined ? scriptArgs : [npmCli, ...scriptArgs]
  const result = spawnSync(command, commandArgs, {
    cwd: REPO,
    stdio: 'inherit',
    shell: npmCli === undefined,
  })
  if (result.error !== undefined) {
    log(`  ${label} 失败：${result.error.message}`)
    return false
  }
  if (result.status !== 0) {
    log(`  ${label} 失败（退出码 ${result.status}）`)
    return false
  }
  return true
}

/**
 * electron-builder 走本地 node_modules，不依赖 npx 的网络/缓存行为。
 *
 * 用异步 spawn 而不是 spawnSync：本地镜像 HTTP 服务跑在同一个进程里，
 * spawnSync 会把事件循环堵死，镜像就永远应答不了，下载会挂死。
 *
 * prepackagedDir 非空时走 --prepackaged：直接拿已打包好的目录出 zip/便携版，
 * 不重新走一遍打包，省时间也让产物带上已经打好图标的 exe。
 */
function runBuilder(configPath, label, extraEnv = {}, prepackagedDir = '') {
  const cli = join(REPO, 'node_modules', 'electron-builder', 'cli.js')
  const env = {
    ...process.env,
    // 本地无证书：不要去 Windows 证书存储里乱找，避免打包卡住或误签。
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    ...extraEnv,
  }
  const args = [cli, '--win', '--x64', '--config', configPath, '--publish', 'never']
  if (prepackagedDir !== '') args.push('--prepackaged', prepackagedDir)
  return new Promise(resolveRun => {
    const child = spawn(process.execPath, args, { cwd: REPO, stdio: 'inherit', shell: false, env })
    let settled = false
    const finish = ok => {
      if (settled) return
      settled = true
      resolveRun(ok)
    }
    child.on('error', error => {
      log(`  ${label} 失败：${error.message}`)
      finish(false)
    })
    child.on('close', code => {
      if (code !== 0) log(`  ${label} 失败（退出码 ${code}）`)
      finish(code === 0)
    })
  })
}

// ---------------------------------------------------------------------------
// exe 品牌：图标 + 版本信息
//
// electron-builder 默认靠 winCodeSign 里的 rcedit 改 exe 资源，那套东西要联网下载
// 且解压需要「创建符号链接」权限。这里直接用缓存里已解压好的 rcedit-x64.exe，
// 零下载、零特权。
// ---------------------------------------------------------------------------

/** electron-builder 的缓存根目录：ELECTRON_BUILDER_CACHE 优先，否则 LocalAppData。 */
function builderCacheDir() {
  const fromEnv = process.env.ELECTRON_BUILDER_CACHE
  if (fromEnv !== undefined && fromEnv !== '') return resolve(fromEnv)
  const localAppData = process.env.LOCALAPPDATA
  if (localAppData !== undefined && localAppData !== '') return join(localAppData, 'electron-builder', 'Cache')
  return join(REPO, 'node_modules', '.cache', 'electron-builder')
}

/** 在 electron-builder 缓存里找 rcedit-x64.exe；找不到返回 undefined。 */
function findRcedit() {
  const dir = join(builderCacheDir(), 'winCodeSign')
  if (!existsSync(dir)) return undefined
  let best
  for (const name of readdirSync(dir)) {
    const candidate = join(dir, name, 'rcedit-x64.exe')
    if (!existsSync(candidate)) continue
    let mtime = 0
    try { mtime = statSync(candidate).mtimeMs } catch { continue }
    if (best === undefined || mtime > best.mtime) best = { path: candidate, mtime }
  }
  return best?.path
}

/** 给 exe 打图标与版本信息；返回是否成功。 */
function brandExecutable(exePath) {
  const rcedit = findRcedit()
  if (rcedit === undefined) {
    log('  缓存里没有 rcedit-x64.exe，跳过图标/版本信息（exe 会保留 Electron 默认图标）')
    return false
  }
  if (!existsSync(ICON_PATH)) {
    log(`  找不到图标 ${ICON_PATH}，跳过品牌处理`)
    return false
  }
  const version = readVersion()
  const args = [
    exePath,
    '--set-version-string', 'FileDescription', 'dsh-ghost',
    '--set-version-string', 'ProductName', 'dsh-ghost',
    '--set-version-string', 'CompanyName', 'dsh-ghost',
    '--set-version-string', 'LegalCopyright', 'Copyright (c) 2026 dsh-ghost',
    '--set-version-string', 'InternalName', 'dsh-ghost',
    '--set-version-string', 'OriginalFilename', 'dsh-ghost.exe',
    '--set-file-version', version,
    '--set-product-version', version,
    '--set-icon', ICON_PATH,
  ]
  const result = spawnSync(rcedit, args, { stdio: 'pipe', shell: false })
  if (result.status !== 0) {
    log(`  rcedit 失败（退出码 ${result.status}）：${String(result.stderr ?? '').trim().slice(0, 200)}`)
    return false
  }
  log(`  已用 rcedit 写入图标与版本信息（${version}）`)
  return true
}

/** 读根 package.json 的版本号；读不到退回 0.0.0。 */
function readVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))
    return typeof pkg.version === 'string' && pkg.version !== '' ? pkg.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

// ---------------------------------------------------------------------------
// 0. 前置检查
// ---------------------------------------------------------------------------
step('前置检查')
if (!existsSync(BASE_CONFIG)) {
  process.stderr.write(`找不到打包配置: ${BASE_CONFIG}\n`)
  process.exit(1)
}
if (!existsSync(join(REPO, 'node_modules', 'electron-builder', 'cli.js'))) {
  process.stderr.write('缺少 electron-builder，请先 npm install\n')
  process.exit(1)
}
if (!existsSync(join(REPO, 'node_modules', 'electron', 'package.json'))) {
  process.stderr.write('缺少 electron 运行时，请先 npm install\n')
  process.exit(1)
}
log(`  目标平台   win x64`)
log(`  产物目录   ${args.outDir}`)

// ---------------------------------------------------------------------------
// 1. 编译：packages → shell bundle → 渲染层
// ---------------------------------------------------------------------------
if (!args.skipBuild) {
  step('编译')
  if (!runNpm(['run', 'build'], 'packages 编译')) process.exit(1)
  if (!runNpm(['run', 'build:shell'], '主进程 bundle')) process.exit(1)
  if (!runNpm(['run', 'build:ui'], '渲染层构建')) process.exit(1)
} else {
  step('编译（已跳过）')
}

// ---------------------------------------------------------------------------
// 2. harness 运行时：缺就复制，好就复用
// ---------------------------------------------------------------------------
const runtimeSource = resolveDshModules()
let runtimeIncluded = false
if (args.skipRuntime) {
  step('harness 运行时（已按 --skip-runtime 跳过）')
  log('  包内不含 resources/runtime，宿主起不来，只能验证 UI 层')
} else {
  step('harness 运行时')
  log(`  来源 ${runtimeSource}`)
  if (!existsSync(join(runtimeSource, '@deepseek-ai', 'dsh', 'lib', 'bin.js'))) {
    process.stderr.write('运行时来源不完整：找不到 @deepseek-ai/dsh/lib/bin.js\n设 DSH_DSH_MODULES 指向含 @deepseek-ai/dsh 的 node_modules，或加 --skip-runtime 只要 UI。\n')
    process.exit(1)
  }
  // prepare-runtime 自己判断要不要重拷：来源没变就只同步插件层，
  // 不重拷那 580MB / 1.4 万文件（一次十几分钟）。
  const result = spawnSync(process.execPath, [
    join(REPO, 'scripts', 'prepare-runtime.mjs'), '--apply',
    ...(args.forceRuntime ? ['--force'] : []),
    '--modules', runtimeSource,
  ], { cwd: REPO, stdio: args.json ? 'ignore' : 'inherit', shell: false })
  if (result.status !== 0) {
    process.stderr.write('运行时准备失败\n')
    process.exit(1)
  }
  runtimeIncluded = true
}

// ---------------------------------------------------------------------------
// 3. 生成便携版配置（基于 build/electron-builder.yml 改写，不另起一份真源）
// ---------------------------------------------------------------------------
step('生成打包配置')
const { default: yaml } = await import('js-yaml')
const baseConfig = yaml.load(readFileSync(BASE_CONFIG, 'utf8'))

const config = {
  ...baseConfig,
  directories: { ...baseConfig.directories, output: args.outDir },
  // 便携版用 normal 压缩：maximum 对 580MB 运行时太慢，收益却几乎为零。
  compression: 'normal',
  win: {
    ...baseConfig.win,
    // 关掉 electron-builder 自带的 exe 资源改写：它依赖要联网下载的 winCodeSign，
    // 且解压要求「创建符号链接」权限。图标与版本信息由本脚本用 rcedit 补上。
    signAndEditExecutable: false,
    target: [{ target: 'dir', arch: ['x64'] }],
  },
}
if (args.exe) {
  // 便携 .exe 和安装版 .exe 同名会混淆，单独给个名字。
  config.nsis = {
    ...(baseConfig.nsis ?? {}),
    artifactName: '${productName}-${version}-win-${arch}-portable.${ext}',
  }
}
if (config.publish !== undefined) delete config.publish
if (Array.isArray(config.extraResources)) {
  config.extraResources = config.extraResources.filter(entry => {
    const from = String(entry?.from ?? '').replace(/\\/g, '/')
    const isRuntime = from === 'build/runtime' || from.endsWith('/build/runtime')
    return !(isRuntime && !runtimeIncluded)
  })
}

const configDir = join(args.outDir, '.config')
mkdirSync(configDir, { recursive: true })
let configPath = join(configDir, 'electron-builder.portable.json')
const writeConfig = targets => {
  config.win.target = targets
  config.directories.output = args.outDir
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}
writeConfig(config.win.target)
log(`  ${configPath}`)

// ---------------------------------------------------------------------------
// 4. 打包
// ---------------------------------------------------------------------------
step('electron-builder 打包')

// 4a. 清掉上一次的产物目录。目录里若有正在运行的 dsh-ghost.exe，文件会被占用。
//     清不掉就换个编号的目录继续，别让一次残留把整条构建卡死。
let unpackedDir = join(args.outDir, 'win-unpacked')
if (existsSync(unpackedDir)) {
  let cleaned = false
  for (let attempt = 1; attempt <= 5 && !cleaned; attempt += 1) {
    try {
      rmSync(unpackedDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
      cleaned = true
    } catch (error) {
      log(`  清理上次的 win-unpacked 失败（第 ${attempt} 次）：${error.message}`)
    }
  }
  if (!cleaned) {
    let fallback = args.outDir
    for (let index = 2; index < 100; index += 1) {
      const candidate = `${args.outDir}-${index}`
      if (!existsSync(candidate)) { fallback = candidate; break }
    }
    log(`  旧目录被占用（多半是 dsh-ghost.exe 还在跑），改用 ${fallback}`)
    args.outDir = fallback
    unpackedDir = join(args.outDir, 'win-unpacked')
    mkdirSync(join(args.outDir, '.config'), { recursive: true })
    configPath = join(args.outDir, '.config', 'electron-builder.portable.json')
    writeConfig(config.win.target)
  }
}

const buildOk = await runBuilder(configPath, '打包')
if (!buildOk) {
  process.stderr.write('\n打包失败。常见原因：上一次 dsh-ghost.exe 还在运行占着文件，或 electron/electron-builder 没装全。\n')
  process.exit(1)
}

// 4b. exe 品牌：图标 + 版本信息（electron-builder 已关掉自带那套，见文件头说明）
const exePath = join(unpackedDir, 'dsh-ghost.exe')
let branded = false
if (!args.noBrand) {
  step('exe 品牌')
  if (existsSync(exePath)) branded = brandExecutable(exePath)
}

// 4c. zip / 单文件便携版：从**打好图标**的目录出，避免产物里是 Electron 默认图标
const archiveTargets = []
if (args.zip) archiveTargets.push({ target: 'zip', arch: ['x64'] })
if (args.exe) archiveTargets.push({ target: 'portable', arch: ['x64'] })
if (archiveTargets.length > 0) {
  step('打包 zip / 便携版')
  writeConfig(archiveTargets)
  const ok = await runBuilder(configPath, '打包 zip/便携版', {}, unpackedDir)
  if (!ok) {
    process.stderr.write('\nzip/便携版打包失败（免安装目录已经可用，可先拿目录测）。\n')
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// 5. 汇总
// ---------------------------------------------------------------------------
step('产物')
const exe = join(unpackedDir, 'dsh-ghost.exe')
const artifacts = []
if (existsSync(exe)) {
  const size = dirSize(unpackedDir)
  artifacts.push({
    kind: 'dir',
    path: unpackedDir,
    bytes: size.bytes,
    files: size.files,
    note: '免安装目录：双击 dsh-ghost.exe 直接跑',
  })
}
const artifactNames = readdirSync(args.outDir)
for (const [kind, pattern, note] of [
  ['zip', /^dsh-ghost-.*-win-x64\.zip$/, '解压即用'],
  ['exe', /^dsh-ghost-.*-win-x64-portable\.exe$/, '单文件便携版'],
]) {
  for (const name of artifactNames) {
    if (!pattern.test(name)) continue
    const full = join(args.outDir, name)
    artifacts.push({ kind, path: full, bytes: statSync(full).size, files: 1, note })
  }
}

const report = {
  ok: artifacts.length > 0,
  outDir: args.outDir,
  runtimeIncluded,
  artifacts: artifacts.map(a => ({ ...a, size: `${(a.bytes / 1024 / 1024).toFixed(1)} MB` })),
}
if (args.json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
} else {
  for (const a of report.artifacts) {
    process.stdout.write(`  [${a.kind}] ${a.path}\n         ${a.size}${a.files > 1 ? ` / ${a.files} 文件` : ''} — ${a.note}\n`)
  }
  if (!report.ok) process.stdout.write('\n没有产物，检查上面的构建日志。\n')
  else process.stdout.write('\n产物为未签名内部测试包，不能当正式发布物。\n')
}
process.exit(report.ok ? 0 : 1)
