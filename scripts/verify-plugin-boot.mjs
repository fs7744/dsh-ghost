#!/usr/bin/env node
/**
 * 插件装载验收：把我们的宿主插件真的挂进一个 profile 启动一次。
 *
 * 判定：启动日志里出现 `ghost-memory: 3 tools registered`，且没有加载失败。
 * 这是"我们的代码跑在 harness 里"的第一手证据——不是推断。
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'

const DSH_HOME = join(import.meta.dirname, '..', 'spikes', 'p05-transport', '.dsh-home')
const BIN = join(import.meta.dirname, '..', 'spikes', 'p05-transport', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const PROFILE = 'p05'

const port = await new Promise(resolve => {
  const server = createServer()
  server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)) })
})

const child = spawn(process.execPath, [BIN, '--profile', PROFILE, '--port', String(port), '--no-open'], {
  cwd: join(import.meta.dirname, '..'),
  env: { ...process.env, DSH_HOME },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let logs = ''
child.stdout.on('data', chunk => { logs += chunk.toString() })
child.stderr.on('data', chunk => { logs += chunk.toString() })

const deadline = Date.now() + 45_000
let ready = false
while (Date.now() < deadline) {
  if (/https?:\/\/127\.0\.0\.1:\d+\/\?token=/.test(logs)) { ready = true; break }
  if (child.exitCode !== null) break
  await new Promise(r => setTimeout(r, 300))
}

// 判定依据：插件在 apply 时写的自检文件（日志级别不可靠，文件不会骗人）。
const statePath = join(import.meta.dirname, '..', '.ghost', 'memory', 'plugin-state.json')
let state
try { state = JSON.parse(readFileSync(statePath, 'utf8')) } catch { state = undefined }
const failed = /ghost-memory[^\n]*(error|failed|Cannot find)/i.test(logs)

child.kill('SIGTERM')
await new Promise(r => setTimeout(r, 600))
if (child.exitCode === null) child.kill('SIGKILL')

process.stdout.write(`boot    ${ready ? 'ready' : '未就绪'}（${PROFILE}）\n`)
const verified = state?.verified ?? []
const allPresent = verified.length > 0 && verified.every(entry => entry.present === true)
process.stdout.write(`state   ${state === undefined ? '(没有 plugin-state.json)' : `${state.plugin} → ${state.tools.join(', ')} @ ${state.at}`}\n`)
process.stdout.write(`verify  ${verified.map(entry => `${entry.name}:${entry.present ? 'ok' : 'MISSING'}`).join(' ') || '(无自检)'}\n`)
if (!ready || state === undefined || !allPresent || failed) {
  process.stdout.write('\nFAIL  插件未成功装载\n')
  if (!ready) process.stdout.write(logs.slice(-800) + '\n')
  process.exit(1)
}
process.stdout.write('\nPASS  插件在真实 harness 中装载成功\n')
