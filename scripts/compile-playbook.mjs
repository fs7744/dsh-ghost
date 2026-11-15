#!/usr/bin/env node
/**
 * 编译一个剧本：`.flow` → 完整 skill 包（文本件）。
 *
 * 用法: node scripts/compile-playbook.mjs <file.flow> [--out <dir>] [--json]
 * 输出: SKILL.md（+ 若剧本带 @scripts/…，脚本需你自己放进去）
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, basename, resolve } from 'node:path'
import { compilePlaybook } from '../packages/playbook/src/index.ts'

const argv = process.argv.slice(2)
const input = argv.find(arg => !arg.startsWith('--'))
if (input === undefined) {
  process.stderr.write('用法: node scripts/compile-playbook.mjs <file.flow> [--out <dir>]\n')
  process.exit(2)
}
const outIndex = argv.indexOf('--out')
const outDir = resolve(outIndex >= 0 ? argv[outIndex + 1] : join('out', basename(input, '.flow')))
const text = readFileSync(resolve(input), 'utf8')

const result = compilePlaybook(text)

if (result.errors.length > 0) {
  process.stdout.write(`FAIL  ${result.errors.length} 处问题：\n`)
  for (const error of result.errors) process.stdout.write(`  - ${error}\n`)
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })
for (const [name, content] of Object.entries(result.files)) {
  writeFileSync(join(outDir, name), content)
}

process.stdout.write(`PASS  ${result.flow.id} v${result.flow.version ?? '?'}：${result.flow.nodes.length} 个节点 → ${outDir}\n`)
process.stdout.write(`      常驻 description ≈ ${result.tokens.description} token\n`)
process.stdout.write(`      按需正文     ≈ ${result.tokens.body} token\n`)
if (argv.includes('--json')) process.stdout.write(JSON.stringify({ tokens: result.tokens, files: Object.keys(result.files) }, null, 2) + '\n')
