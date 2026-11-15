/**
 * 安全存储单测（C5-13 / C2-03）：加解密往返、settings 无明文、不可用降级。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CredentialVault } from '../src/credentials.ts'
import { FakeFs, FakeSafeStorage } from './fakes.ts'

function make(available = true) {
  const fs = new FakeFs()
  const storage = new FakeSafeStorage(available)
  const vault = new CredentialVault({ safeStorage: storage, fs, path: 'C:/settings.json' })
  return { fs, storage, vault }
}

test('safeStorage 可用时 set/get 往返正确', () => {
  const { vault } = make()
  assert.equal(vault.set('wb', 'sk-real-looking-123').stored, true)
  assert.equal(vault.get('wb'), 'sk-real-looking-123')
})

test('凭据绝不明文进 settings', () => {
  const { fs, vault } = make()
  const plain = 'sk-SUPERSECRET-000'
  vault.set('wb', plain)
  assert.equal(vault.countPlaintextOccurrences(plain), 0)
  assert.ok(!fs.readFile('C:/settings.json').includes(plain))
})

test('settings 只写 {v:1, items} 密文结构', () => {
  const { fs, vault } = make()
  vault.set('wb', 'secret')
  const parsed = JSON.parse(fs.readFile('C:/settings.json')) as { v: number; items: Record<string, string> }
  assert.equal(parsed.v, 1)
  assert.equal(typeof parsed.items['wb'], 'string')
  assert.notEqual(parsed.items['wb'], 'secret')
})

test('safeStorage 不可用时明确降级为 unavailable 且不落盘', () => {
  const { fs, vault } = make(false)
  const r = vault.set('wb', 'secret')
  assert.equal(r.stored, false)
  assert.equal(r.mode, 'unavailable')
  assert.ok(r.reason.includes('unavailable'))
  assert.equal(fs.exists('C:/settings.json'), false)
})

test('降级时凭据仅内存可用，新 vault（重启）即失效', () => {
  const { fs, storage, vault } = make(false)
  vault.set('wb', 'secret')
  assert.equal(vault.get('wb'), 'secret')
  const again = new CredentialVault({ safeStorage: storage, fs, path: 'C:/settings.json' })
  assert.equal(again.get('wb'), null)
})

test('vault.mode 反映加密可用状态', () => {
  assert.equal(make(true).vault.mode(), 'encrypted')
  assert.equal(make(false).vault.mode(), 'unavailable')
})

test('settings 结构损坏时 get 返回 null', () => {
  const { fs, vault } = make()
  vault.set('wb', 'secret')
  fs.writeFile('C:/settings.json', '{"v":999,"items":{}}')
  assert.equal(vault.get('wb'), null)
})

test('remove 删除指定凭据且不影响其他', () => {
  const { vault } = make()
  vault.set('a', 'one')
  vault.set('b', 'two')
  vault.remove('a')
  assert.equal(vault.get('a'), null)
  assert.equal(vault.get('b'), 'two')
})

test('多个凭据并存互不干扰', () => {
  const { vault } = make()
  vault.set('a', 'AAA')
  vault.set('b', 'BBB')
  assert.equal(vault.get('a'), 'AAA')
  assert.equal(vault.get('b'), 'BBB')
})

test('空 name / 空明文被拒绝', () => {
  const { vault } = make()
  assert.equal(vault.set('', 'x').stored, false)
  assert.equal(vault.set('a', '').stored, false)
})

test('重复 set 覆盖旧值', () => {
  const { vault } = make()
  vault.set('a', 'old')
  vault.set('a', 'new')
  assert.equal(vault.get('a'), 'new')
})

test('加密写入后切换为不可用，不会把旧密文当明文返回', () => {
  const { fs, storage, vault } = make(true)
  vault.set('a', 'secret')
  storage.available = false
  assert.equal(vault.mode(), 'unavailable')
  assert.equal(vault.get('a'), null)
  assert.ok(!fs.readFile('C:/settings.json').includes('secret'))
})
