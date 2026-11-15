#!/usr/bin/env node
/**
 * L1 确定性故障注入的 OpenAI 兼容假端点（C4-02）。
 *
 * 提供 /v1/chat/completions 与 /v1/models，响应体完全确定（无时间戳、无随机 id），
 * 便于 L1 断言「适配层/工具调用序列/流式分片/重试与截断」而不碰真模型。
 *
 * 模式选择（scripts/lib-models.mjs 的 selectFaultMode，优先级从高到低）:
 *   请求头 x-dsh-fault: <mode>
 *   路径段 /fault/<mode>/v1/...
 *   查询参数 ?fault=<mode>
 *   缺省 normal
 * 模式: normal / timeout / http500 / http429 / truncated / bad-json / tool-call。
 * 未知模式回 400，不静默降级。timeout 故意不响应，让调用方走自己的超时逻辑。
 *
 * 用法:
 *   node scripts/llm-mock-server.mjs                  跑一次本地 fetch 自检后退出（默认）
 *   node scripts/llm-mock-server.mjs --self-test     同上（显式）
 *   node scripts/llm-mock-server.mjs --serve         常驻，打印地址，Ctrl+C 停止
 *   node scripts/llm-mock-server.mjs --port <n>      --serve 时指定端口（0 由 OS 分配）
 *
 * 退出码: 0 自检通过 / 1 自检失败 / 2 用法或启动错误。
 * 模块导出: startMockServer(options) 与 stopMockServer(handle)，供别的脚本注入使用。
 */
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { selectFaultMode, FAULT_MODES } from './lib-models.mjs'

const MODEL_IDS = ['mock-echo', 'mock-reasoner']
const PATH_FAULT_PREFIX = /^\/fault\/[a-z0-9-]+\//

/** /v1/models 的固定响应。 */
function modelsBody() {
  return { object: 'list', data: MODEL_IDS.map(id => ({ id, object: 'model', created: 0, owned_by: 'dsh-ghost' })) }
}

/** 取最后一条 user 文本，用于确定性回显（不含时间、不含随机量）。 */
function userText(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : []
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const item = messages[i]
    if (item !== null && typeof item === 'object' && item.role === 'user' && typeof item.content === 'string') return item.content
  }
  return ''
}

/** 基础 chat.completion 骨架；所有分支共用，保证确定性。 */
function baseCompletion(body) {
  const model = typeof body?.model === 'string' && body.model !== '' ? body.model : 'mock-echo'
  return {
    id: 'chatcmpl-mock',
    object: 'chat.completion',
    created: 0,
    model,
    choices: [{ index: 0, message: { role: 'assistant', content: `ECHO:${userText(body)}` }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  }
}

/**
 * 按模式构造响应。返回 { status, headers?, payload, raw? }。
 * status 为 null 表示 timeout：不发送任何字节，挂住连接。
 */
function composeResponse(mode, body, endpoint) {
  if (mode === 'timeout') return { status: null }
  if (mode === 'http500') return { status: 500, payload: { error: { message: 'injected 500', type: 'mock_fault', mode } } }
  if (mode === 'http429') return { status: 429, headers: { 'Retry-After': '1' }, payload: { error: { message: 'injected 429', type: 'mock_fault', mode } } }
  if (endpoint === '/v1/models') return { status: 200, payload: modelsBody() }
  const base = baseCompletion(body)
  if (mode === 'tool-call') {
    return {
      status: 200,
      payload: {
        ...base,
        choices: [{
          index: 0,
          message: {
            role: 'assistant', content: null,
            tool_calls: [{ id: 'call_mock_1', type: 'function', function: { name: 'echo', arguments: JSON.stringify({ text: userText(body) }) } }],
          },
          finish_reason: 'tool_calls',
        }],
      },
    }
  }
  const serialized = JSON.stringify(base)
  if (mode === 'truncated') return { status: 200, payload: serialized.slice(0, Math.floor(serialized.length / 2)), raw: true }
  if (mode === 'bad-json') return { status: 200, payload: '<<not-json>> }{', raw: true }
  return { status: 200, payload: base } // normal
}

/** 把组装结果写回响应；timeout 分支只登记不发送。 */
function send(res, result, openResponses) {
  if (result.status === null) {
    openResponses.add(res)
    return
  }
  const text = result.raw === true ? String(result.payload) : JSON.stringify(result.payload)
  res.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8', ...(result.headers ?? {}) })
  res.end(text)
}

/** 读取请求体（容错：坏 JSON 当成空对象）。 */
async function readJson(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf8')
  if (text === '') return {}
  try { return JSON.parse(text) } catch { return {} }
}

/**
 * 启动假端点。port 缺省 0，由 OS 分配；返回 { server, url, port, close() }。
 * @param {{ port?: number, host?: string }} options
 */
export async function startMockServer(options = {}) {
  const port = options.port ?? 0
  const host = options.host ?? '127.0.0.1'
  const openResponses = new Set()

  const server = createServer((req, res) => {
    void (async () => {
      let url
      try { url = new URL(req.url ?? '/', `http://${host}`) } catch {
        send(res, { status: 400, payload: { error: { message: 'bad url' } } }, openResponses)
        return
      }
      const headerValue = req.headers['x-dsh-fault']
      const selected = selectFaultMode({
        header: typeof headerValue === 'string' ? headerValue : undefined,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
      })
      if (selected === null) {
        send(res, { status: 400, payload: { error: { message: 'unknown fault mode', type: 'mock_fault' } } }, openResponses)
        return
      }
      const endpoint = url.pathname.replace(PATH_FAULT_PREFIX, '/')
      if (endpoint === '/v1/models' && (req.method === 'GET' || req.method === 'POST')) {
        send(res, composeResponse(selected.mode, {}, endpoint), openResponses)
        return
      }
      if (endpoint === '/v1/chat/completions' && req.method === 'POST') {
        const body = await readJson(req)
        send(res, composeResponse(selected.mode, body, endpoint), openResponses)
        return
      }
      send(res, { status: 404, payload: { error: { message: `no route ${endpoint}`, type: 'mock_fault' } } }, openResponses)
    })().catch(() => {
      if (!res.headersSent) send(res, { status: 500, payload: { error: { message: 'handler error' } } }, openResponses)
    })
  })

  await new Promise((resolve, reject) => {
    const onError = error => reject(error)
    server.once('error', onError)
    server.listen(port, host, () => {
      server.off('error', onError)
      resolve()
    })
  })
  const address = server.address()
  const actualPort = address !== null && typeof address === 'object' ? address.port : port
  return {
    server,
    url: `http://${host}:${actualPort}`,
    port: actualPort,
    async close() {
      // timeout 挂住的连接必须先销毁，否则 server.close() 会一直等待。
      for (const res of openResponses) res.destroy()
      openResponses.clear()
      await new Promise(resolve => server.close(resolve))
    },
  }
}

/** 停止假端点。 */
export async function stopMockServer(handle) {
  if (handle !== undefined) await handle.close()
}

// ---------------------------------------------------------------------------
// CLI：默认跑一次本地 fetch 自检；--serve 常驻供人工调试。
// ---------------------------------------------------------------------------

const BODY = JSON.stringify({ model: 'mock-echo', messages: [{ role: 'user', content: 'ping' }] })

async function probe(url, mode, via = 'header') {
  const path = via === 'path' ? `/fault/${mode}/v1/chat/completions` : '/v1/chat/completions'
  const headers = { 'Content-Type': 'application/json' }
  if (via === 'header') headers['x-dsh-fault'] = mode
  const init = { method: 'POST', headers, body: BODY }
  if (mode === 'timeout') init.signal = AbortSignal.timeout(250)
  try {
    const res = await fetch(`${url}${path}`, init)
    const text = await res.text()
    let json
    let parseError = false
    try { json = JSON.parse(text) } catch { parseError = true }
    if (mode === 'timeout') return { ok: false, detail: 'timeout 分支不应返回响应' }
    if (mode === 'normal') return { ok: res.status === 200 && !parseError && String(json?.choices?.[0]?.message?.content ?? '').startsWith('ECHO:'), detail: `status=${res.status}` }
    if (mode === 'tool-call') return { ok: res.status === 200 && !parseError && Array.isArray(json?.choices?.[0]?.message?.tool_calls), detail: `status=${res.status}` }
    if (mode === 'truncated') return { ok: res.status === 200 && parseError, detail: `status=${res.status} parseError=${parseError}` }
    if (mode === 'bad-json') return { ok: res.status === 200 && parseError, detail: `status=${res.status} parseError=${parseError}` }
    if (mode === 'http500') return { ok: res.status === 500, detail: `status=${res.status}` }
    if (mode === 'http429') return { ok: res.status === 429, detail: `status=${res.status}` }
    return { ok: false, detail: `未处理的模式 ${mode}` }
  } catch (error) {
    if (mode === 'timeout') return { ok: true, detail: `按预期触发调用方超时（${String(error).slice(0, 40)}）` }
    return { ok: false, detail: String(error) }
  }
}

async function selfTest() {
  let handle
  let failures = 0
  const check = (ok, label, detail = '') => {
    process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === '' ? '' : `：${detail}`}\n`)
    if (!ok) failures += 1
  }
  try {
    handle = await startMockServer({ port: 0 })
    process.stdout.write(`假端点  ${handle.url}（端口由 OS 分配）\n`)
    for (const mode of FAULT_MODES) {
      const result = await probe(handle.url, mode)
      check(result.ok, `模式 ${mode}`, result.detail)
    }
    const byPath = await probe(handle.url, 'http500', 'path')
    check(byPath.ok, '按路径段 /fault/<mode>/ 选择模式', byPath.detail)
    const models = await fetch(`${handle.url}/v1/models`)
    const modelsJson = await models.json()
    check(models.status === 200 && Array.isArray(modelsJson?.data) && modelsJson.data.length === MODEL_IDS.length,
      'GET /v1/models 返回固定模型列表')
    const unknown = await fetch(`${handle.url}/v1/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-dsh-fault': 'not-a-mode' }, body: BODY,
    })
    check(unknown.status === 400, '未知模式回 400 而不是静默降级', `status=${unknown.status}`)
  } catch (error) {
    check(false, '启动或请求假端点', String(error))
  } finally {
    await stopMockServer(handle)
  }
  process.stdout.write(`\n${failures === 0 ? '假端点自检通过' : `${failures} 项失败`}\n`)
  process.exit(failures === 0 ? 0 : 1)
}

async function serve(port) {
  const handle = await startMockServer({ port })
  process.stdout.write(`MOCK_READY ${handle.url}\n`)
  process.stdout.write('模式: ' + FAULT_MODES.join(' / ') + '\n')
  process.stdout.write('Ctrl+C 停止。\n')
  const shutdown = () => {
    void stopMockServer(handle).then(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write([
      '用法: node scripts/llm-mock-server.mjs [--self-test] [--serve] [--port <n>] [--help]',
      '',
      '  默认 / --self-test  跑一次本地 fetch 自检（7 种模式 + 路径选择 + /v1/models + 未知模式 400）',
      '  --serve             常驻，打印地址，Ctrl+C 停止',
      '  --port <n>          --serve 时指定端口，0 由 OS 分配',
      '',
      '退出码: 0 自检通过 / 1 自检失败 / 2 用法或启动错误',
    ].join('\n') + '\n')
    return
  }
  const portIndex = argv.indexOf('--port')
  if (portIndex >= 0 && argv[portIndex + 1] === undefined) {
    process.stderr.write('--port 需要一个数字\n')
    process.exit(2)
  }
  const port = portIndex >= 0 ? Number(argv[portIndex + 1]) : 0
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    process.stderr.write(`端口不合法: ${argv[portIndex + 1]}\n`)
    process.exit(2)
  }
  if (argv.includes('--serve')) {
    void serve(port).catch(error => { process.stderr.write(`${String(error)}\n`); process.exit(2) })
  } else {
    void selfTest()
  }
}

// 只有作为 CLI 直接运行时才执行；被 import 时只暴露 start/stop。
const invoked = process.argv[1]
if (invoked !== undefined && resolve(invoked) === fileURLToPath(import.meta.url)) {
  main()
}
