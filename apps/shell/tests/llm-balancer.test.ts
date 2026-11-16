/**
 * 本地 LLM 负载均衡代理的集成用例：用真 HTTP 请求打到本地假服务，
 * 验证轮询分发、模型 id 改写、故障转移、模型聚合与无服务时的透传。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { createLlmBalancer } from '../src/llm-balancer.ts'
import type { Logger } from '../src/ports.ts'
import type { CatalogState, ProviderSpec } from '@dsh-ghost/model-manager'

const silent: Logger = { info() {}, warn() {}, error() {} }
const caps = { contextWindow: 128000, maxTokens: 8192, reasoningEfforts: [] }

async function mockServer(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{
  port: number
  close: () => Promise<void>
}> {
  const server = http.createServer(handler)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return { port, close: () => new Promise<void>(resolve => server.close(() => resolve())) }
}

function fixture(): { dir: string; modelsFile: string } {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-lb-'))
  return { dir, modelsFile: join(dir, 'models.json') }
}

function saveState(modelsFile: string, providers: ProviderSpec[], strategy: 'off' | 'round-robin'): void {
  const state: CatalogState = { providers, bindings: [], balance: { strategy } }
  writeFileSync(modelsFile, JSON.stringify(state))
}

const provider = (id: string, port: number, modelId: string): ProviderSpec => ({
  id, displayName: id, api: 'openai-completions', baseURL: `http://127.0.0.1:${port}/v1`,
  apiKeyEnv: `${id.toUpperCase()}_KEY`, models: [{ id: modelId, capabilities: caps }], enabled: true, weight: 1,
})

const post = async (url: string, model: string): Promise<{ status: number; body: string }> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }] }),
  })
  return { status: response.status, body: await response.text() }
}

test('round-robin 把两次请求分发到两个服务，并改写目标不认识的模型 id', async () => {
  const seen: Array<{ id: string; model: unknown; auth?: string }> = []
  const a = await mockServer((req, res) => {
    let raw = ''
    req.on('data', chunk => { raw += String(chunk) })
    req.on('end', () => {
      const auth = req.headers.authorization
      seen.push({ id: 'a', model: (JSON.parse(raw) as { model: unknown }).model, ...(auth === undefined ? {} : { auth }) })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"choices":[{"message":{"content":"A"}}]}')
    })
  })
  const b = await mockServer((req, res) => {
    let raw = ''
    req.on('data', chunk => { raw += String(chunk) })
    req.on('end', () => {
      seen.push({ id: 'b', model: (JSON.parse(raw) as { model: unknown }).model })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"choices":[{"message":{"content":"B"}}]}')
    })
  })
  const { dir, modelsFile } = fixture()
  try {
    saveState(modelsFile, [provider('a', a.port, 'model-a'), provider('b', b.port, 'model-b')], 'round-robin')
    const balancer = await createLlmBalancer({
      modelsFile, getCredential: name => name === 'A_KEY' ? 'secret-a' : undefined,
      fallbackBaseURL: '', logger: silent,
    })
    try {
      assert.ok(balancer.baseURL !== undefined)
      assert.deepEqual(await post(`${balancer.baseURL}/chat/completions`, 'model-a'), {
        status: 200, body: '{"choices":[{"message":{"content":"A"}}]}',
      })
      assert.deepEqual(await post(`${balancer.baseURL}/chat/completions`, 'model-a'), {
        status: 200, body: '{"choices":[{"message":{"content":"B"}}]}',
      })
      assert.deepEqual(seen.map(item => item.id), ['a', 'b'])
      assert.deepEqual(seen.map(item => item.model), ['model-a', 'model-b'])
      assert.equal(seen[0]?.auth, 'Bearer secret-a')
    } finally { await balancer.close() }
  } finally {
    await a.close(); await b.close(); rmSync(dir, { recursive: true, force: true })
  }
})

test('首个服务 500 时故障转移到下一个，且流式响应原样回传', async () => {
  let bCalls = 0
  const a = await mockServer((_req, res) => { res.writeHead(500); res.end('boom') })
  const b = await mockServer((_req, res) => {
    bCalls += 1
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write('data: {"choices":[{"delta":{"content":"ok"}}]}\n\n')
    res.end('data: [DONE]\n\n')
  })
  const { dir, modelsFile } = fixture()
  try {
    saveState(modelsFile, [provider('a', a.port, 'm'), provider('b', b.port, 'm')], 'off')
    const balancer = await createLlmBalancer({ modelsFile, getCredential: () => undefined, fallbackBaseURL: '', logger: silent })
    try {
      assert.ok(balancer.baseURL !== undefined)
      const result = await post(`${balancer.baseURL}/chat/completions`, 'm')
      assert.equal(result.status, 200)
      assert.match(result.body, /\[DONE\]/)
      assert.equal(bCalls, 1)
    } finally { await balancer.close() }
  } finally {
    await a.close(); await b.close(); rmSync(dir, { recursive: true, force: true })
  }
})

test('/v1/models 聚合所有启用服务的模型并保留 agent 当前模型', async () => {
  const { dir, modelsFile } = fixture()
  try {
    saveState(modelsFile, [provider('a', 1, 'model-a'), provider('b', 2, 'model-b')], 'off')
    const balancer = await createLlmBalancer({
      modelsFile, getCredential: () => undefined, fallbackBaseURL: '', fallbackModel: 'hy3', logger: silent,
    })
    try {
      assert.ok(balancer.baseURL !== undefined)
      const response = await fetch(`${balancer.baseURL}/models`)
      const body = await response.json() as { object: string; data: Array<{ id: string; owned_by: string }> }
      assert.equal(body.object, 'list')
      assert.deepEqual(body.data.map(item => item.id).sort(), ['hy3', 'model-a', 'model-b'])
      assert.equal(body.data.find(item => item.id === 'model-a')?.owned_by, 'a')
    } finally { await balancer.close() }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('没有启用的服务时 baseURL 缺省，由调用方回退直连原网关', async () => {
  const { dir, modelsFile } = fixture()
  try {
    saveState(modelsFile, [{ ...provider('a', 1, 'm'), enabled: false }], 'off')
    const balancer = await createLlmBalancer({ modelsFile, getCredential: () => undefined, fallbackBaseURL: '', logger: silent })
    try {
      assert.equal(balancer.baseURL, undefined)
      assert.ok(balancer.port > 0)
    } finally { await balancer.close() }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
