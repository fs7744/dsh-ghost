/**
 * 模型管理页本机 API（C3 与桌面壳接线）：路由归属、状态校验、探测与预设。
 * 全部用内存 store 与注入 probe，不发网络请求。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createMemoryStore, type CatalogState } from '@dsh-ghost/model-manager'
import { createModelsApi, fromView, toView, isLocalModelsApi } from '../src/models-api.ts'
import { shouldProxy } from '../src/static-server.ts'

const VALID = {
  providers: [{
    id: 'wb', displayName: 'WorkBuddy Gateway', api: 'openai-completions',
    baseURL: 'http://127.0.0.1:7864/v1', apiKeyEnv: 'WB_KEY',
    models: [{ id: 'hy3', name: 'hy3', capabilities: { contextWindow: 192000, maxTokens: 8192, reasoningEfforts: [] } }],
  }],
  bindings: [{ role: 'router', providerId: 'wb', modelId: 'hy3' }],
}

test('模型 API 留在本机，其它 /api 仍反代宿主', () => {
  assert.equal(isLocalModelsApi('/api/models/state'), true)
  assert.equal(isLocalModelsApi('/api/models/probe?x=1'), true)
  assert.equal(isLocalModelsApi('/api/models'), false)
  assert.equal(shouldProxy('/api/models/state'), false)
  assert.equal(shouldProxy('/api/session/list'), true)
  assert.equal(shouldProxy('/connect?token=abc'), true)
})

test('GET /state 空目录返回 demo:false 的确定形状', async () => {
  const api = createModelsApi({ store: createMemoryStore() })
  const res = await api.handle('GET', '/api/models/state')
  assert.equal(res.status, 200)
  const body = res.body as { demo: boolean; providers: unknown[]; bindings: unknown[] }
  assert.equal(body.demo, false)
  assert.deepEqual(body.providers, [])
  assert.deepEqual(body.bindings, [])
})

test('POST /state 合法配置写入并可往返读出', async () => {
  const api = createModelsApi({ store: createMemoryStore() })
  const saved = await api.handle('POST', '/api/models/state', VALID)
  assert.equal(saved.status, 200)
  const body = saved.body as { providers: Array<{ id: string; models: Array<{ name: string }> }> }
  assert.equal(body.providers[0]?.id, 'wb')
  assert.equal(body.providers[0]?.models[0]?.name, 'hy3')
  const reread = await api.handle('GET', '/api/models/state')
  assert.deepEqual(reread.body, saved.body)
})

test('明文凭据被拒，绝不写进配置', async () => {
  const store = createMemoryStore()
  const api = createModelsApi({ store })
  const bad = structuredClone(VALID) as unknown as Record<string, unknown>
  const providers = bad.providers as Array<Record<string, unknown>>
  // 运行时拼一个「长得像 key」的值：既能测明文拒绝，又不在仓库里留密钥字面量。
  providers[0]!.apiKeyEnv = ['sk', 'abcdefghijklmnopqrstuvwxyz012345'].join('-')
  const res = await api.handle('POST', '/api/models/state', bad)
  assert.equal(res.status, 400)
  const state = await store.read()
  assert.deepEqual(state.providers, [])
})

test('非法能力标注 / 非法 provider id 被拒', async () => {
  const api = createModelsApi({ store: createMemoryStore() })
  const bad = structuredClone(VALID) as unknown as Record<string, unknown>
  const providers = bad.providers as Array<Record<string, unknown>>
  const models = providers[0]!.models as Array<Record<string, unknown>>
  models[0]!.capabilities = { contextWindow: 100, maxTokens: 200, reasoningEfforts: [] }
  assert.equal((await api.handle('POST', '/api/models/state', bad)).status, 400)
  const bad2 = structuredClone(VALID) as unknown as Record<string, unknown>
  ;(bad2.providers as Array<Record<string, unknown>>)[0]!.id = 'Bad Id'
  assert.equal((await api.handle('POST', '/api/models/state', bad2)).status, 400)
})

test('连通性自测走注入 probe，成功与失败都归一化', async () => {
  const ok = createModelsApi({ store: createMemoryStore(await fromViewStore()), probe: () => ({ status: 200, models: ['hy3'] }) })
  const good = await ok.handle('POST', '/api/models/probe', { providerId: 'wb' })
  assert.equal(good.status, 200)
  assert.equal((good.body as { ok: boolean }).ok, true)
  const bad = createModelsApi({ store: createMemoryStore(await fromViewStore()), probe: () => new Error('connection refused') })
  const failed = await bad.handle('POST', '/api/models/probe', { providerId: 'wb' })
  assert.equal((failed.body as { ok: boolean }).ok, false)
  assert.match((failed.body as { detail: string }).detail, /connection refused/)
  const missing = await ok.handle('POST', '/api/models/probe', { providerId: 'nope' })
  assert.equal(missing.status, 404)
})

test('本地预设生成 route 并去重，未知预设被拒', async () => {
  const api = createModelsApi({ store: createMemoryStore() })
  const first = await api.handle('POST', '/api/models/preset', { preset: 'ollama' })
  assert.equal(first.status, 200)
  assert.equal((first.body as ReturnType<typeof toView>).providers.length, 1)
  const again = await api.handle('POST', '/api/models/preset', { preset: 'ollama' })
  assert.equal((again.body as ReturnType<typeof toView>).providers.length, 1, '重复应用不产生重复 provider')
  const vllm = await api.handle('POST', '/api/models/preset', { preset: 'vllm' })
  assert.equal((vllm.body as ReturnType<typeof toView>).providers.length, 2)
  assert.equal((await api.handle('POST', '/api/models/preset', { preset: 'bogus' })).status, 400)
})

test('未知路径 / 非对象 body 都有明确响应', async () => {
  const api = createModelsApi({ store: createMemoryStore() })
  assert.equal((await api.handle('GET', '/api/models/unknown')).status, 404)
  assert.equal((await api.handle('POST', '/api/models/state', 'not json object')).status, 400)
  assert.throws(() => fromView({}), /providers/)
})

/** 从视图形状建一份 CatalogState（测试里复用，避免重复字面量）。 */
async function fromViewStore(): Promise<CatalogState> {
  return fromView(VALID)
}
