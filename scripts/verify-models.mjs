#!/usr/bin/env node
/**
 * 模型管理面验收（C3-01/02/03/05 + C2-03）。
 *
 * 不依赖真模型：纯逻辑用可注入 store / probe，真实 HTTP 那一段用 L1 的
 * llm-mock-server 假端点。覆盖 route 生成、能力标注、角色路由、凭据引用、
 * 连通性自测归一化，以及独立 UI 页的纯逻辑（demo 数据、凭据隐藏、预设预览）。
 *
 * 用法:
 *   node --experimental-transform-types scripts/verify-models.mjs [--json]
 *
 * 退出码: 0 全部通过 / 1 有失败 / 2 用法错误。
 */
import { startMockServer, stopMockServer } from './llm-mock-server.mjs'
import {
  generateLocalRoute, validateCredentialRef, validateProviderSpec, validateCapabilities,
  createCatalog, createMemoryStore, validateRoleBindings, runConnectivityProbe,
} from '../packages/model-manager/src/index.ts'
import {
  DEMO_STATE, credentialRefLabel, buildLocalPresetView, formatCapabilities,
  resolveRoleView, flattenModels,
} from '../apps/desktop/src/models-view.ts'

let failures = 0
const check = (ok, label, detail = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === '' ? '' : `：${detail}`}\n`)
  if (!ok) failures += 1
}
const fakeKey = ['sk-', 'a'.repeat(24)].join('')

async function main() {
  // 1. route 生成
  const ollama = generateLocalRoute('ollama')
  check(ollama.baseURL === 'http://127.0.0.1:11434/v1' && ollama.apiKeyEnv === 'OLLAMA_API_KEY',
    'Ollama 预设 route', ollama.baseURL)
  let rejected = false
  try { generateLocalRoute('ollama', { port: 0 }) } catch { rejected = true }
  check(rejected, 'route 拒绝非法 port')
  let credRejected = false
  try { generateLocalRoute('vllm', { apiKeyEnv: fakeKey }) } catch { credRejected = true }
  check(credRejected, 'route 拒绝明文 apiKeyEnv')

  // 2. 凭据引用（C2-03）
  check(validateCredentialRef('WB_KEY').ok && !validateCredentialRef(fakeKey).ok,
    '凭据引用只认 env 名，明文被拒')
  check(validateProviderSpec({ ...ollama, apiKeyEnv: fakeKey }).some(x => x.includes('apiKeyEnv')),
    'provider 校验拒绝明文凭据')
  check(validateCapabilities({ contextWindow: 8192, maxTokens: 2048, reasoningEfforts: ['low'] }).length === 0
    && validateCapabilities({ contextWindow: 100, maxTokens: 9999, reasoningEfforts: [] }).length > 0,
  '能力标注校验')

  // 3. 目录与角色路由（可注入内存 store）
  const catalog = createCatalog(createMemoryStore())
  await catalog.addProvider(ollama)
  check((await catalog.listModels()).length === 1, '目录新增 provider 并列出模型')
  await catalog.bindRole({ role: 'router', providerId: 'ollama', modelId: 'llama3.1' })
  check((await catalog.resolve('router'))?.model.id === 'llama3.1', '角色 router 解析到默认模型')
  check(validateRoleBindings([{ role: 'worker', providerId: 'ollama', modelId: 'nope' }], [ollama]).length > 0,
    '失效角色绑定被检出')

  // 4. 连通性自测（可注入 probe + 结果归一化）
  const good = await runConnectivityProbe(ollama, () => ({ status: 200, latencyMs: 12, models: ['llama3.1'] }))
  check(good.ok && good.label === '连通' && good.models?.length === 1, '自测成功结果被归一化', JSON.stringify(good))
  const bad = await runConnectivityProbe(ollama, () => { throw new Error('down') })
  check(!bad.ok && /down/.test(bad.error ?? ''), '自测异常被归一化成不通')

  // 5. 真实 HTTP 那一段走 L1 假端点
  const mock = await startMockServer({ port: 0 })
  try {
    const live = await runConnectivityProbe(ollama, async () => {
      const res = await fetch(`${mock.url}/v1/models`)
      const body = await res.json()
      return { status: res.status, models: (body.data ?? []).map(item => item.id) }
    })
    check(live.ok && (live.models?.length ?? 0) > 0, '假端点连通性自测通过', `${mock.url}`)
    const faulted = await runConnectivityProbe(ollama, async () => {
      const res = await fetch(`${mock.url}/v1/models`, { headers: { 'x-dsh-fault': 'http500' } })
      return { status: res.status }
    })
    check(!faulted.ok && faulted.status === 500, '假端点故障注入被归一化成不通')
  } finally {
    await stopMockServer(mock)
  }

  // 6. 独立 UI 页的纯逻辑（零 DOM 部分）
  check(DEMO_STATE.demo === true && DEMO_STATE.providers.length > 0, 'demo 数据可离线展示')
  check(credentialRefLabel('WB_KEY') === 'env:WB_KEY' && credentialRefLabel(fakeKey) === '[凭据引用无效]',
    '界面只渲染 env 引用名，明文被隐藏')
  const uiView = buildLocalPresetView('ollama')
  check(uiView.baseURL === ollama.baseURL && uiView.apiKeyEnv === ollama.apiKeyEnv,
    '界面预设预览与 model-manager route 对齐')
  check(/上下文/.test(formatCapabilities(uiView.models[0].capabilities))
    && flattenModels(DEMO_STATE).length > 0
    && resolveRoleView(DEMO_STATE, 'router') !== undefined,
  '能力标注 / 模型展开 / 角色解析')

  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ failures, ok: failures === 0 }) + '\n')
  }
  process.stdout.write(`\n${failures === 0 ? '模型管理面验收通过' : `${failures} 项失败`}\n`)
  process.exit(failures === 0 ? 0 : 1)
}

void main().catch(error => {
  process.stderr.write(`${String(error)}\n`)
  process.exit(2)
})
