#!/usr/bin/env node
/**
 * C1-04 升级流水线：升级 harness 的唯一入口（PLAN §5.3）。
 *
 *   node scripts/upgrade-harness.mjs <version> [--apply] [--commit]
 *
 * 固定 8 步顺序（lib-models.mjs 的 buildUpgradePlan 是唯一真相源），任一步失败即停，
 * 并打印该改哪个 port 文件 —— 永远改我们这边，不改 harness 源码、不 fork。
 *
 * 默认 --dry-run：只打印计划，不执行命令、不改任何文件。
 * --apply 才真正落盘（步骤 1 改根 package.json 版本、步骤 8 写 matrix.json）并按序执行。
 * --commit 只在 --apply 下有效：只提交 harness-contract/matrix.json 这一个文件，
 * 且脚本绝不执行 git push。并行开发下默认不自动提交，避免裹挟其它未提交改动。
 *
 * 步骤 1 的版本改写实现在 lib-models.mjs 的 rewritePackageVersions；此刻不要真的
 * 运行 --apply 去改根 package.json，日常只用 --dry-run 看计划。
 *
 * 用法:
 *   node scripts/upgrade-harness.mjs 0.2.3
 *   node scripts/upgrade-harness.mjs 0.2.3 --cordis 4.2.0 --json
 *   node scripts/upgrade-harness.mjs 0.2.3 --apply [--commit] [--harness <dir>]
 *
 * 退出码: 0 计划打印完 / 全流程通过；1 任一步失败或版本不合法；2 用法/环境错误。
 */
import { execFileSync, execSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { buildUpgradePlan, validateVersion, rewritePackageVersions } from './lib-models.mjs'
import { resolveHarnessRoot, harnessCandidates } from './harness-paths.mjs'

const REPO = join(import.meta.dirname, '..')
const PKG = join(REPO, 'package.json')
const MATRIX = join(REPO, 'harness-contract', 'matrix.json')
const REMOTES = join(REPO, 'harness-contract', 'remotes.json')
const PROBE = join(REPO, 'scripts', 'verify-harness-contract.mjs')
const GEN_REMOTES = join(REPO, 'harness-contract', 'gen-remotes.mjs')
const GEN_EVENTS = join(REPO, 'harness-contract', 'gen-events.mjs')

function parseArgs(argv) {
  const out = { version: undefined, apply: false, commit: false, json: false, help: false, cordis: undefined, harness: undefined }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--apply') out.apply = true
    else if (arg === '--dry-run') out.apply = false
    else if (arg === '--commit') out.commit = true
    else if (arg === '--json') out.json = true
    else if (arg === '--help' || arg === '-h') out.help = true
    else if (arg === '--cordis') { out.cordis = argv[++i]; if (out.cordis === undefined) { process.stderr.write('--cordis 需要版本号\n'); process.exit(2) } }
    else if (arg === '--harness') { out.harness = argv[++i]; if (out.harness === undefined) { process.stderr.write('--harness 需要目录\n'); process.exit(2) } }
    else if (arg.startsWith('-')) { process.stderr.write(`未知参数: ${arg}\n`); process.exit(2) }
    else if (out.version === undefined) out.version = arg
    else { process.stderr.write(`多余的位置参数: ${arg}\n`); process.exit(2) }
  }
  return out
}

function help() {
  process.stdout.write([
    '用法: node scripts/upgrade-harness.mjs <version> [选项]',
    '',
    '  <version>       新 harness 版本，如 0.2.3 / 0.2.3-rc.1',
    '  --dry-run       缺省行为：只打印 8 步计划，不执行命令、不改文件',
    '  --apply         真正按序执行并把版本与 matrix.json 落盘',
    '  --commit        仅 --apply 下有效：只提交 matrix.json，绝不 push',
    '  --cordis <v>    连 cordis 一起升（缺省保持现状，它是独立版本线）',
    '  --harness <dir> 传给契约探针的源码检出（也可设 DSH_HARNESS_ROOT）',
    '  --json          dry-run 输出结构化计划',
    '',
    '固定步骤: 改版本 -> 提示 install -> 重生成 Remote/事件表 + 契约探针 -> typecheck -> test -> 冒烟 -> 界面回归提示 -> 写 matrix',
    '失败即停并打印该改的 port 文件；永不改 harness 源码、永不 fork、永不自动 git push。',
    '',
    '退出码: 0 计划打印完/全流程通过 · 1 任一步失败或版本不合法 · 2 用法/环境错误',
  ].join('\n') + '\n')
}

/** 读当前 cordis 版本（步骤 8 写 matrix 用）。 */
function currentCordis() {
  const pkg = JSON.parse(readFileSync(PKG, 'utf8'))
  return pkg.dependencies?.['@deepseek-ai/cordis'] ?? pkg.devDependencies?.['@deepseek-ai/cordis'] ?? 'unknown'
}

/** dry-run：只打印计划，不产生任何副作用。 */
function printPlan(args, plan) {
  if (args.json) {
    process.stdout.write(JSON.stringify({ version: args.version, apply: false, cordis: args.cordis ?? '(保持现状)', steps: plan.steps }, null, 2) + '\n')
    return
  }
  const line = (text = '') => process.stdout.write(`${text}\n`)
  const found = resolveHarnessRoot(args.harness)
  line(`升级计划（dry-run：只打印，不落盘、不执行命令）`)
  line(`目标版本    ${args.version}`)
  line(`cordis      ${args.cordis ?? `保持 ${currentCordis()}（用 --cordis <v> 才一起升）`}`)
  line(`harness 检出 ${found ?? '未找到（--apply 时探针会严格校验；候选：' + harnessCandidates(args.harness).join(' / ') + '）'}`)
  line('')
  for (let i = 0; i < plan.steps.length; i += 1) {
    const step = plan.steps[i]
    line(`  ${String(i + 1).padStart(2)}. ${step.mutates ? '[落盘]' : '[    ]'} ${step.label}`)
    line(`       命令      ${step.command ?? '（脚本内部处理 / 人工提示）'}`)
    line(`       失败改这里 ${step.portHint}`)
  }
  line('')
  line('加 --apply 才真正按序执行并落盘；加 --apply --commit 才提交 matrix.json（脚本绝不 push）。')
}

/** 执行单步；抛异常即表示失败，由主流程捕获并打印 portHint。 */
function executeStep(step, args, ctx) {
  switch (step.id) {
    case 'change-version': {
      const before = readFileSync(PKG, 'utf8')
      const { text, changed } = rewritePackageVersions(before, args.version, args.cordis)
      writeFileSync(PKG, text)
      return `改了 ${changed.length} 个版本键` + (changed.length > 0 ? `：${changed.map(item => `${item.key} ${item.from} -> ${item.to}`).join('; ')}` : '')
    }
    case 'install':
      return '请运行 pnpm install 或 npm install 拉取新版本（脚本不自动装依赖）'
    case 'verify-contract': {
      // 升级后描述符可能变了：先重生成两个生成物，再验事件漂移，最后跑宿主侧契约探针。
      // 顺序不能倒——否则探针比的是上一版的端点/事件表。
      execFileSync(process.execPath, [GEN_REMOTES, '--ts', 'packages/harness-port/src/remotes.generated.ts'], { cwd: REPO, stdio: 'inherit' })
      execFileSync(process.execPath, [GEN_EVENTS], { cwd: REPO, stdio: 'inherit' })
      execSync('npm run verify:events', { cwd: REPO, stdio: 'inherit' })
      const extra = args.harness === undefined ? [] : ['--harness', args.harness]
      const out = execFileSync(process.execPath, [PROBE, '--json', ...extra], { cwd: REPO, encoding: 'utf8' })
      const report = JSON.parse(out)
      ctx.probe = { total: report.total, passed: report.ok, errors: Array.isArray(report.errors) ? report.errors.length : 0 }
      if (ctx.probe.errors > 0) throw new Error(`契约探针 ${ctx.probe.errors} 项 error 级漂移`)
      return `Remote/事件表已重生成，事件契约无漂移，契约探针 ${ctx.probe.passed}/${ctx.probe.total} 通过`
    }
    case 'typecheck':
      execSync('npm run typecheck', { cwd: REPO, stdio: 'inherit' })
      return 'typecheck 通过'
    case 'test':
      execSync('npm test', { cwd: REPO, stdio: 'inherit' })
      return 'test 通过'
    case 'smoke':
      execSync('npm run verify:plugin-boot', { cwd: REPO, stdio: 'inherit' })
      return '只装我们 bundle 的 profile 装载通过；一条 Ticket 的完整冒烟用 npm run ticket（需真模型 key）'
    case 'ui-regression':
      return '提示：L5 每日跑、不进 PR；本次不执行，请另行 npm run verify:l5'
    case 'write-matrix': {
      const matrix = existsSync(MATRIX) ? JSON.parse(readFileSync(MATRIX, 'utf8')) : { schema: 1, entries: [] }
      const endpoints = existsSync(REMOTES) ? JSON.parse(readFileSync(REMOTES, 'utf8')).endpoints : null
      const entry = {
        harness: args.version,
        date: new Date().toISOString().slice(0, 10),
        cordis: args.cordis ?? currentCordis(),
        probe: ctx.probe ?? { total: null, passed: null, errors: null },
        endpoints: endpoints ?? null,
        result: 'pass',
        note: '由 upgrade-harness.mjs --apply 生成；脚本未执行 git push。',
      }
      const previous = Array.isArray(matrix.entries) ? matrix.entries.filter(item => item.harness !== args.version) : []
      matrix.schema = 1
      matrix.entries = [...previous, entry]
      writeFileSync(MATRIX, `${JSON.stringify(matrix, null, 2)}\n`)
      if (args.commit) {
        // 只暂存并提交这一个文件；用参数数组避免任何命令注入，且绝不 push。
        execFileSync('git', ['add', 'harness-contract/matrix.json'], { cwd: REPO, stdio: 'inherit' })
        execFileSync('git', ['commit', '-m', `chore(harness): verify ${args.version}`, '--', 'harness-contract/matrix.json'], { cwd: REPO, stdio: 'inherit' })
        return `已写并提交 matrix.json（仅此一文件，未 push）：探针 ${entry.probe.passed}/${entry.probe.total}、端点 ${entry.endpoints}`
      }
      return `已写 matrix.json：探针 ${entry.probe.passed}/${entry.probe.total}、端点 ${entry.endpoints}；请人工提交（脚本绝不 push）`
    }
    default:
      throw new Error(`未知步骤 ${step.id}`)
  }
}

function runApply(args, plan) {
  const line = (text = '') => process.stdout.write(`${text}\n`)
  const ctx = {}
  line(`升级执行（--apply）  目标 ${args.version}`)
  for (let i = 0; i < plan.steps.length; i += 1) {
    const step = plan.steps[i]
    try {
      const detail = executeStep(step, args, ctx)
      line(`PASS  第 ${i + 1} 步 ${step.id}：${detail}`)
    } catch (error) {
      line(`FAIL  第 ${i + 1} 步 ${step.id}：${String(error).slice(0, 200)}`)
      line(`      该改的 port 文件: ${step.portHint}`)
      line('      修完从本步重跑 --apply；不要改 harness 源码、不要 fork。')
      process.exit(1)
    }
  }
  line('')
  line('结论: 8 步全部通过。请人工核对 matrix.json 后自行提交/推送（脚本未 push）。')
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) { help(); return }
  if (args.version === undefined) { process.stderr.write('缺少 <version>，用 --help 看用法\n'); process.exit(2) }
  if (!validateVersion(args.version)) { process.stdout.write(`版本号不合法: ${args.version}（要三段数字，可带预发布后缀）\n`); process.exit(1) }
  if (args.commit && !args.apply) { process.stderr.write('--commit 只在 --apply 下有效\n'); process.exit(2) }
  if (args.cordis !== undefined && !validateVersion(args.cordis)) { process.stdout.write(`cordis 版本号不合法: ${args.cordis}\n`); process.exit(1) }
  const plan = buildUpgradePlan(args.version)
  if (!args.apply) { printPlan(args, plan); return }
  runApply(args, plan)
}

main()
