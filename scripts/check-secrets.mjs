#!/usr/bin/env node
/**
 * 密钥扫描：确保没有任何真密钥进入版本库。
 *
 * 检查 `git ls-files` 里的每个文本文件，命中即失败。
 * 进 CI（本地 pre-commit 也能跑）：凭据只允许出现在 .env（已 gitignore）。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'

const PATTERNS = [
  { name: 'WorkBuddy key', regex: /wbk_[A-Za-z0-9]{20,}/ },
  { name: 'OpenAI/DeepSeek key', regex: /sk-[A-Za-z0-9_-]{20,}/ },
  { name: 'GitHub token', regex: /gh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: 'AWS key', regex: /AKIA[0-9A-Z]{16}/ },
  { name: 'private key', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
]

const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .filter(path => path !== '')

const hits = []
for (const path of tracked) {
  let size = 0
  try { size = statSync(path).size } catch { continue }
  if (size > 2_000_000) continue // 大文件（锁文件/二进制）不扫
  let text = ''
  try { text = readFileSync(path, 'utf8') } catch { continue }
  if (text.includes('\u0000')) continue // 二进制
  for (const pattern of PATTERNS) {
    const match = pattern.regex.exec(text)
    if (match !== null) hits.push({ path, kind: pattern.name, sample: `${match[0].slice(0, 6)}…${match[0].length} chars` })
  }
}

if (hits.length === 0) {
  process.stdout.write(`PASS  ${tracked.length} 个受版本控制的文件里没有密钥\n`)
  process.exit(0)
}
process.stdout.write(`FAIL  ${hits.length} 处疑似密钥：\n`)
for (const hit of hits) process.stdout.write(`  - ${hit.path}（${hit.kind}，${hit.sample}）\n`)
process.exit(1)
