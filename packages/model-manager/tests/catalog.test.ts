/** model-manager 目录 / route / 角色 / probe 单测（C3-01/02/03/05）。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createMemoryStore, createCatalog, validateCapabilities, validateProviderSpec,
  generateLocalRoute, parseRole, resolveRole, validateRoleBindings, defaultModelForRole,
  normalizeProbeResult, type ProviderSpec,
} from '../src/index.ts'

const provider = (id: string, modelIds: readonly string[]): ProviderSpec => ({
  id,
  displayName: id,
  api: 'openai-completions',
  apiKeyEnv: 'WB_KEY',
  models: modelIds.map(mid => ({ id: mid, capabilities: { contextWindow: 8192, maxTokens: 2048, reasoningEfforts: [] } })),
})

test('generateLocalRoute 生成 Ollama 默认 route', () => {
  const route = generateLocalRoute('ollama')
  assert.equal(route.baseURL, 'http://127.0.0.1:11434/v1')
  assert.equal(route.api, 'openai-completions')
  assert.equal(route.apiKeyEnv, 'OLLAMA_API_KEY')
  assert.equal(route.models[0]?.id, 'llama3.1')
  assert.equal(route.models[0]?.capabilities.contextWindow, 128000)
})

test('generateLocalRoute 生成 vLLM 并接受自定义值', () => {
  const route = generateLocalRoute('vllm', {
    host: '192.168.1.5', port: 9000, modelId: 'Qwen2.5-7B',
    contextWindow: 65536, maxTokens: 8192, reasoningEfforts: ['low', 'high'],
  })
  assert.equal(route.baseURL, 'http://192.168.1.5:9000/v1')
  assert.equal(route.models[0]?.id, 'Qwen2.5-7B')
  assert.deepEqual(route.models[0]?.capabilities.reasoningEfforts, ['low', 'high'])
})

test('generateLocalRoute 拒绝未知预设与非法 port/host/modelId', () => {
  assert.throws(() => generateLocalRoute('foo'), /未知本地预设/)
  assert.throws(() => generateLocalRoute('ollama', { port: 0 }), /port 不合法/)
  assert.throws(() => generateLocalRoute('ollama', { port: 70000 }), /port 不合法/)
  assert.throws(() => generateLocalRoute('ollama', { host: 'http://x' }), /host 不合法/)
  assert.throws(() => generateLocalRoute('ollama', { modelId: 'bad id' }), /modelId 不合法/)
})

test('generateLocalRoute 拒绝非法能力标注与非法 apiKeyEnv', () => {
  assert.throws(() => generateLocalRoute('ollama', { contextWindow: -1 }), /能力标注不合法/)
  assert.throws(() => generateLocalRoute('ollama', { contextWindow: 100, maxTokens: 999999 }), /能力标注不合法/)
  assert.throws(() => generateLocalRoute('ollama', { reasoningEfforts: ['low', ''] }), /能力标注不合法/)
  assert.throws(() => generateLocalRoute('ollama', { apiKeyEnv: 'wb_key' }), /apiKeyEnv 不合法/)
})

test('validateCapabilities 校验能力与 reasoningEfforts', () => {
  assert.deepEqual(validateCapabilities({ contextWindow: 8192, maxTokens: 2048, reasoningEfforts: ['low'] }), [])
  assert.ok(validateCapabilities({ contextWindow: 0, maxTokens: 2048, reasoningEfforts: [] }).some(x => x.includes('contextWindow')))
  assert.ok(validateCapabilities({ contextWindow: 8192, maxTokens: 99999, reasoningEfforts: [] }).some(x => x.includes('maxTokens')))
  assert.ok(validateCapabilities({ contextWindow: 8192, maxTokens: 2048, reasoningEfforts: ['low', ''] }).some(x => x.includes('reasoningEfforts')))
})

test('parseRole 只认 router / worker', () => {
  assert.equal(parseRole('router'), 'router')
  assert.equal(parseRole('worker'), 'worker')
  assert.equal(parseRole('admin'), undefined)
  assert.equal(parseRole(''), undefined)
})

test('resolveRole 解析到 provider/model，缺失或非法角色返回 undefined', () => {
  const providers = [provider('wb', ['hy3', 'hy4'])]
  const resolved = resolveRole({ role: 'router', providerId: 'wb', modelId: 'hy3' }, providers)
  assert.equal(resolved?.model.id, 'hy3')
  assert.equal(resolved?.provider.id, 'wb')
  assert.equal(resolveRole({ role: 'router', providerId: 'none', modelId: 'hy3' }, providers), undefined)
  assert.equal(resolveRole({ role: 'router', providerId: 'wb', modelId: 'none' }, providers), undefined)
  assert.equal(resolveRole({ role: 'x', providerId: 'wb', modelId: 'hy3' } as never, providers), undefined)
})

test('validateRoleBindings 检出重复角色与失效绑定', () => {
  const providers = [provider('wb', ['hy3'])]
  assert.deepEqual(validateRoleBindings([{ role: 'router', providerId: 'wb', modelId: 'hy3' }], providers), [])
  const duplicated = validateRoleBindings([
    { role: 'router', providerId: 'wb', modelId: 'hy3' },
    { role: 'router', providerId: 'wb', modelId: 'hy3' },
  ], providers)
  assert.ok(duplicated.some(x => x.includes('重复绑定')))
  const missing = validateRoleBindings([{ role: 'worker', providerId: 'wb', modelId: 'nope' }], providers)
  assert.ok(missing.some(x => x.includes('指向不存在的模型')))
})

test('defaultModelForRole 取角色的默认模型', () => {
  const state = { providers: [provider('wb', ['hy3'])], bindings: [{ role: 'router' as const, providerId: 'wb', modelId: 'hy3' }] }
  assert.equal(defaultModelForRole('router', state)?.model.id, 'hy3')
  assert.equal(defaultModelForRole('worker', state), undefined)
})

test('createCatalog 走可注入 store 增删 provider 与列模型', async () => {
  const cat = createCatalog(createMemoryStore())
  await cat.addProvider(provider('wb', ['hy3', 'hy4']))
  assert.equal((await cat.list()).providers.length, 1)
  assert.equal((await cat.listModels()).length, 2)
  await assert.rejects(cat.addProvider(provider('wb', ['hy3'])), /provider 已存在/)
  await cat.removeProvider('wb')
  assert.equal((await cat.list()).providers.length, 0)
})

test('createCatalog 绑定角色拒绝失效模型，删除 provider 连带清理绑定', async () => {
  const cat = createCatalog(createMemoryStore())
  await cat.addProvider(provider('wb', ['hy3']))
  await assert.rejects(cat.bindRole({ role: 'worker', providerId: 'wb', modelId: 'nope' }), /角色绑定不合法/)
  await cat.bindRole({ role: 'router', providerId: 'wb', modelId: 'hy3' })
  assert.equal((await cat.resolve('router'))?.model.id, 'hy3')
  await cat.removeProvider('wb')
  assert.equal((await cat.list()).bindings.length, 0, '删 provider 时绑定一并清理')
})

test('normalizeProbeResult 归一化多种形状并丢弃易变字段', () => {
  assert.deepEqual(normalizeProbeResult(true), { ok: true })
  assert.deepEqual(normalizeProbeResult({ status: 200, latencyMs: 12, requestId: 'x' }), { ok: true, status: 200 })
  assert.deepEqual(normalizeProbeResult({ success: false, error: 'down' }), { ok: false, error: 'down' })
  assert.deepEqual(normalizeProbeResult(new Error('boom')), { ok: false, error: 'boom' })
  assert.deepEqual(normalizeProbeResult({ ok: true, status: 503 }), { ok: true, status: 503 })
  assert.deepEqual(normalizeProbeResult({ ok: true, models: ['a', 1, 'b'] }), { ok: true, models: ['a', 'b'] })
  assert.deepEqual(normalizeProbeResult(null), { ok: false, error: '无响应' })
  assert.deepEqual(validateProviderSpec(provider('wb', ['hy3'])), [])
})
