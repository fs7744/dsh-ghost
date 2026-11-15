/**
 * 桌面壳配置单测（C5-05/08/12/13、C7）：迁移与非法值拒绝。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_CONFIG, mergeConfig, migrateConfig, readConfig, validateConfig,
  writeConfig, type ShellConfig,
} from '../src/config.ts'
import { FakeFs } from './fakes.ts'

test('DEFAULT_CONFIG 默认值：遥测/崩溃关闭、人工审批、稳定通道', () => {
  assert.equal(DEFAULT_CONFIG.telemetryEnabled, false)
  assert.equal(DEFAULT_CONFIG.crashReportsEnabled, false)
  assert.equal(DEFAULT_CONFIG.approvalPreset, 'workspace-write')
  assert.equal(DEFAULT_CONFIG.updateChannel, 'stable')
  assert.equal(DEFAULT_CONFIG.locale, 'system')
})

test('validateConfig 接受完整合法配置', () => {
  const r = validateConfig({ ...DEFAULT_CONFIG, workspaceDir: 'D:/work' })
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.value.workspaceDir, 'D:/work')
})

test('validateConfig 缺字段用默认补齐', () => {
  const r = validateConfig({ locale: 'en-US' })
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.value.locale, 'en-US')
    assert.equal(r.value.launchOnStartup, DEFAULT_CONFIG.launchOnStartup)
    assert.deepEqual(r.value.window, DEFAULT_CONFIG.window)
  }
})

test('validateConfig 拒绝非法 locale / channel / approval / modelSource', () => {
  const r = validateConfig({
    locale: 'xx', updateChannel: 'canary', approvalPreset: 'god', modelSource: 'nope',
  })
  assert.equal(r.ok, false)
  if (!r.ok) {
    assert.ok(r.errors.includes('invalid:locale'))
    assert.ok(r.errors.includes('invalid:updateChannel'))
    assert.ok(r.errors.includes('invalid:approvalPreset'))
    assert.ok(r.errors.includes('invalid:modelSource'))
  }
})

test('validateConfig 拒绝非布尔、非法 window 与非法 infoSources', () => {
  const r = validateConfig({
    launchOnStartup: 'yes', telemetryEnabled: 1,
    window: { x: 0, y: 0, width: -5, height: 800 },
    infoSources: { github: 'on' },
  })
  assert.equal(r.ok, false)
  if (!r.ok) {
    assert.ok(r.errors.includes('invalid:launchOnStartup'))
    assert.ok(r.errors.includes('invalid:telemetryEnabled'))
    assert.ok(r.errors.includes('invalid:window'))
    assert.ok(r.errors.includes('invalid:infoSources'))
  }
})

test('validateConfig 拒绝非对象输入', () => {
  for (const v of [null, 42, 'x', []]) assert.equal(validateConfig(v).ok, false)
})

test('migrateConfig 把 v0 别名映射到当前字段并补齐', () => {
  const r = migrateConfig({
    lang: 'zh-CN', autoStart: true, workdir: 'D:/w', permissionMode: 'read-only',
  })
  assert.equal(r.migrated, true)
  assert.equal(r.config.locale, 'zh-CN')
  assert.equal(r.config.launchOnStartup, true)
  assert.equal(r.config.workspaceDir, 'D:/w')
  assert.equal(r.config.approvalPreset, 'read-only')
  assert.equal(r.config.version, 1)
})

test('migrateConfig 丢弃未知字段并把非法值回退默认', () => {
  const r = migrateConfig({ version: 1, locale: 'BAD', unknownField: 1, launchOnStartup: 'no' })
  assert.ok(r.dropped.includes('unknownField'))
  assert.equal(r.config.locale, 'system')
  assert.equal(r.config.launchOnStartup, false)
})

test('migrateConfig 对已是 v1 的合法配置不改动，null 输入回退默认', () => {
  const same = migrateConfig({ ...DEFAULT_CONFIG })
  assert.equal(same.migrated, false)
  assert.equal(same.config.locale, 'system')
  const empty = migrateConfig(null)
  assert.equal(empty.migrated, true)
  assert.deepEqual(empty.config.window, DEFAULT_CONFIG.window)
})

test('writeConfig 拒绝非法配置并写入合法配置', () => {
  const fs = new FakeFs()
  const bad = { ...DEFAULT_CONFIG, locale: 'xx' } as unknown as ShellConfig
  assert.throws(() => writeConfig(fs, 'C:/settings.json', bad))
  assert.equal(fs.exists('C:/settings.json'), false)
  writeConfig(fs, 'C:/settings.json', { ...DEFAULT_CONFIG })
  assert.equal(fs.exists('C:/settings.json'), true)
  assert.ok(fs.readFile('C:/settings.json').includes('"version": 1'))
})

test('readConfig 缺失时回写默认，损坏 JSON 时回退默认', () => {
  const fs = new FakeFs()
  const a = readConfig(fs, 'C:/settings.json')
  assert.equal(a.migrated, true)
  assert.equal(fs.exists('C:/settings.json'), true)
  fs.writeFile('C:/settings.json', '{broken')
  const b = readConfig(fs, 'C:/settings.json')
  assert.equal(b.config.locale, 'system')
  assert.equal(b.migrated, true)
})

test('mergeConfig 合并局部更新并拒绝非法 patch', () => {
  const ok = mergeConfig({ ...DEFAULT_CONFIG }, { launchOnStartup: true, updateChannel: 'beta' })
  assert.equal(ok.ok, true)
  if (ok.ok) {
    assert.equal(ok.value.launchOnStartup, true)
    assert.equal(ok.value.updateChannel, 'beta')
  }
  const bad = mergeConfig({ ...DEFAULT_CONFIG }, { updateChannel: 'canary' as unknown as 'stable' })
  assert.equal(bad.ok, false)
})
