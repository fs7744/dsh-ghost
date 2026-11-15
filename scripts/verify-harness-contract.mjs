#!/usr/bin/env node
/**
 * harness 契约探针。
 *
 * 只读地扫描一份 deepseek-harness 检出，逐项核对 contract.json 里声明的外部面是否还在。
 * 不写 harness、不装依赖、不改任何文件——这是「只升级 harness、不改 harness」的守门人：
 * 升级前跑一次，就知道这次升级会把 superagent 的哪几处打穿，且只需在 superagent 侧修。
 *
 * 用法:
 *   node scripts/verify-harness-contract.mjs [--harness <dir>] [--contract <file>] [--json] [--verbose]
 *
 * 退出码: 0 = 无 error 级漂移；1 = 有；2 = 用法/环境错误。
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCE_EXT = /\.(ts|tsx|mts)$/

/** 解析 argv。 */
function parseArgs(argv) {
  const out = { harness: process.env.DSH_HARNESS_ROOT, contract: join(HERE, '..', 'harness-contract', 'contract.json'), json: false, verbose: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--harness') out.harness = argv[++i]
    else if (arg === '--contract') out.contract = argv[++i]
    else if (arg === '--json') out.json = true
    else if (arg === '--verbose') out.verbose = true
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write('node scripts/verify-harness-contract.mjs [--harness <dir>] [--contract <file>] [--json] [--verbose]\n')
      process.exit(0)
    } else {
      process.stderr.write(`未知参数: ${arg}\n`)
      process.exit(2)
    }
  }
  return out
}

/** 没有显式传入时，按常见布局猜 harness 根目录。 */
function resolveHarness(explicit) {
  const candidates = explicit
    ? [explicit]
    : [join(HERE, '..', '..', 'deepseek-harness-master'), join(HERE, '..', '..', 'deepseek-harness'), join(HERE, '..', 'harness')]
  for (const candidate of candidates) {
    const dir = resolve(candidate)
    if (existsSync(join(dir, 'packages')) && existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
  }
  process.stderr.write(`没找到 harness 检出，用 --harness <dir> 指定。试过:\n${candidates.map(c => '  ' + resolve(c)).join('\n')}\n`)
  process.exit(2)
}

/** 建立 包名 -> 包目录 索引（只扫普通 workspace 目录）。 */
function indexPackages(harness) {
  const index = new Map()
  // packages/<group>/<pkg> 与 apps/<app> 是「一组装着多个包」；vendor/<pkg> 直接就是包。
  const groups = [
    ...readdirSync(join(harness, 'packages')).map(name => join(harness, 'packages', name)),
    ...(existsSync(join(harness, 'apps')) ? readdirSync(join(harness, 'apps')).map(name => join(harness, 'apps', name)) : []),
  ]
  const leaves = existsSync(join(harness, 'vendor')) ? readdirSync(join(harness, 'vendor')).map(name => join(harness, 'vendor', name)) : []
  for (const dir of leaves) {
    const manifest = join(dir, 'package.json')
    if (!existsSync(manifest)) continue
    try {
      const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
      if (typeof pkg.name === 'string') index.set(pkg.name, { dir, manifest, pkg })
    } catch {
      // 忽略坏清单
    }
  }
  for (const groupDir of groups) {
    let entries = []
    try {
      entries = readdirSync(groupDir)
    } catch {
      continue
    }
    for (const entry of entries) {
      const dir = join(groupDir, entry)
      const manifest = join(dir, 'package.json')
      if (!existsSync(manifest)) continue
      try {
        const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
        if (typeof pkg.name === 'string') index.set(pkg.name, { dir, manifest, pkg })
      } catch {
        // 一个坏清单不该让整次巡检失败
      }
    }
  }
  return index
}

/** 深度收集某目录下的源码文本；scope 为相对包根的子目录，缺该目录时退回 src。 */
function readSources(entry, scope, cache) {
  const key = `${entry.dir}|${scope ?? ''}`
  if (cache.has(key)) return cache.get(key)
  const scoped = scope ? join(entry.dir, scope) : undefined
  const root = scoped && existsSync(scoped) ? scoped : join(entry.dir, 'src')
  const files = []
  const walk = dir => {
    let entries = []
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const child of entries) {
      const full = join(dir, child.name)
      if (child.isDirectory()) {
        if (child.name === 'node_modules' || child.name === 'lib' || child.name === 'tests') continue
        walk(full)
      } else if (SOURCE_EXT.test(child.name)) {
        try {
          files.push({ path: full, text: readFileSync(full, 'utf8') })
        } catch {
          // 读不了就跳过
        }
      }
    }
  }
  walk(root)
  cache.set(key, files)
  return files
}

const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 值导出、类型导出、或某处的声明——三种都算命中（barrel 由全包扫描覆盖）。 */
function hasExport(files, name) {
  const n = escape(name)
  const patterns = [
    new RegExp(`export\\s+(?:declare\\s+)?(?:abstract\\s+)?(?:default\\s+)?(?:async\\s+)?(?:function|const|let|var|class|type|interface|enum)\\s+${n}\\b`),
    new RegExp(`export\\s+(?:type\\s+)?\\{[^}]*\\b${n}\\b`),
  ]
  return files.some(file => patterns.some(pattern => pattern.test(file.text)))
}

function hasService(files, name) {
  const n = escape(name)
  const patterns = [
    new RegExp(`^\\s{2,}${n}\\s*:\\s*`, 'm'),
    new RegExp(`super\\(ctx,\\s*['"]${n}['"]`),
    new RegExp(`\\bname\\s*=\\s*['"]${n}['"]`),
  ]
  return files.some(file => patterns.some(pattern => pattern.test(file.text)))
}

function hasString(files, name) {
  const n = escape(name)
  return files.some(file => new RegExp(`['"\`]${n}['"\`]`).test(file.text))
}

function hasMember(files, name) {
  const n = escape(name)
  return files.some(file => new RegExp(`\\b${n}\\s*(?:<[^>()]*>)?\\s*\\(`).test(file.text))
}

/** Remote 端点 = 服务构造里的 namespace + 装饰器上的方法名（两者都要在）。 */
function hasRemote(files, check) {
  const ns = new RegExp(`namespace:\\s*['"]${escape(check.namespace)}['"]`)
  const named = new RegExp(`@Remote\\(\\s*['"]${escape(check.name)}['"]`)
  const bare = new RegExp(`@Remote\\b\\s*\\n\\s*(?:public\\s+)?(?:async\\s+)?${escape(check.name)}\\s*\\(`)
  const hasNamespace = files.some(file => ns.test(file.text))
  const hasMethod = files.some(file => named.test(file.text) || bare.test(file.text))
  return hasNamespace && hasMethod
}

function hasField(files, name) {
  const n = escape(name)
  return files.some(file => new RegExp(`\\b${n}\\??\\s*:`).test(file.text))
}

/** 跑一条检查；fallbackPackages 用于「Config 继承自别的包」这类间接声明。 */
function evaluate(check, index, cache) {
  const primary = runCheck(check, check.package, index, cache)
  if (primary.status === 'ok' || !check.fallbackPackages) return primary
  for (const name of check.fallbackPackages) {
    if (runCheck(check, name, index, cache).status === 'ok') return { status: 'ok', detail: `经 ${name}` }
  }
  return primary
}

/** 针对某一个包执行一条检查。 */
function runCheck(check, packageName, index, cache) {
  const entry = index.get(packageName)
  if (!entry) return { status: 'drift', detail: `包不存在: ${packageName}` }
  if (check.exports) {
    const missing = check.exports.filter(sub => entry.pkg.exports?.[sub] === undefined)
    if (missing.length > 0) return { status: 'drift', detail: `缺少导出子路径 ${missing.join(', ')}` }
  }
  if (check.kind === 'package') return { status: 'ok', detail: entry.pkg.version ?? '' }

  const files = readSources(entry, check.scope, cache)
  if (files.length === 0) return { status: 'drift', detail: `找不到源码目录 ${check.scope ?? 'src'}` }
  const found = {
    symbol: hasExport,
    service: hasService,
    event: hasString,
    slot: hasString,
    manifestfield: hasField,
    configkey: hasField,
    method: hasMember,
    remote: hasRemote,
  }[check.kind]
  if (!found) return { status: 'drift', detail: `未知检查类型 ${check.kind}` }
  return found(files, check.kind === 'remote' ? check : check.name)
    ? { status: 'ok', detail: '' }
    : { status: 'drift', detail: `未找到 ${check.name}` }
}

/** 主流程。 */
function main() {
  const args = parseArgs(process.argv.slice(2))
  const harness = resolveHarness(args.harness)
  const contract = JSON.parse(readFileSync(resolve(args.contract), 'utf8'))
  const index = indexPackages(harness)
  const cache = new Map()
  const rootPkg = JSON.parse(readFileSync(join(harness, 'package.json'), 'utf8'))
  const cordis = index.get('@deepseek-ai/cordis')

  const results = contract.checks.map(check => ({ check, ...evaluate(check, index, cache) }))
  const drift = results.filter(r => r.status === 'drift')
  const errors = drift.filter(r => r.check.severity === 'error')
  const warnings = drift.filter(r => r.check.severity === 'warn')

  if (args.json) {
    process.stdout.write(JSON.stringify({
      harness: { root: harness, version: rootPkg.version, cordis: cordis?.pkg.version },
      total: results.length,
      ok: results.length - drift.length,
      errors: errors.map(r => ({ id: r.check.id, package: r.check.package, detail: r.detail, why: r.check.why })),
      warnings: warnings.map(r => ({ id: r.check.id, package: r.check.package, detail: r.detail, why: r.check.why })),
    }, null, 2) + '\n')
    process.exit(errors.length > 0 ? 1 : 0)
  }

  const line = (text = '') => process.stdout.write(`${text}\n`)
  line(`harness   ${rootPkg.version ?? '?'}  (cordis ${cordis?.pkg.version ?? '?'})`)
  line(`root      ${harness}`)
  line(`contract  ${results.length} 项检查 (error ${results.filter(r => r.check.severity === 'error').length} / warn ${results.filter(r => r.check.severity === 'warn').length})`)
  line('')

  const groups = ['package', 'symbol', 'service', 'event', 'slot', 'manifestfield', 'configkey', 'method', 'remote']
  const label = { package: '包与导出子路径', symbol: '导出符号', service: 'ctx 服务键', event: '事件', slot: '客户端槽位', manifestfield: '清单字段', configkey: 'patch 配置键', method: '服务方法', remote: 'Remote 端点' }
  for (const kind of groups) {
    const rows = results.filter(r => r.check.kind === kind)
    if (rows.length === 0) continue
    const bad = rows.filter(r => r.status === 'drift')
    const mark = bad.length === 0 ? 'ok  ' : 'DRIFT'
    line(`${mark}  ${label[kind].padEnd(18)} ${String(rows.length - bad.length).padStart(3)}/${String(rows.length).padStart(3)}`)
    if (args.verbose || bad.length > 0) {
      for (const row of bad) line(`        ${row.check.severity === 'error' ? 'x' : '!'} ${row.check.id.padEnd(42)} ${row.detail}  · ${row.check.why}`)
    }
  }
  line('')

  if (errors.length === 0 && warnings.length === 0) {
    line('结论: 全部通过。这次 harness 升级不需要改 superagent 的契约层。')
    process.exit(0)
  }
  if (errors.length === 0) {
    line(`结论: ${warnings.length} 项 warn 级漂移，可能是改名或启发式误报；跑 pnpm typecheck 定性，再决定是否改 port 层。`)
    process.exit(0)
  }
  line(`结论: ${errors.length} 项 error 级漂移 —— 这些必须在 superagent 侧修（port 层），不要改 harness。`)
  process.exit(1)
}

main()
