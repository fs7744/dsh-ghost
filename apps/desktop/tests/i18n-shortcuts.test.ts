/**
 * i18n / 主题 / 快捷键纯逻辑单测（test:panels 的一部分）。
 * 覆盖：缺词回退、插值、locale 切换即时生效、主题归一化、快捷键解析与匹配、编辑区判定。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MESSAGES, getLocale, initLocale, interpolate, isLocale, makeTranslator,
  setLocale, subscribeLocale, toggleLocale, translate, type Locale,
} from '../src/i18n.ts'
import { applyTheme, getTheme, normalizeTheme, toggleTheme, toggleThemeValue } from '../src/theme.ts'
import {
  defaultCombos, formatShortcut, isEditableTarget, matchShortcut, parseShortcut, shouldHandleShortcut,
} from '../src/shortcuts.ts'

const dict: Record<Locale, Record<string, string>> = {
  zh: { a: '中文A', only: '仅中文' },
  en: { a: 'English A' },
}

test('isLocale 只认 zh / en', () => {
  assert.equal(isLocale('zh'), true)
  assert.equal(isLocale('en'), true)
  assert.equal(isLocale('fr'), false)
  assert.equal(isLocale(null), false)
  assert.equal(isLocale(1), false)
})

test('translate 当前语言优先，缺词回退到中文，再回退到键名', () => {
  assert.equal(translate('zh', 'a', dict), '中文A')
  assert.equal(translate('en', 'a', dict), 'English A')
  assert.equal(translate('en', 'only', dict), '仅中文', '英文缺词回退到中文')
  assert.equal(translate('en', 'gone', dict), 'gone', '中文也缺则回退到键名')
  assert.equal(translate('zh', 'gone', dict), 'gone')
})

test('MESSAGES 中英词表覆盖关键标签与通用文案', () => {
  assert.equal(MESSAGES.zh['tab.chat'], '对话')
  assert.equal(MESSAGES.en['tab.chat'], 'Chat')
  assert.equal(MESSAGES.zh['common.unavailable'], '该能力未启用')
  assert.equal(MESSAGES.en['common.unavailable'], 'Capability not enabled')
  assert.equal(translate('en', 'tab.chat'), 'Chat')
})

test('interpolate 替换已给参数，缺参保留占位符', () => {
  assert.equal(interpolate('{count} 项 / {total}', { count: 3, total: 5 }), '3 项 / 5')
  assert.equal(interpolate('{a} {b}', { a: 'x' }), 'x {b}')
  assert.equal(interpolate('无占位', {}), '无占位')
})

test('setLocale / toggleLocale / makeTranslator 切换即时生效并通知订阅者', () => {
  setLocale('zh')
  const t = makeTranslator()
  assert.equal(t('tab.chat'), '对话')
  let hits = 0
  const off = subscribeLocale(() => { hits += 1 })
  assert.equal(toggleLocale(), 'en')
  assert.equal(t('tab.chat'), 'Chat', '同一个翻译闭包立即返回新语言')
  assert.equal(getLocale(), 'en')
  assert.equal(hits, 1)
  off()
  setLocale('zh')
  assert.equal(getLocale(), 'zh', '复位，避免影响其它用例')
})

test('initLocale 在无 localStorage 的 Node 环境安全', () => {
  setLocale('zh')
  assert.doesNotThrow(() => initLocale())
  assert.equal(getLocale(), 'zh')
})

test('normalizeTheme / toggleThemeValue 暗色优先', () => {
  assert.equal(normalizeTheme('light'), 'light')
  assert.equal(normalizeTheme('dark'), 'dark')
  assert.equal(normalizeTheme(undefined), 'dark')
  assert.equal(normalizeTheme('weird'), 'dark')
  assert.equal(toggleThemeValue('dark'), 'light')
  assert.equal(toggleThemeValue('light'), 'dark')
})

test('applyTheme / toggleTheme 在无 DOM 环境也安全更新状态', () => {
  applyTheme('light')
  assert.equal(getTheme(), 'light')
  assert.doesNotThrow(() => applyTheme('dark'))
  assert.equal(toggleTheme(), 'light')
  assert.equal(getTheme(), 'light')
  applyTheme('dark')
})

test('parseShortcut 解析组合键，无法解析返回 null', () => {
  assert.deepEqual(parseShortcut('Ctrl+Shift+E'), { ctrl: true, shift: true, alt: false, meta: false, key: 'e' })
  assert.deepEqual(parseShortcut('Ctrl+1'), { ctrl: true, shift: false, alt: false, meta: false, key: '1' })
  assert.deepEqual(parseShortcut('Ctrl+,'), { ctrl: true, shift: false, alt: false, meta: false, key: ',' })
  assert.deepEqual(parseShortcut('Alt+Cmd+K'), { ctrl: false, shift: false, alt: true, meta: true, key: 'k' })
  assert.equal(parseShortcut(''), null)
  assert.equal(parseShortcut('Ctrl'), null, '只有修饰键没有主键')
})

test('matchShortcut 组合键精确匹配，大小写不敏感', () => {
  const base = { ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, key: 'E' }
  assert.equal(matchShortcut('Ctrl+Shift+E', base), true)
  assert.equal(matchShortcut('Ctrl+Shift+E', { ...base, shiftKey: false }), false)
  assert.equal(matchShortcut('Ctrl+E', { ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, key: 'e' }), true)
  assert.equal(matchShortcut('Ctrl+E', { ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, key: 'E' }), false)
  assert.equal(matchShortcut('', base), false)
})

test('isEditableTarget / shouldHandleShortcut 保护输入框', () => {
  assert.equal(isEditableTarget(null), false)
  assert.equal(isEditableTarget({ tagName: 'TEXTAREA' }), true)
  assert.equal(isEditableTarget({ tagName: 'input' }), true)
  assert.equal(isEditableTarget({ tagName: 'DIV', isContentEditable: true }), true)
  assert.equal(isEditableTarget({ tagName: 'BUTTON' }), false)
  assert.equal(shouldHandleShortcut(false, false), true)
  assert.equal(shouldHandleShortcut(true, false), false, '编辑区且未显式允许 -> 不抢键')
  assert.equal(shouldHandleShortcut(true, true), true)
})

test('formatShortcut 规范化展示，defaultCombos 覆盖全部约定组合', () => {
  assert.equal(formatShortcut('ctrl+shift+e'), 'Ctrl+Shift+E')
  assert.equal(formatShortcut('ctrl+,'), 'Ctrl+,')
  assert.equal(formatShortcut('garbage'), 'garbage')
  const combos = defaultCombos()
  assert.equal(combos.tab1, 'Ctrl+1')
  assert.equal(combos.tab9, 'Ctrl+9')
  assert.equal(combos.palette, 'Ctrl+K')
  assert.equal(combos.settings, 'Ctrl+,')
  assert.equal(combos.exportMd, 'Ctrl+Shift+E')
  assert.equal(Object.keys(combos).length, 14)
})
