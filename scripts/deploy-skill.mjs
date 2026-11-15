#!/usr/bin/env node
/**
 * 剧本投放器：`.flow` → `<repo>/.dsh/skills/<id>/SKILL.md`
 *
 * harness 的技能扫描根（rank 100）= `<projectRoot>/.dsh/skills`，其中 projectRoot 是
 * 最近的 `.git` 祖先目录。所以投放后，cwd 在本仓库内的会话能立刻发现它。
 *
 * 用法: node --experimental-strip-types scripts/deploy-skill.mjs <file.flow> [--root <dir>]
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compilePlaybook } from '../packages/playbook/src/index.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const argv = process.argv.slice(2)
const input = argv.find(arg => !arg.startsWith('--'))
if (input === undefined) {
  process.stderr.write('用法: node --experimental-strip-types scripts/deploy-skill.mjs <file.flow> [--root <dir>]\n')
  process.exit(2)
}
const rootIndex = argv.indexOf('--root')
const skillsRoot = resolve(rootIndex >= 0 ? argv[rootIndex + 1] : join(REPO, '.dsh', 'skills'))

const source = resolve(input)
const result = compilePlaybook(readFileSync(source, 'utf8'))
if (result.errors.length > 0) {
  process.stdout.write(`FAIL  剧本有 ${result.errors.length} 处问题，未投放：\n`)
  for (const error of result.errors) process.stdout.write(`  - ${error}\n`)
  process.exit(1)
}

const target = join(skillsRoot, result.flow.id)
mkdirSync(target, { recursive: true })
for (const [name, content] of Object.entries(result.files)) writeFileSync(join(target, name), content)

// 剧本旁的 scripts/ 与 references/ 一起带过去（skill 包不只是一篇文档）。
for (const sub of ['scripts', 'references', 'assets']) {
  const from = join(dirname(source), sub)
  if (!existsSync(from)) continue
  const to = join(target, sub)
  mkdirSync(to, { recursive: true })
  for (const file of readdirSync(from)) copyFileSync(join(from, file), join(to, file))
}

process.stdout.write(`PASS  ${result.flow.id} → ${target}\n`)
process.stdout.write(`      常驻 ${result.tokens.description} + 正文 ${result.tokens.body} token\n`)
