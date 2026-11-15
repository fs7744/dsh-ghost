#!/usr/bin/env node
/**
 * 一键起界面：先起 harness，再起 vite，把带 token 的地址打出来。
 *
 * 关掉这个进程（Ctrl+C）时，harness 子进程一起退出。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { boot, stop } from '../spikes/p05-transport/lib/harness-client.mjs'

const REPO = join(import.meta.dirname, '..')

// 读 .env：harness 子进程要拿到 WB_KEY 才会把 wb provider 视为可路由
const envFile = join(REPO, '.env')
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (match !== null && process.env[match[1]] === undefined) process.env[match[1]] = match[2]
  }
}
const server = await boot({ profile: 'p05', fromDefault: false, timeoutMs: 150_000 })
const token = new URL(server.url).searchParams.get('token')
process.stdout.write(`harness  ${server.url.replace(/token=[\w.-]+/, 'token=***')}\n`)

const vite = spawn(process.execPath, [join(REPO, 'node_modules', 'vite', 'bin', 'vite.js'), '--config', join(REPO, 'apps', 'desktop', 'vite.config.ts')], {
  cwd: REPO,
  env: { ...process.env, HARNESS_ORIGIN: `http://127.0.0.1:${server.port}`, UI_PORT: process.env.UI_PORT ?? '5173' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let logs = ''
const relay = chunk => {
  logs += chunk.toString()
  process.stdout.write(chunk)
}
vite.stdout.on('data', relay)
vite.stderr.on('data', relay)

const deadline = Date.now() + 60_000
let url
while (Date.now() < deadline) {
  // vite 的输出带 ANSI 颜色，且颜色码可能夹在端口号中间，先剥掉再匹配
  const plain = logs.replace(/\u001b\[[0-9;]*m/g, '')
  const match = plain.match(/http:\/\/(?:localhost|127\.0\.0\.1):(\d+)\//)
  if (match) { url = `http://127.0.0.1:${match[1]}/?token=${token}`; break }
  await new Promise(r => setTimeout(r, 300))
}
if (url === undefined) {
  process.stdout.write('vite 未能启动\n')
} else {
  mkdirSync(join(REPO, 'out'), { recursive: true })
  writeFileSync(join(REPO, 'out', 'ui-url.txt'), `${url}\n`)
  process.stdout.write(`\n界面      ${url}\n（地址也写在 out/ui-url.txt；token 只在本次有效）\n`)
}

const shutdown = async () => {
  vite.kill()
  await stop(server.child)
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
