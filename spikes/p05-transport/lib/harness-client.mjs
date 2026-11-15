/**
 * 最小 harness 客户端：启动 → 换 API Cookie → 调 Remote。
 * 只依赖 Node 内置 fetch，不加载 harness 的任何前端包。
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const DSH_HOME = join(HERE, '..', '.dsh-home')
export const WORKSPACE = join(HERE, '..', '.workspace')
const BIN = join(HERE, '..', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')

const sleep = ms => new Promise(r => setTimeout(r, ms))

/** 取一个空闲端口。 */
export function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolvePort(port))
    })
    server.on('error', reject)
  })
}

/**
 * 启动 `dsh --profile <name> --from-default-profile web`。
 * @returns {Promise<{ child, url, port, logs: () => string }>}
 */
export async function boot({ profile = 'p05', port, timeoutMs = 120_000 } = {}) {
  const listenPort = port ?? await freePort()
  if (!existsSync(BIN)) throw new Error(`找不到 dsh：${BIN}，先 npm i @deepseek-ai/dsh`)
  mkdirSync(DSH_HOME, { recursive: true })
  mkdirSync(WORKSPACE, { recursive: true })
  const child = spawn(process.execPath, [BIN, '--profile', profile, '--from-default-profile', 'web', '--port', String(listenPort), '--no-open'], {
    cwd: WORKSPACE,
    env: { ...process.env, DSH_HOME },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let logs = ''
  child.stdout.on('data', c => { logs += c.toString() })
  child.stderr.on('data', c => { logs += c.toString() })
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const match = logs.match(/https?:\/\/127\.0\.0\.1:\d+\/\?token=[\w.-]+/)
    if (match) return { child, url: match[0], port: listenPort, logs: () => logs }
    if (child.exitCode !== null) break
    await sleep(400)
  }
  child.kill('SIGKILL')
  throw new Error(`启动超时，日志尾部：\n${logs.slice(-1200)}`)
}

/**
 * 用入口 URL 里的 token 换 API Cookie。
 * interactions: 'none' 只能拉数据；'answer' 才能接收转发事件（面板需要）。
 */
export async function connect(url, { interactions = 'none' } = {}) {
  const origin = new URL(url).origin
  const token = new URL(url).searchParams.get('token')
  const response = await fetch(`${origin}/connect?token=${encodeURIComponent(token)}&interactions=${interactions}`, { redirect: 'manual' })
  const cookie = (response.headers.getSetCookie?.() ?? []).map(v => v.split(';')[0]).join('; ')
  if (!cookie) throw new Error(`/connect 未返回 Cookie（HTTP ${response.status}）`)
  return { origin, cookie }
}

let rpcId = 0

/**
 * 调一个 Remote 端点。
 * @param session - connect() 的返回值
 * @param endpoint - `<namespace>/<method>`，见 harness-contract/remotes.json
 * @param args - **wire 名**为键的参数对象
 */
export async function rpc({ origin, cookie }, endpoint, args = {}) {
  rpcId += 1
  const response = await fetch(`${origin}/api/${endpoint}`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: `c${rpcId}`, method: endpoint, payload: { args } }),
  })
  const text = await response.text()
  let envelope
  try { envelope = JSON.parse(text) } catch { throw new Error(`${endpoint} 返回非 JSON（HTTP ${response.status}）：${text.slice(0, 200)}`) }
  if (envelope.result?.ok !== true) {
    const error = envelope.result?.error
    throw new Error(`${endpoint} 失败：${error?.code} ${error?.message}`)
  }
  return envelope.result.value
}

/** 结束进程。 */
export async function stop(child) {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  await sleep(700)
  if (child.exitCode === null) child.kill('SIGKILL')
}
