/** 凭据引用校验单测（C2-03）：拒绝明文 key，只允许 env 引用名。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ENV_REF_NAME, looksLikePlaintextKey, validateCredentialRef, findPlaintextCredentials,
  validateProviderSpec, generateLocalRoute, type ProviderSpec,
} from '../src/index.ts'

// 用拼接构造，避免源码里出现形似真实密钥的字面量（会被 check-secrets 扫到）。
const fakeSk = ['sk-', 'a'.repeat(24)].join('')
const fakeWb = ['wbk_', '0'.repeat(20)].join('')

test('validateCredentialRef 接受合法 env 名', () => {
  for (const name of ['WB_KEY', 'OLLAMA_API_KEY', 'VLLM_API_KEY', 'A1']) {
    assert.equal(ENV_REF_NAME.test(name), true, name)
    assert.equal(validateCredentialRef(name).ok, true, name)
  }
})

test('validateCredentialRef 拒绝小写 / 空 / 含符号', () => {
  assert.equal(validateCredentialRef('wb_key').ok, false)
  assert.equal(validateCredentialRef('').ok, false)
  assert.equal(validateCredentialRef('WB-KEY').ok, false)
  assert.equal(validateCredentialRef('WB KEY').ok, false)
  assert.equal(validateCredentialRef(123).ok, false)
})

test('looksLikePlaintextKey 识别常见密钥前缀', () => {
  assert.equal(looksLikePlaintextKey(fakeSk), true)
  assert.equal(looksLikePlaintextKey(fakeWb), true)
  assert.equal(looksLikePlaintextKey('Bearer abc.def.ghi'), true)
  assert.equal(looksLikePlaintextKey(['A'.repeat(20), 'lower', '9', 'B'.repeat(10)].join('')), true)
})

test('looksLikePlaintextKey 不误判 env 引用名', () => {
  assert.equal(looksLikePlaintextKey('WB_KEY'), false)
  assert.equal(looksLikePlaintextKey('OLLAMA_API_KEY'), false)
  assert.equal(looksLikePlaintextKey('VLLM_API_KEY_1234567890'), false)
})

test('validateCredentialRef 拒绝明文 key 并给出原因', () => {
  const result = validateCredentialRef(fakeSk)
  assert.equal(result.ok, false)
  assert.match(result.reason, /明文/)
  assert.equal(validateCredentialRef(fakeWb).ok, false)
})

test('findPlaintextCredentials 从配置里挑出明文字段', () => {
  const config = { apiKeyEnv: 'WB_KEY', token: fakeSk, note: 'ok', nested: 42 }
  assert.deepEqual(findPlaintextCredentials(config), ['token'])
  assert.deepEqual(findPlaintextCredentials({ apiKeyEnv: 'WB_KEY' }), [])
})

test('validateProviderSpec 与 generateLocalRoute 拒绝明文 apiKeyEnv', () => {
  const bad = {
    id: 'wb', displayName: 'WB', api: 'openai-completions', apiKeyEnv: fakeSk,
    models: [{ id: 'hy3', capabilities: { contextWindow: 8192, maxTokens: 2048, reasoningEfforts: [] } }],
  } as unknown as ProviderSpec
  assert.ok(validateProviderSpec(bad).some(x => x.includes('apiKeyEnv')))
  assert.throws(() => generateLocalRoute('ollama', { apiKeyEnv: fakeSk }), /apiKeyEnv 不合法/)
})
