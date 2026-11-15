#!/usr/bin/env node
/**
 * L2 会话回放基线（C4-03）：录制 / 回放 JSONL，比较前做确定性规范化。
 *
 * 录制时把真 agent + 真工具 + 真 prompt 的一轮交互落成 JSONL；回放时把新录制
 * 与基线逐行比较。比较前用 lib-models.mjs 的 normalizeRecord 去掉时间、id、
 * token 计数、耗时等易变字段，并对对象键排序，所以键顺序与这些字段的变化
 * 不会造成假红；只有语义字段变了才 diff 失败。
 *
 * 用法:
 *   node scripts/replay.mjs --replay                         自检：fixture 自比 + 扰动注入 + 语义差异检出
 *   node scripts/replay.mjs --replay --baseline <f> --actual <f>   比较两份 JSONL
 *   node scripts/replay.mjs --record --source <f> [--out <f>]       录制：规范化后写基线（无 --out 则打印 stdout）
 *   node scripts/replay.mjs --help
 *
 * 退出码: 0 diff 相等 / 1 diff 失败（或坏 JSONL）/ 2 用法或文件错误。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseJsonl, normalizeRecord, toNormalizedJsonl, diffRecords, stableStringify } from './lib-models.mjs'

const DEFAULT_BASELINE = join(import.meta.dirname, '..', 'tests', 'fixtures', 'session-baseline.jsonl')

function parseArgs(argv) {
  const valueOf = flag => {
    const index = argv.indexOf(flag)
    return index >= 0 ? argv[index + 1] : undefined
  }
  const known = new Set(['--replay', '--record', '--self-test', '--help', '-h', '--json',
    '--baseline', '--actual', '--source', '--out'])
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg.startsWith('--') && !known.has(arg)) {
      process.stderr.write(`未知参数: ${arg}\n`)
      process.exit(2)
    }
    if (['--baseline', '--actual', '--source', '--out'].includes(arg) && argv[i + 1] === undefined) {
      process.stderr.write(`${arg} 需要一个文件路径\n`)
      process.exit(2)
    }
  }
  return {
    replay: argv.includes('--replay') || argv.includes('--self-test') || (!argv.includes('--record') && !argv.includes('--help') && !argv.includes('-h')),
    record: argv.includes('--record'),
    help: argv.includes('--help') || argv.includes('-h'),
    json: argv.includes('--json'),
    baseline: valueOf('--baseline') ?? DEFAULT_BASELINE,
    actual: valueOf('--actual'),
    source: valueOf('--source'),
    out: valueOf('--out'),
  }
}

function readOrExit(file, label) {
  if (!existsSync(file)) {
    process.stderr.write(`${label} 不存在: ${file}\n`)
    process.exit(2)
  }
  return readFileSync(file, 'utf8')
}

/** 给每条记录注入不同的易变值并反转键顺序，模拟「同一轮交互的另一次录制」。 */
function perturb(text) {
  const rows = parseJsonl(text).records.map((row, index) => {
    const injected = {
      ...row.value,
      id: `replay-${index}`,
      at: `2026-12-01T00:00:0${index}.000Z`,
      requestId: `replay-req-${index}`,
      tokens: 900 + index,
      durationMs: 400 + index,
      usage: { total_tokens: 9999 },
    }
    const reversed = {}
    for (const key of Object.keys(injected).reverse()) reversed[key] = injected[key]
    return stableStringify(normalizeRecord(reversed))
  })
  return rows.join('\n') + (rows.length > 0 ? '\n' : '')
}

/** 改动一处语义字段，制造应当被 diff 抓到的差异。 */
function mutate(text) {
  const rows = parseJsonl(text).records.map(row => {
    const value = { ...row.value }
    if (value.kind === 'turn/end') value.state = 'running'
    return stableStringify(normalizeRecord(value))
  })
  return rows.join('\n') + (rows.length > 0 ? '\n' : '')
}

function printDiffs(result) {
  for (const item of result.diffs.slice(0, 20)) {
    const head = `  第 ${item.index} 行 ${item.reason}`
    if (item.reason === 'mismatch') process.stdout.write(`${head}\n    期望 ${item.expected}\n    实际 ${item.actual}\n`)
    else if (item.reason === 'missing') process.stdout.write(`${head}  期望 ${item.expected}\n`)
    else if (item.reason === 'extra') process.stdout.write(`${head}  实际 ${item.actual}\n`)
    else process.stdout.write(`${head}  ${item.side ?? ''} ${item.detail ?? ''}\n`)
  }
  if (result.diffs.length > 20) process.stdout.write(`  ...其余 ${result.diffs.length - 20} 条差异省略\n`)
}

function compare(expected, actual, label) {
  const result = diffRecords(expected, actual)
  const ok = result.equal
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}：比较 ${result.compared} 行，差异 ${result.diffs.length} 处\n`)
  if (!ok) printDiffs(result)
  return ok
}

function doReplay(args) {
  const baseline = readOrExit(args.baseline, '基线文件')
  let failures = 0
  const check = ok => { if (!ok) failures += 1 }

  if (args.actual !== undefined) {
    const actual = readOrExit(args.actual, '待比较文件')
    check(compare(baseline, actual, `${args.baseline} vs ${args.actual}`))
  } else {
    // 自检模式：不依赖外部服务，验证规范化管线本身。
    const parsed = parseJsonl(baseline)
    if (parsed.errors.length > 0) {
      process.stdout.write(`FAIL  基线含坏 JSONL：${parsed.errors.length} 行\n`)
      failures += 1
    }
    const normalized = toNormalizedJsonl(parsed.records.map(row => row.value))
    check(compare(baseline, normalized, '基线自比（规范化幂等）'))
    check(compare(baseline, perturb(baseline), '注入易变字段与键顺序扰动后仍相等'))
    const mutated = mutate(baseline)
    const mustDiffer = !diffRecords(baseline, mutated).equal
    process.stdout.write(`${mustDiffer ? 'PASS' : 'FAIL'}  语义字段被改动时必须 diff 失败\n`)
    check(mustDiffer)
  }
  if (args.json) {
    process.stdout.write(JSON.stringify({ ok: failures === 0, failures, baseline: args.baseline, actual: args.actual ?? '(自检)' }) + '\n')
  }
  process.stdout.write(`\n${failures === 0 ? '回放通过' : `${failures} 项失败`}\n`)
  process.exit(failures === 0 ? 0 : 1)
}

function doRecord(args) {
  if (args.source === undefined) {
    process.stderr.write('--record 需要 --source <file>\n')
    process.exit(2)
  }
  const source = readOrExit(args.source, '录制源文件')
  const parsed = parseJsonl(source)
  if (parsed.errors.length > 0) {
    process.stderr.write(`源文件含 ${parsed.errors.length} 行坏 JSONL，拒绝录制：\n`)
    for (const item of parsed.errors) process.stderr.write(`  第 ${item.line} 行 ${item.message}\n`)
    process.exit(1)
  }
  const normalized = toNormalizedJsonl(parsed.records.map(row => row.value))
  if (args.out !== undefined) {
    writeFileSync(args.out, normalized)
    process.stdout.write(`已录制 ${parsed.records.length} 行规范化基线 -> ${args.out}\n`)
  } else {
    process.stdout.write(normalized)
  }
  process.exit(0)
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    process.stdout.write([
      '用法: node scripts/replay.mjs [--replay | --record] [选项]',
      '',
      '  --replay                         自检（缺省）：fixture 自比 + 扰动注入 + 语义差异检出',
      '  --replay --baseline <f> --actual <f>   比较两份 JSONL',
      '  --record --source <f> [--out <f>]      录制规范化基线，无 --out 则打印到 stdout',
      '  --json                           自检模式额外输出结构化结果',
      '',
      '规范化: 去掉时间 / id / token 计数 / 耗时等易变字段，对象键排序；数组顺序保留。',
      '退出码: 0 diff 相等 / 1 diff 失败或坏 JSONL / 2 用法或文件错误',
    ].join('\n') + '\n')
    return
  }
  if (args.record) doRecord(args)
  else doReplay(args)
}

main()
