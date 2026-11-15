#!/usr/bin/env node
/**
 * import 纪律检查（C1-05）：守 PLAN §5.2 / §14 的硬边界。
 *
 * 硬边界：除 packages/harness-port/** 外，全仓库任何源码不得 import 或 require
 * @deepseek-ai 包；且任何地方都不得引用 @deepseek-ai 包的 src 内部路径 内部路径。
 *
 * 已知现状（默认模式列为 WARN、只统计不阻断）：
 *   memory-plugin / orchestrator-plugin 的入口用了 TypertRemoteService 装饰器与
 *   cordis Context 类型，这是宿主插件槽位的必需依赖，登记在下方 PORT_ALLOWLIST。
 *   这些白名单项不会一直留着：等 app 迁入 / Remote 迁移完成再逐条移除。
 *   --strict 才把白名单项也判为失败，供 P3 收口或发版前自检。
 *
 * 用法:
 *   node scripts/check-port-discipline.mjs [--strict] [--json] [--root <dir>] [--help]
 *
 * 退出码（CI 约定）:
 *   0 = 无 error 级违规（默认模式下已登记白名单 WARN 不算失败）
 *   1 = 存在 error 级违规（非白名单直连、内部路径，或 strict 下的白名单项）
 *   2 = 用法/环境错误（未知参数、扫描根目录不存在）
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { classifyImports } from './lib-models.mjs'

const DEFAULT_ROOT = join(import.meta.dirname, '..')

/**
 * 已登记白名单：相对仓库根的 POSIX 路径 -> 理由。
 * 常量刻意放在本脚本内（不读外部配置），改动要跟着代码评审一起走。
 * 理由一句话：插件必须用 TypertRemoteService 装饰器把方法暴露成 Remote，
 * 装饰器类型与 cordis Context 只能从上游公开导出取，暂时无法经 port 层转译。
 */
const PORT_ALLOWLIST = new Map([
  ['packages/memory-plugin/src/index.ts',
    '插件必须用 TypertRemoteService 装饰器暴露 ghostMemory/* Remote；cordis Context 与 dsh-tools 类型只在此出现'],
  ['packages/orchestrator-plugin/src/index.ts',
    '同上：orchestrator 的 Remote 槽位依赖 TypertRemoteService 装饰器与 cordis Context 类型'],
])

// 用户明确要求排除的六个目录，外加不参与产品构建的目录与测试夹具目录。
// 测试夹具（tests/examples/fixtures/evals/e2e）里会放示例 import 字符串，
// 它们不是产品源码，不纳入纪律扫描；产品行为由 npm test 与 verify:* 覆盖。
const EXCLUDED_DIRS = new Set([
  'node_modules', 'lib', 'dist', 'spikes', '.git', '.dsh-home',
  '.ghost', '.dsh', 'out', '.workbuddy', '.github', 'docs',
  'tests', 'examples', 'fixtures', 'evals', 'e2e', 'coverage',
])

const SCAN_EXT = /\.(?:ts|tsx|mts|cts|js|mjs|cjs|jsx)$/

function parseArgs(argv) {
  const out = { root: DEFAULT_ROOT, strict: false, json: false, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--strict') out.strict = true
    else if (arg === '--json') out.json = true
    else if (arg === '--root') out.root = resolve(argv[++i] ?? '')
    else if (arg === '--help' || arg === '-h') out.help = true
    else {
      process.stderr.write(`未知参数: ${arg}\n`)
      process.exit(2)
    }
  }
  return out
}

/** 递归收集待扫源码文件；排除目录按名字整段跳过。 */
function scanFiles(root) {
  const out = []
  const walk = dir => {
    let entries = []
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue
        walk(full)
      } else if (entry.isFile() && SCAN_EXT.test(entry.name)) {
        out.push(full)
      }
    }
  }
  walk(root)
  return out.sort()
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    process.stdout.write([
      '用法: node scripts/check-port-discipline.mjs [--strict] [--json] [--root <dir>] [--help]',
      '',
      '  --strict  把已登记白名单项也判为失败；默认只统计 WARN、不阻断。',
      '  --json    输出结构化结果，供 CI 采集。',
      '  --root    扫描根目录，缺省为仓库根。',
      '',
      '退出码: 0 无 error 级违规 / 1 有 error 级违规 / 2 用法或环境错误',
      '硬边界: 除 packages/harness-port/** 外禁止 import/require @deepseek-ai 包；',
      '        任何位置禁止 @deepseek-ai 包的 src 内部路径 内部路径。',
    ].join('\n') + '\n')
    process.exit(0)
  }
  if (!existsSync(args.root)) {
    process.stderr.write(`扫描根目录不存在: ${args.root}\n`)
    process.exit(2)
  }

  const files = scanFiles(args.root)
  const violations = []
  for (const file of files) {
    const rel = relative(args.root, file).replace(/\\/g, '/')
    let text
    try { text = readFileSync(file, 'utf8') } catch { continue }
    violations.push(...classifyImports(text, rel, { allowlist: PORT_ALLOWLIST, strict: args.strict }))
  }
  const errors = violations.filter(item => item.severity === 'error')
  const warns = violations.filter(item => item.severity === 'warn')

  if (args.json) {
    process.stdout.write(JSON.stringify({
      root: args.root,
      scanned: files.length,
      strict: args.strict,
      counts: { error: errors.length, warn: warns.length },
      violations,
    }, null, 2) + '\n')
    process.exit(errors.length > 0 ? 1 : 0)
  }

  const line = (text = '') => process.stdout.write(`${text}\n`)
  line(`import 纪律检查（${args.strict ? 'strict 模式：白名单也判失败' : '默认模式：已登记白名单 WARN 不阻断'}）`)
  line(`扫描    ${files.length} 个源码文件（排除 node_modules/lib/dist/spikes/.git/.dsh-home 与测试夹具目录）`)
  line(`结果    ERROR ${errors.length} 处 · WARN ${warns.length} 处`)
  line('')
  const print = (item, tag) => {
    line(`${tag}  ${item.file}:${item.line}  [${item.kind}]  ${item.spec}`)
    if (item.whitelisted) line(`       白名单理由：${item.reason ?? '已登记'}`)
    else if (item.internal) line('       红线：禁止 @deepseek-ai 包的 src 内部路径 内部路径，改用公开导出')
    else line('       修法：把依赖收进 packages/harness-port/**，不要直连 harness')
  }
  for (const item of errors) print(item, 'ERROR')
  for (const item of warns) print(item, 'WARN ')
  if (violations.length === 0) line('（没有任何 @deepseek-ai 引用）')
  line('')

  if (errors.length > 0) {
    line(`结论: ${errors.length} 处 error 级违规 —— 先改 port 层，不要改 harness 源码。`)
    process.exit(1)
  }
  line(warns.length > 0
    ? `结论: 无 error 级违规，默认模式通过；${warns.length} 处白名单 WARN 待迁移，可用 --strict 自检。`
    : '结论: 全部通过，没有绕过 port 层的直连。')
  process.exit(0)
}

main()
