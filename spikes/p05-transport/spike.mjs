#!/usr/bin/env node
/**
 * P0.5 spike：不加载任何 harness Web UI，只用 HTTP/WS 拿到受保护数据。
 *
 * 证明四件事，任一失败就说明"自建界面"的地基不成立：
 *   1. 宿主能起来，并在 stdout 里给出带 token 的入口 URL
 *   2. `/connect?token=…` 能换到 API Cookie（非浏览器客户端也能拿到身份）
 *   3. 带 Cookie 访问受保护路由返回 200（Cookie 真的有效）
 *   4. `POST /api` 返回结构化 server-response 信封（RPC 信道通，不是 401/403）
 *
 * 用法: node spike.mjs [--port 3917] [--keep]
 * 产物: result.json（每一步的状态码与响应片段，供人工复核）
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DSH_HOME = join(HERE, '.dsh-home')
const WORKSPACE = join(HERE, '.workspace')
const BIN = join(HERE, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')

const argv = process.argv.slice(2)
const portArg = argv.indexOf('--port')
const keep = argv.includes('--keep')

/** 拿一个空闲端口，避免撞上 3080。 */
function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolvePort(port))
    })
    server.on('error', reject)
  })
}

const steps = []
/** 记录一步结果；status: pass / fail / skip。 */
function record(name, status, detail) {
  steps.push({ name, status, detail })
  const mark = status === 'pass' ? 'PASS' : status === 'fail' ? 'FAIL' : 'SKIP'
  process.stdout.write(`${mark}  ${name}${detail ? `  — ${detail}` : ''}\n`)
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

/** 启动 dsh web，返回 { child, url, logs }。 */
async function boot(port) {
  mkdirSync(DSH_HOME, { recursive: true })
  mkdirSync(WORKSPACE, { recursive: true })
  const child = spawn(process.execPath, [BIN, '--profile', 'p05', '--from-default-profile', 'web', '--port', String(port), '--no-open'], {
    cwd: WORKSPACE,
    env: { ...process.env, DSH_HOME },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let logs = ''
  const onData = chunk => { logs += chunk.toString() }
  child.stdout.on('data', onData)
  child.stderr.on('data', onData)

  const deadline = Date.now() + 120_000
  let url
  while (Date.now() < deadline) {
    const match = logs.match(/https?:\/\/127\.0\.0\.1:\d+\/\?token=[\w.-]+/)
    if (match) { url = match[0]; break }
    if (child.exitCode !== null) break
    await sleep(500)
  }
  return { child, url, logs: () => logs }
}

/** 用 token 换 API Cookie。 */
async function connect(baseUrl) {
  const token = new URL(baseUrl).searchParams.get('token')
  const response = await fetch(`${new URL(baseUrl).origin}/connect?token=${encodeURIComponent(token)}&interactions=none`, {
    redirect: 'manual',
  })
  const setCookie = response.headers.getSetCookie?.() ?? []
  const cookie = setCookie.map(value => value.split(';')[0]).join('; ')
  return { status: response.status, location: response.headers.get('location'), cookie, raw: setCookie }
}

/** 带 Cookie 取首页，确认身份有效。 */
async function fetchIndex(origin, cookie) {
  const response = await fetch(`${origin}/`, { headers: { cookie }, redirect: 'manual' })
  const body = await response.text()
  return { status: response.status, hasBoot: body.includes('__DSH_BOOT__'), size: body.length }
}

/** 用最小信封敲 RPC，看是否回来了结构化 server-response。 */
async function probeRpc(origin, cookie, method) {
  // endpoint 也体现在路径上：/api/<namespace>/<method>（见 connection 的 endpointFromPath）
  const response = await fetch(`${origin}/api/${method}`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'p05-1', method, payload: {} }),
  })
  const text = await response.text()
  let structured = false
  try {
    const json = JSON.parse(text)
    structured = json?.type === 'server-response' && json?.rpcId === 'p05-1'
  } catch { /* 非 JSON 就是没通 */ }
  return { status: response.status, structured, snippet: text.slice(0, 220) }
}

async function main() {
  if (!existsSync(BIN)) {
    record('安装 @deepseek-ai/dsh', 'fail', `找不到 ${BIN}，先在本目录 npm i`)
    finish(1)
    return
  }
  const port = portArg >= 0 ? Number(argv[portArg + 1]) : await freePort()
  process.stdout.write(`boot  dsh web on 127.0.0.1:${port} (DSH_HOME=${DSH_HOME})\n`)

  const { child, url, logs } = await boot(port)
  if (!url) {
    record('启动并给出带 token 的入口 URL', 'fail', '120s 内未解析到 URL；看 result.json 的 logs 尾部')
  } else {
    record('启动并给出带 token 的入口 URL', 'pass', url.replace(/token=[\w.-]+/, 'token=***'))
  }

  const origin = `http://127.0.0.1:${port}`
  if (!url) {
    await stop(child)
    finish(1, { logs: logs().slice(-4000) })
    return
  }

  const connected = await connect(url)
  if (connected.status === 302 && connected.cookie) {
    record('/connect 换到 API Cookie', 'pass', `${connected.raw.length} 个 Set-Cookie，Mux=${connected.location ?? '(无)'}`)
  } else {
    record('/connect 换到 API Cookie', 'fail', `HTTP ${connected.status}，Set-Cookie=${connected.raw.length}`)
  }

  if (connected.cookie) {
    // 注意：`/` 是浏览器会话路由（要 browser-session 凭据），API Cookie 打它必然 401。
    // 真正要证明的是"API 通道可达"，所以敲 /api。
    const api = await fetch(`${origin}/api`, { method: 'GET', headers: { cookie: connected.cookie } })
    const reachable = api.status !== 401 && api.status !== 403
    record('API 通道可达（非 401/403）', reachable ? 'pass' : 'fail', `GET /api → HTTP ${api.status}`)
  }

  // 逐个候选试 RPC 名字；只要有一个回来结构化信封，信道就算通。
  let rpcPass
  // endpoint = `${namespace}/${method}`（见 harness gateway 的 endpointOf）。
  for (const method of ['session/list', 'session/modelCatalog', 'fileReferences/list', 'workspace/list']) {
    const probe = await probeRpc(origin, connected.cookie, method)
    const ok = probe.structured || (probe.status !== 401 && probe.status !== 403 && probe.snippet.includes('server-response'))
    if (probe.structured && probe.snippet.includes('"ok":true')) rpcPass = { method, probe }
    process.stdout.write(`      rpc ${method} → HTTP ${probe.status} ${probe.snippet.slice(0, 90)}\n`)
    if (ok && !rpcPass) rpcPass = { method, probe }
  }
  record('POST /api 返回结构化信封', rpcPass ? 'pass' : 'fail', rpcPass ? `${rpcPass.method} → HTTP ${rpcPass.probe.status}` : '所有候选都没有结构化响应')

  // 第五步：真的取一次数据（Session 列表）。这是"拿到真实数据"的终局证明。
  let dataPass
  for (const payload of [{ args: { _request: {} } }, { args: {} }]) {
    const response = await fetch(`${origin}/api/session/list`, {
      method: 'POST',
      headers: { cookie: connected.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'p05-2', method: 'session/list', payload }),
    })
    const text = await response.text()
    let json
    try { json = JSON.parse(text) } catch { continue }
    if (json?.result?.ok === true) {
      dataPass = { payload: JSON.stringify(payload), items: json.result.value?.items?.length ?? '?' }
      break
    }
    process.stdout.write(`      payload ${JSON.stringify(payload)} → ${text.slice(0, 420)}\n`)
  }
  record('取到真实数据（session/list）', dataPass ? 'pass' : 'fail',
    dataPass ? `payload=${dataPass.payload}，items=${dataPass.items}` : '两种 payload 都未通过校验')

  if (!keep) await stop(child)
  finish(steps.some(s => s.status === 'fail') ? 1 : 0, { logs: keep ? '(进程保留)' : logs().slice(-2000) })
}

async function stop(child) {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  await sleep(800)
  if (child.exitCode === null) child.kill('SIGKILL')
}

function finish(code, extra = {}) {
  writeFileSync(join(HERE, 'result.json'), JSON.stringify({ at: new Date().toISOString(), steps, ...extra }, null, 2))
  const failed = steps.filter(s => s.status === 'fail').length
  process.stdout.write(`\n${steps.length - failed}/${steps.length} 通过${failed ? `，${failed} 项失败` : ''}；结果写入 result.json\n`)
  process.exit(code)
}

main().catch(error => {
  record('未捕获异常', 'fail', String(error))
  finish(1)
})
