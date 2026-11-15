/**
 * 界面多语言单测（C5-12）：locale 跟随系统、覆盖、文案回退与插值。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTranslator, resolveLocale, SUPPORTED_LOCALES, translate } from '../src/i18n.ts'

test('resolveLocale 跟随系统：zh* -> zh-CN，其余 -> en-US', () => {
  assert.equal(resolveLocale('zh-CN'), 'zh-CN')
  assert.equal(resolveLocale('zh-TW'), 'zh-CN')
  assert.equal(resolveLocale('en-US'), 'en-US')
  assert.equal(resolveLocale('fr-FR'), 'en-US')
})

test('override 覆盖系统 locale', () => {
  assert.equal(resolveLocale('zh-CN', 'en-US'), 'en-US')
  assert.equal(resolveLocale('en-US', 'zh-CN'), 'zh-CN')
  assert.equal(resolveLocale('en-US', 'system'), 'en-US')
})

test('非法 override 回退到 system 判定', () => {
  assert.equal(resolveLocale('zh-CN', 'klingon'), 'zh-CN')
  assert.equal(resolveLocale('en-US', 'klingon'), 'en-US')
})

test('translate 命中当前语言文案', () => {
  assert.equal(translate('tray.show', 'zh-CN'), '显示主窗口')
  assert.equal(translate('tray.show', 'en-US'), 'Show main window')
})

test('缺失 key 回退到 en-US 文案', () => {
  assert.equal(translate('only.en', 'zh-CN'), 'English only entry')
})

test('完全不存在的 key 返回 key 本身', () => {
  assert.equal(translate('no.such.key', 'zh-CN'), 'no.such.key')
})

test('translate 插值 {name}', () => {
  assert.equal(translate('notice.pending', 'zh-CN', { count: 3 }), '3 张票待人处理')
  assert.equal(translate('about.version', 'en-US', { version: '1.2.3' }), 'Version 1.2.3')
})

test('缺失插值变量时保持原占位符', () => {
  assert.equal(translate('notice.pending', 'zh-CN'), '{count} 张票待人处理')
})

test('createTranslator 绑定语言并支持插值', () => {
  const t = createTranslator('en-US')
  assert.equal(t('menu.help'), 'Help')
  assert.equal(t('notice.pending', { count: 5 }), '5 tickets need attention')
})

test('SUPPORTED_LOCALES 恰为中英两种', () => {
  assert.deepEqual([...SUPPORTED_LOCALES], ['zh-CN', 'en-US'])
})

test('关键文案中英均有翻译（无漏翻回退到 key）', () => {
  for (const key of ['app.name', 'tray.quit', 'menu.about', 'onboarding.title', 'common.ok', 'about.disclaimer']) {
    assert.notEqual(translate(key, 'zh-CN'), key)
    assert.notEqual(translate(key, 'en-US'), key)
  }
})
