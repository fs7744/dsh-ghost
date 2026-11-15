// SPDX-License-Identifier: Apache-2.0
/** model-adapter-kit 契约单测（C3-04）：版本兼容、3 方法契约、脚手架生成。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MODEL_ADAPTER_CONTRACT_VERSION, DEFAULT_MODELS, createEchoAdapter,
  isCompatible, checkContract, generateAdapterScaffold,
  type ModelAdapter,
} from '../src/index.ts'

test('契约只有 3 个方法：listModels / chat / close', () => {
  const adapter: ModelAdapter = createEchoAdapter()
  assert.deepEqual(Object.keys(adapter).sort(), ['chat', 'close', 'listModels'])
})

test('参考实现的 listModels 给静态模型列表', async () => {
  const models = await createEchoAdapter().listModels()
  assert.equal(models.length, DEFAULT_MODELS.length)
  assert.equal(models[0]?.id, 'echo-1')
  assert.ok(models.some(model => model.contextWindow !== undefined))
})

test('chat 回显最后一条 user 文本，不断言别的文本', async () => {
  const response = await createEchoAdapter().chat({
    model: 'echo-1',
    messages: [
      { role: 'system', content: '系统提示' },
      { role: 'user', content: '第一句' },
      { role: 'assistant', content: '答复' },
      { role: 'user', content: '第二句' },
    ],
  })
  assert.equal(response.content, 'ECHO:第二句')
  assert.equal(response.finishReason, 'stop')
  const noUser = await createEchoAdapter().chat({ model: 'echo-1', messages: [{ role: 'system', content: '只有系统' }] })
  assert.equal(noUser.content, 'ECHO:', '没有 user 消息时回退成空串，不抛错')
})

test('close 是可调用的无副作用方法', async () => {
  const adapter = createEchoAdapter()
  await adapter.close()
  assert.equal(typeof adapter.close, 'function')
})

test('isCompatible 同版本与 patch 差异都兼容', () => {
  assert.equal(isCompatible('1.0.0', '1.0.0'), true)
  assert.equal(isCompatible('1.0.9', '1.0.0'), true)
  assert.equal(isCompatible('1.0.0-rc.1', '1.0.0'), true)
})

test('isCompatible major 不一致一律不兼容', () => {
  assert.equal(isCompatible('2.0.0', '1.0.0'), false)
  assert.equal(isCompatible('0.9.0', '1.0.0'), false)
})

test('isCompatible 插件 minor 高于宿主不兼容，低于宿主兼容', () => {
  assert.equal(isCompatible('1.2.0', '1.1.0'), false)
  assert.equal(isCompatible('1.0.0', '1.1.0'), true)
})

test('isCompatible 非法版本一律不兼容', () => {
  assert.equal(isCompatible('latest', '1.0.0'), false)
  assert.equal(isCompatible('', '1.0.0'), false)
  assert.equal(isCompatible('1.0', '1.0.0'), false)
  assert.equal(isCompatible('1.0.0', 'nope'), false)
})

test('checkContract 返回结构化结果与原因', () => {
  const result = checkContract({ contractVersion: '1.0.0' })
  assert.equal(result.ok, true)
  assert.equal(result.pluginVersion, '1.0.0')
  assert.equal(result.hostVersion, MODEL_ADAPTER_CONTRACT_VERSION)
  assert.equal(result.reason, '兼容')
})

test('checkContract 非法版本给出可读原因', () => {
  const missing = checkContract({ contractVersion: 'x' })
  assert.equal(missing.ok, false)
  assert.match(missing.reason, /格式非法/)
  const tooNew = checkContract({ contractVersion: '1.5.0' })
  assert.equal(tooNew.ok, false)
  assert.match(tooNew.reason, /minor/)
})

test('generateAdapterScaffold 生成只依赖本包的 3 方法骨架', () => {
  const source = generateAdapterScaffold({ name: 'my-gateway' })
  assert.match(source, /SPDX-License-Identifier: Apache-2.0/)
  assert.match(source, /from '@dsh-ghost\/model-adapter-kit'/)
  assert.match(source, /listModels:/)
  assert.match(source, /chat:/)
  assert.match(source, /close:/)
  assert.match(source, /createMyGatewayAdapter/)
  assert.match(source, new RegExp(MODEL_ADAPTER_CONTRACT_VERSION.replace(/\./g, '\\.')))
  assert.doesNotMatch(source, /@deepseek-ai/)
})

test('generateAdapterScaffold 拒绝非法 name 并接受自定义 modelIds', () => {
  assert.throws(() => generateAdapterScaffold({ name: 'Bad_Name' }), /名称不合法/)
  assert.throws(() => generateAdapterScaffold({ name: '' }), /名称不合法/)
  const source = generateAdapterScaffold({ name: 'local-llm', modelIds: ['qwen', 'llama'] })
  assert.match(source, /"qwen"/)
  assert.match(source, /"llama"/)
  assert.match(source, /createLocalLlmAdapter/)
})
