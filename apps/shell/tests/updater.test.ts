/**
 * 自动更新通道与灰度单测（C5-08 / C6）：只验判定逻辑，不联网、不真的发布。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  compareVersions, hashBucket, resolveChannel, shouldOfferUpdate, type UpdateDecisionInput,
} from '../src/updater.ts'

function decision(o?: Partial<UpdateDecisionInput>): UpdateDecisionInput {
  return {
    channel: o?.channel ?? 'stable',
    currentVersion: o?.currentVersion ?? '1.0.0',
    candidateVersion: o?.candidateVersion ?? '1.1.0',
    candidateChannel: o?.candidateChannel ?? 'stable',
    rolloutPercent: o?.rolloutPercent ?? 50,
    installId: o?.installId ?? 'install-xyz',
  }
}

test('resolveChannel none 完全关闭', () => {
  const r = resolveChannel('none', { stableFeed: 'https://x', betaFeed: 'https://y' })
  assert.equal(r.enabled, false)
  assert.equal(r.feedUrl, null)
})

test('resolveChannel stable / beta 选用对应 feed', () => {
  assert.equal(resolveChannel('stable', { stableFeed: 'S' }).feedUrl, 'S')
  assert.equal(resolveChannel('beta', { betaFeed: 'B' }).feedUrl, 'B')
})

test('resolveChannel 缺 feed 时 enabled=false（不联网）', () => {
  assert.equal(resolveChannel('stable', {}).enabled, false)
  assert.equal(resolveChannel('beta', { stableFeed: 'S' }).enabled, false)
})

test('compareVersions 比较主/次/修订版本', () => {
  assert.equal(compareVersions('1.2.3', '1.2.4'), -1)
  assert.equal(compareVersions('1.3.0', '1.2.9'), 1)
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0)
  assert.equal(compareVersions('1.0', '1.0.0'), 0)
})

test('hashBucket 确定性且落在 [0,100)', () => {
  const a = hashBucket('install-abc')
  assert.equal(hashBucket('install-abc'), a)
  assert.ok(a >= 0 && a < 100)
})

test('不同 installId 分散到多个桶', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l']
  const buckets = new Set(ids.map(id => hashBucket(id)))
  assert.ok(buckets.size >= 6)
})

test('shouldOfferUpdate 100% 灰度命中', () => {
  const r = shouldOfferUpdate(decision({ rolloutPercent: 100 }))
  assert.equal(r.offer, true)
  assert.equal(r.reason, 'full-rollout')
})

test('rolloutPercent 0 或负数被钳制为不命中', () => {
  assert.equal(shouldOfferUpdate(decision({ rolloutPercent: 0 })).reason, 'rollout-zero')
  assert.equal(shouldOfferUpdate(decision({ rolloutPercent: -50 })).reason, 'rollout-zero')
  assert.equal(shouldOfferUpdate(decision({ rolloutPercent: 500 })).offer, true)
})

test('none 通道关闭，stable 通道拒绝 beta 候选', () => {
  assert.equal(shouldOfferUpdate(decision({ channel: 'none' })).reason, 'channel-off')
  const mismatch = shouldOfferUpdate(decision({ candidateChannel: 'beta' }))
  assert.equal(mismatch.offer, false)
  assert.equal(mismatch.reason, 'channel-mismatch')
})

test('候选版本不新于当前版本时不提示', () => {
  assert.equal(shouldOfferUpdate(decision({ candidateVersion: '1.0.0' })).reason, 'not-newer')
  assert.equal(shouldOfferUpdate(decision({ candidateVersion: '0.9.0' })).reason, 'not-newer')
})

test('灰度边界：桶号小于放量百分比才命中', () => {
  const id = 'install-xyz'
  const bucket = hashBucket(id)
  assert.equal(shouldOfferUpdate(decision({ rolloutPercent: bucket + 1, installId: id })).offer, true)
  assert.equal(shouldOfferUpdate(decision({ rolloutPercent: bucket, installId: id })).offer, false)
})

test('同一 installId 判定稳定，且 beta 通道接受 beta 候选', () => {
  const a = shouldOfferUpdate(decision({ rolloutPercent: 37 }))
  const b = shouldOfferUpdate(decision({ rolloutPercent: 37 }))
  assert.deepEqual(a, b)
  const beta = shouldOfferUpdate(decision({ channel: 'beta', candidateChannel: 'beta', rolloutPercent: 100 }))
  assert.equal(beta.offer, true)
})
