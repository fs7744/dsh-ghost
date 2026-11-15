#!/usr/bin/env node
/**
 * 门禁总检（C2-03 / C4-06）：把 7 项子检查的结果汇总成一张表，exit 码正确。
 *
 * 调用 check-port-discipline、verify-events、check:secrets、typecheck、test、
 * check:ui、check:shell，每项独立执行、互不影响；最后用 lib-models.mjs 的
 * summarizeGates 汇总。
 * 这张表可作为升级 harness 前后的对照基线（见 docs/UPGRADE.md）。
 *
 * 用法:
 *   node scripts/verify-gates.mjs [--json] [--help]
 *
 * 退出码: 0 全部通过 / 1 至少一项失败 / 2 用法错误。
 */
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { summarizeGates } from './lib-models.mjs'

const REPO = join(import.meta.dirname, '..')

// 第一项等价于集成后注册的 npm run verify:port-discipline；此处直接调脚本，
// 保证根 package.json 尚未登记时也能自检。其余都是已存在的 npm run 命令名。
const GATES = [
  { name: 'check-port-discipline', command: 'node scripts/check-port-discipline.mjs' },
  { name: 'verify-events', command: 'node scripts/verify-events.mjs' },
  { name: 'check:secrets', command: 'npm run check:secrets' },
  { name: 'typecheck', command: 'npm run typecheck' },
  { name: 'test', command: 'npm run test' },
  { name: 'check:ui', command: 'npm run check:ui' },
  { name: 'check:shell', command: 'npm run check:shell' },
]

const stripAnsi = text => text.replace(/\u001b\[[0-9;]*m/g, '')
const lastLine = text => {
  const lines = stripAnsi(text).split('\n').map(line => line.trim()).filter(line => line !== '')
  return lines.at(-1) ?? ''
}

function run(gate) {
  const started = Date.now()
  try {
    const out = execSync(gate.command, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { name: gate.name, ok: true, durationMs: Date.now() - started, detail: lastLine(out) }
  } catch (error) {
    const text = `${error.stdout ?? ''}${error.stderr ?? ''}`
    return {
      name: gate.name,
      ok: false,
      durationMs: Date.now() - started,
      detail: lastLine(text) || `exit ${String(error.status ?? '?')}`,
    }
  }
}

function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write([
      '用法: node scripts/verify-gates.mjs [--json] [--help]',
      '',
      `  依次执行 ${GATES.length} 项门禁并汇总成表：`,
      ...GATES.map((gate, index) => `    ${index + 1}. ${gate.name}  (${gate.command})`),
      '',
      '退出码: 0 全部通过 / 1 至少一项失败 / 2 用法错误',
    ].join('\n') + '\n')
    return
  }
  const results = []
  for (const gate of GATES) {
    process.stdout.write(`运行  ${gate.name} ...\n`)
    results.push(run(gate))
  }
  const summary = summarizeGates(results)
  process.stdout.write(`\n${summary.table}\n`)
  process.stdout.write(`\n结论: ${summary.passed}/${summary.rows.length} 通过${summary.allPass ? '' : `，${summary.failed} 项失败`}\n`)
  if (argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ rows: summary.rows, passed: summary.passed, failed: summary.failed, allPass: summary.allPass, exitCode: summary.exitCode }) + '\n')
  }
  process.exit(summary.exitCode)
}

main()
