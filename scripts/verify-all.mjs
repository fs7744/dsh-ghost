#!/usr/bin/env node
/**
 * 一条命令跑完全部验收（升级 harness / 发版前）。
 *
 * 分组：
 *   local  纯本地或静态自检，不启宿主、不花钱
 *   host   真实宿主（boot/stop），需要 spikes/p05-transport 的运行时安装
 *   model  真模型回合，需要 .env 的 WB_BASE_URL / WB_KEY；无 key 的脚本会自己 SKIP
 *
 * 用法:
 *   npm run verify:all                 # local + host（默认，跳过花钱的 model 组）
 *   npm run verify:all -- --with-model # 连真模型一起跑
 *   npm run verify:all -- --only=local # 只跑某组
 *
 * 每项独立执行，失败不阻断后续；最后汇总一张表，任一 FAIL 则 exit 1。
 * 单脚本超时 5 分钟，避免卡在审批或模型回合上拖死整轮。
 */
import { execSync } from 'node:child_process'
import { join } from 'node:path'

const REPO = join(import.meta.dirname, '..')
const GROUPS = {
  local: [
    'typecheck', 'check:ui', 'check:shell', 'test', 'test:model', 'test:replay',
    'check:secrets', 'verify:events', 'verify:port-discipline', 'verify:contract',
    'verify:mock-server', 'verify:models', 'verify:init', 'verify:compaction',
    'verify:playbook-editor', 'verify:shell', 'release:check', 'verify:l5',
    'verify:superagent-assets', 'verify:gates',
  ],
  host: [
    'verify:port', 'verify:skill', 'verify:plugin-boot', 'verify:tool-visibility',
    'verify:auth', 'verify:commands', 'verify:orchestrator', 'verify:github',
    'verify:outbox', 'verify:source-hub', 'verify:command-palette',
    'verify:session-export', 'verify:rewind', 'verify:memory-ui', 'verify:panels',
    'verify:evolution', 'verify:ai-config', 'verify:ui-extensions',
  ],
  model: ['verify:l3', 'verify:real-model', 'verify:ticket-tool', 'verify:auto-run', 'verify:github-loop'],
}

const argv = process.argv.slice(2)
const onlyArg = argv.find(item => item.startsWith('--only='))?.slice('--only='.length)
const withModel = argv.includes('--with-model')
if (onlyArg !== undefined && GROUPS[onlyArg] === undefined) {
  process.stderr.write(`未知分组 ${onlyArg}（可选 ${Object.keys(GROUPS).join(' / ')}）\n`)
  process.exit(2)
}
const groups = onlyArg !== undefined ? [onlyArg] : withModel ? ['local', 'host', 'model'] : ['local', 'host']
const commands = groups.flatMap(group => GROUPS[group].map(name => ({ name, group })))

const stripAnsi = text => text.replace(/\u001b\[[0-9;]*m/g, '')
const lastLine = text => stripAnsi(text).split('\n').map(line => line.trim()).filter(line => line !== '').at(-1) ?? ''

const rows = []
for (const item of commands) {
  process.stdout.write(`运行  [${item.group}] ${item.name} ...\n`)
  const started = Date.now()
  try {
    const out = execSync(`npm run ${item.name}`, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300_000 })
    rows.push({ ...item, ok: true, ms: Date.now() - started, detail: lastLine(out).slice(0, 90) })
  } catch (error) {
    const text = `${error.stdout ?? ''}${error.stderr ?? ''}`
    rows.push({ ...item, ok: false, ms: Date.now() - started, detail: (lastLine(text) || `exit ${String(error.status ?? '?')}`).slice(0, 90) })
  }
}

process.stdout.write('\n#   分组   命令                          结果   耗时    说明\n')
process.stdout.write('--- ------ --------------------------- ------ ------- --------------------\n')
rows.forEach((row, index) => {
  process.stdout.write(`${String(index + 1).padStart(3)}  ${row.group.padEnd(6)} ${row.name.padEnd(27)} ${row.ok ? 'PASS' : 'FAIL'}   ${String(Math.round(row.ms / 1000)).padStart(4)}s  ${row.detail}\n`)
})
const failed = rows.filter(row => !row.ok)
process.stdout.write(`\n结论: ${rows.length - failed.length}/${rows.length} 通过${failed.length === 0 ? '' : `，失败：${failed.map(row => row.name).join(', ')}`}\n`)
process.exit(failed.length === 0 ? 0 : 1)
