/** 平台差异：图标格式、托盘模板图、支持矩阵。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { iconFileFor, isSupportedPlatform, platformLabel, trayIconFileFor } from '../src/platform.ts'

test('图标格式按平台选择：ico / icns / png', () => {
  assert.equal(iconFileFor('win32'), 'icon.ico')
  assert.equal(iconFileFor('darwin'), 'icon.icns')
  assert.equal(iconFileFor('linux'), 'icon.png')
  assert.equal(iconFileFor('freebsd'), 'icon.png')
})

test('macOS 托盘用模板图，其余用应用图标', () => {
  assert.equal(trayIconFileFor('darwin'), 'trayTemplate.png')
  assert.equal(trayIconFileFor('win32'), 'icon.ico')
  assert.equal(trayIconFileFor('linux'), 'icon.png')
})

test('支持矩阵与展示名', () => {
  assert.equal(isSupportedPlatform('win32'), true)
  assert.equal(isSupportedPlatform('darwin'), true)
  assert.equal(isSupportedPlatform('linux'), true)
  assert.equal(isSupportedPlatform('aix'), false)
  assert.equal(platformLabel('darwin'), 'macOS')
  assert.equal(platformLabel('linux'), 'Linux')
})
