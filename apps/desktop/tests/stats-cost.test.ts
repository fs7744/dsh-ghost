/** 统计页成本换算：单价解析、金额格式化、成本行（不编数字）。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readHarnessUsage } from '@dsh-ghost/economizer'
import { costRows, formatCost, parsePricing } from '../src/stats-cost.ts'

const USAGE = readHarnessUsage({
  values: {
    tokenUsage: { uncachedInputTokens: 1000, cacheReadTokens: 9000, cacheWriteTokens: 0, outputTokens: 500 },
  },
})

test('单价解析：非法或缺项当作没配，缓存价有默认值', () => {
  assert.equal(parsePricing(undefined), undefined)
  assert.equal(parsePricing('not json'), undefined)
  assert.equal(parsePricing('{"outputPerMillion": 15}'), undefined, '缺输入价就不算配了')
  const pricing = parsePricing('{"inputPerMillion": 3, "outputPerMillion": 15}')
  assert.equal(pricing?.inputPerMillion, 3)
  assert.equal(Math.round((pricing?.cacheReadPerMillion ?? 0) * 1000) / 1000, 0.3, '缓存读默认按输入价 1/10')
  assert.equal(Math.round((pricing?.cacheWritePerMillion ?? 0) * 100) / 100, 3.75, '缓存写默认按输入价 1.25 倍')
})

test('金额格式化：小于一分钱不假装精确', () => {
  assert.equal(formatCost(0), '$0')
  assert.equal(formatCost(0.005), '< $0.01')
  assert.equal(formatCost(1.23456), '$1.2346')
})

test('成本行：没配单价只显示 token，配了才显示金额', () => {
  const withoutPrice = costRows(USAGE, undefined)
  assert.ok(withoutPrice.some(row => row.key === 'stats.cost.unset'))
  assert.equal(withoutPrice.some(row => row.key === 'stats.cost'), false)
  const hit = withoutPrice.find(row => row.key === 'stats.cacheHit')
  assert.equal(hit?.value, '90.0%')

  const withPrice = costRows(USAGE, parsePricing('{"inputPerMillion": 3, "outputPerMillion": 15}'))
  const cost = withPrice.find(row => row.key === 'stats.cost')
  assert.ok(cost !== undefined)
  assert.match(cost?.value ?? '', /^\$|< \$/)
  assert.equal(withPrice.some(row => row.key === 'stats.cost.unset'), false)
})
