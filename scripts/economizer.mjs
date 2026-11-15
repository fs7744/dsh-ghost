#!/usr/bin/env node
/**
 * 工具剪枝账本 CLI（TokenEconomizer 式可逆操作，不消耗模型回合）。
 *
 * 用法:
 *   npm run economizer:status
 *   npm run economizer -- restore orchestrator_eval
 *   npm run economizer -- prune --dry-run
 *   npm run economizer -- reset
 * 选项:
 *   --root <dir>  状态目录，默认 .ghost（与 tickets.json 同目录）
 */
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  beginBoot, DEFAULT_OPTIONAL_TOOLS, emptyLedger, pruneUnusedTools, restoreTool,
} from '../packages/economizer/src/index.ts'

const argv = process.argv.slice(2)
const rootAt = argv.indexOf('--root')
const root = resolve(rootAt >= 0 ? argv[rootAt + 1] ?? '.ghost' : '.ghost')
// 过滤掉 --root 的值，剩下的才是命令/工具名。
const positional = argv.filter((value, index) => !value.startsWith('-') && index !== rootAt + 1)
const command = positional[0] ?? 'status'
const file = join(root, 'tool-usage.json')

function load() {
  if (!existsSync(file)) return emptyLedger()
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (parsed?.version === 1 && typeof parsed.boots === 'number' && parsed.tools) return parsed
  } catch { /* 坏账本按空处理 */ }
  return emptyLedger()
}

function save(ledger) {
  mkdirSync(root, { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, `${JSON.stringify(ledger, null, 2)}\n`)
  renameSync(tmp, file)
}

const ledger = load()
if (command === 'status') {
  console.log(`boots=${ledger.boots} root=${root}`)
  for (const [name, stat] of Object.entries(ledger.tools).sort()) {
    const flags = [stat.restored ? 'restored' : '', (ledger.disabled ?? []).includes(name) ? 'disabled' : ''].filter(Boolean)
    console.log(`${name}\tcalls=${stat.calls}\tfailures=${stat.failures}\tseen=${stat.seenBoots}${flags.length > 0 ? ` ${flags.join(' ')}` : ''}`)
  }
} else if (command === 'restore') {
  const name = positional[1]
  if (!name) {
    console.error('用法: economizer restore <tool-name>')
    process.exit(2)
  }
  const next = restoreTool(ledger, name)
  next.disabled = (next.disabled ?? []).filter(tool => tool !== name)
  save(next)
  console.log(`restored ${name}; 已从 disabled 移除，之后不会再被自动剪`)
} else if (command === 'prune') {
  const pruned = pruneUnusedTools(ledger, DEFAULT_OPTIONAL_TOOLS, { minBoots: 5 })
  console.log(`当前会被剪: ${pruned.length === 0 ? '(无)' : pruned.join(', ')}`)
  if (!argv.includes('--dry-run') && pruned.length > 0) {
    save({ ...ledger, disabled: pruned })
    console.log('已写入 disabled；下次宿主启动生效')
  }
} else if (command === 'reset') {
  if (existsSync(file)) unlinkSync(file)
  console.log('tool-usage.json 已删除')
} else {
  console.error(`未知命令: ${command}`)
  process.exit(2)
}
