/**
 * 集中式快捷键（C8-19）。
 *
 * 解析 / 匹配 / 编辑区判定都是纯函数，方便单测；注册器只负责在 document 上
 * 挂一个 keydown 监听并分发动作。命令面板接管的是「无修饰键」的 ↑↓ / Enter /
 * Tab / Esc（在 textarea 上），这里的绑定全部带 Ctrl，且只在命中注册组合时才
 * preventDefault，未命中一律放行，因此不会与命令面板的输入接管冲突。
 */

/** 解析后的组合键。 */
export interface ShortcutParts {
  ctrl: boolean
  shift: boolean
  alt: boolean
  meta: boolean
  /** 小写主键，如 'e' / '1' / ',' / 'k'。 */
  key: string
}

/** 一次按键的状态；与 KeyboardEvent 结构兼容。 */
export interface KeyState {
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
  key: string
}

/** 事件目标的最小描述，避免纯函数依赖真实 DOM 元素。 */
export interface TargetShape {
  tagName?: string
  isContentEditable?: boolean
}

/** 解析 'Ctrl+Shift+E' 形式的组合；无法解析返回 null。 */
export function parseShortcut(combo: string): ShortcutParts | null {
  if (typeof combo !== 'string' || combo.trim() === '') return null
  const tokens = combo.split('+').map(token => token.trim()).filter(token => token !== '')
  if (tokens.length === 0) return null
  let ctrl = false
  let shift = false
  let alt = false
  let meta = false
  let key = ''
  for (const token of tokens) {
    const lower = token.toLowerCase()
    if (lower === 'ctrl' || lower === 'control') ctrl = true
    else if (lower === 'shift') shift = true
    else if (lower === 'alt' || lower === 'option') alt = true
    else if (lower === 'meta' || lower === 'cmd' || lower === 'command' || lower === 'super') meta = true
    else key = lower
  }
  if (key === '') return null
  return { ctrl, shift, alt, meta, key }
}

/** 组合键与一次按键是否匹配（大小写不敏感）。 */
export function matchShortcut(combo: string, state: KeyState): boolean {
  const parts = parseShortcut(combo)
  if (parts === null) return false
  return parts.ctrl === state.ctrlKey
    && parts.shift === state.shiftKey
    && parts.alt === state.altKey
    && parts.meta === state.metaKey
    && parts.key === state.key.toLowerCase()
}

/** 焦点是否落在可编辑元素上。 */
export function isEditableTarget(target: TargetShape | null): boolean {
  if (target === null) return false
  if (target.isContentEditable === true) return true
  const tag = (target.tagName ?? '').toUpperCase()
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/**
 * 是否处理该快捷键：非编辑区一律处理；编辑区只在绑定显式允许时才处理。
 * 数字切标签这类绑定不给 allowInEditable，避免抢输入法。
 */
export function shouldHandleShortcut(editable: boolean, allowInEditable: boolean): boolean {
  return !editable || allowInEditable
}

/** 规范化展示，如 'ctrl+shift+e' -> 'Ctrl+Shift+E'。 */
export function formatShortcut(combo: string): string {
  const parts = parseShortcut(combo)
  if (parts === null) return combo
  const segments: string[] = []
  if (parts.ctrl) segments.push('Ctrl')
  if (parts.shift) segments.push('Shift')
  if (parts.alt) segments.push('Alt')
  if (parts.meta) segments.push('Win')
  segments.push(parts.key.length === 1 ? parts.key.toUpperCase() : parts.key)
  return segments.join('+')
}

export interface ShortcutBinding {
  combo: string
  action: () => void
  /** 允许在输入框内触发（默认 false）。 */
  allowInEditable?: boolean
}

/** 在 document 上注册一组快捷键，返回注销函数。 */
export function registerShortcuts(bindings: readonly ShortcutBinding[]): () => void {
  const handler = (event: KeyboardEvent): void => {
    const raw = event.target as HTMLElement | null
    const editable = isEditableTarget(raw === null ? null : {
      tagName: raw.tagName,
      isContentEditable: raw.isContentEditable,
    })
    for (const binding of bindings) {
      if (!shouldHandleShortcut(editable, binding.allowInEditable === true)) continue
      if (!matchShortcut(binding.combo, event)) continue
      event.preventDefault()
      binding.action()
      return
    }
  }
  document.addEventListener('keydown', handler)
  return () => document.removeEventListener('keydown', handler)
}

/** 默认绑定表：Ctrl+1..9 切标签、Ctrl+K 命令面板、Ctrl+, 设置、Ctrl+Shift+E 导出等。 */
export function defaultCombos(): Record<string, string> {
  return {
    tab1: 'Ctrl+1',
    tab2: 'Ctrl+2',
    tab3: 'Ctrl+3',
    tab4: 'Ctrl+4',
    tab5: 'Ctrl+5',
    tab6: 'Ctrl+6',
    tab7: 'Ctrl+7',
    tab8: 'Ctrl+8',
    tab9: 'Ctrl+9',
    palette: 'Ctrl+K',
    settings: 'Ctrl+,',
    exportMd: 'Ctrl+Shift+E',
    theme: 'Ctrl+Shift+T',
    language: 'Ctrl+Shift+L',
  }
}
