/**
 * 模型自动发现与负载均衡选路的纯逻辑用例。
 * 零网络、零文件：所有外部输入都是固定数据，保证断言可重复。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  discoveryUrl, discoveryHeaders, parseDiscoveredModels,
  selectBalanceTarget, isBalanceStrategy, BALANCE_STRATEGIES,
  type BalanceCandidate,
} from '../src/index.ts'

test('discoveryUrl 按协议走各自的业界标准端点，且不重复加版本前缀', () => {
  assert.equal(discoveryUrl('https://api.openai.com/v1/', 'openai-completions'), 'https://api.openai.com/v1/models')
  assert.equal(discoveryUrl('https://api.openai.com/v1', 'openai-responses'), 'https://api.openai.com/v1/models')
  assert.equal(discoveryUrl('https://api.anthropic.com', 'anthropic-messages'), 'https://api.anthropic.com/v1/models?limit=100')
  assert.equal(discoveryUrl('https://api.anthropic.com/v1', 'anthropic-messages'), 'https://api.anthropic.com/v1/models?limit=100')
  assert.equal(discoveryUrl('https://generativelanguage.googleapis.com', 'google-generative-ai'), 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=100')
})

test('discoveryHeaders 按协议使用正确的鉴权头，空密钥不带认证', () => {
  assert.deepEqual(discoveryHeaders('openai-completions', 'sk-x'), { accept: 'application/json', authorization: 'Bearer sk-x' })
  assert.deepEqual(discoveryHeaders('anthropic-messages', 'sk-ant'), {
    accept: 'application/json', 'x-api-key': 'sk-ant', 'anthropic-version': '2023-06-01',
  })
  assert.deepEqual(discoveryHeaders('google-generative-ai', 'goog'), { accept: 'application/json', 'x-goog-api-key': 'goog' })
  assert.deepEqual(discoveryHeaders('openai-completions', undefined), { accept: 'application/json' })
})

test('parseDiscoveredModels 支持 OpenAI / Gemini / 裸数组三种形状并去重', () => {
  const openai = parseDiscoveredModels('openai-completions', {
    data: [{ id: 'gpt-4o' }, { id: 'gpt-4o' }, { id: 'o3', display_name: 'O3' }],
  })
  assert.deepEqual(openai.map(item => item.id), ['gpt-4o', 'o3'])
  assert.equal(openai[1]?.name, 'O3')
  assert.equal(openai[0]?.capabilities.contextWindow, 128_000)

  const gemini = parseDiscoveredModels('google-generative-ai', {
    models: [{ name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' }],
  })
  assert.deepEqual(gemini.map(item => item.id), ['gemini-2.5-pro'])
  assert.equal(gemini[0]?.name, 'Gemini 2.5 Pro')

  const array = parseDiscoveredModels('anthropic-messages', [{ id: 'claude-sonnet-4', display_name: 'Sonnet' }])
  assert.deepEqual(array.map(item => item.id), ['claude-sonnet-4'])
  assert.deepEqual(parseDiscoveredModels('openai-completions', { unexpected: true }), [])
})

const pool: readonly BalanceCandidate[] = [
  { id: 'a', enabled: true, weight: 1 },
  { id: 'b', enabled: true, weight: 3 },
  { id: 'c', enabled: false, weight: 99 },
]

test('selectBalanceTarget: off 恒定选第一个可用候选，停用项永不参与', () => {
  assert.equal(selectBalanceTarget(pool, 'off', 0).target?.id, 'a')
  assert.equal(selectBalanceTarget(pool, 'off', 123).target?.id, 'a')
  assert.equal(selectBalanceTarget(pool, 'round-robin', 0).target?.id, 'a')
})

test('selectBalanceTarget: round-robin 按游标轮流且跳过停用项', () => {
  assert.equal(selectBalanceTarget(pool, 'round-robin', 0).target?.id, 'a')
  assert.equal(selectBalanceTarget(pool, 'round-robin', 1).target?.id, 'b')
  assert.equal(selectBalanceTarget(pool, 'round-robin', 2).target?.id, 'a')
  assert.equal(selectBalanceTarget(pool, 'round-robin', 1).cursor, 2)
})

test('selectBalanceTarget: random / weighted 使用注入的随机源，结果确定', () => {
  assert.equal(selectBalanceTarget(pool, 'random', 0, () => 0).target?.id, 'a')
  assert.equal(selectBalanceTarget(pool, 'random', 0, () => 0.99).target?.id, 'b')
  // 权重 1:3 → 0.24 落在 a，0.25 落在 b
  assert.equal(selectBalanceTarget(pool, 'weighted', 0, () => 0.24).target?.id, 'a')
  assert.equal(selectBalanceTarget(pool, 'weighted', 0, () => 0.25).target?.id, 'b')
})

test('selectBalanceTarget: failover 用游标当序号并回绕，不自动推进', () => {
  assert.equal(selectBalanceTarget(pool, 'failover', 0).target?.id, 'a')
  assert.equal(selectBalanceTarget(pool, 'failover', 1).target?.id, 'b')
  assert.equal(selectBalanceTarget(pool, 'failover', 2).target?.id, 'a')
  assert.equal(selectBalanceTarget(pool, 'failover', 1).cursor, 1)
})

test('selectBalanceTarget: 没有可用候选时返回空结果与原游标', () => {
  const none = [{ id: 'x', enabled: false }, { id: 'y', weight: 0 }]
  for (const strategy of BALANCE_STRATEGIES) {
    const result = selectBalanceTarget(none, strategy, 7)
    assert.equal(result.target, undefined)
    assert.equal(result.cursor, 7)
  }
})

test('isBalanceStrategy 只认五种策略', () => {
  assert.equal(isBalanceStrategy('round-robin'), true)
  assert.equal(isBalanceStrategy('failover'), true)
  assert.equal(isBalanceStrategy('magic'), false)
})
