/**
 * 亮 / 暗主题（C8-20）。
 *
 * 暗色是 :root 默认变量；body.theme-light 在 style.css 里做浅底深字覆盖。
 * 归一化与切换计算是纯函数（零 DOM），localStorage 与 body class 的读写放在函数内
 * 并做环境判断，模块顶层不碰浏览器 API。
 */

export type Theme = 'dark' | 'light' | 'system'

const STORAGE_KEY = 'dsh-ghost.theme'

/** 任意值归一化：'light' / 'system' 认，其它一律暗色（暗色优先）。 */
export function normalizeTheme(value: unknown): Theme {
  if (value === 'light') return 'light'
  if (value === 'system') return 'system'
  return 'dark'
}

/** 按钮循环：暗色 → 浅色 → 跟随系统 → 暗色。 */
export function toggleThemeValue(current: Theme): Theme {
  if (current === 'dark') return 'light'
  if (current === 'light') return 'system'
  return 'dark'
}

/** 跟随系统时，解析成实际用的亮/暗。 */
export function resolveTheme(theme: Theme): 'dark' | 'light' {
  if (theme !== 'system') return theme
  try {
    return globalThis.matchMedia?.('(prefers-color-scheme: light)')?.matches === true ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

let current: Theme = 'dark'
const listeners = new Set<(theme: Theme) => void>()

function storage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

function applyBodyClass(theme: Theme): void {
  if (typeof document === 'undefined' || document.body === null) return
  document.body.classList.toggle('theme-light', resolveTheme(theme) === 'light')
}

export function getTheme(): Theme {
  return current
}

export function applyTheme(theme: Theme): void {
  current = theme
  applyBodyClass(theme)
  // 跟随系统：系统切换时界面也跟着切。
  if (theme === 'system') {
    try {
      const query = globalThis.matchMedia?.('(prefers-color-scheme: light)')
      query?.addEventListener?.('change', () => applyBodyClass('system'))
    } catch { /* 没有 matchMedia 就算了 */ }
  }
  try {
    storage()?.setItem(STORAGE_KEY, theme)
  } catch {
    // 忽略持久化失败
  }
  for (const listener of listeners) listener(theme)
}

export function toggleTheme(): Theme {
  const next = toggleThemeValue(current)
  applyTheme(next)
  return next
}

export function subscribeTheme(listener: (theme: Theme) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 从持久化恢复主题并立即套用到 body；不触发订阅（此时还没人订阅）。 */
export function initTheme(): void {
  let saved: unknown
  try {
    saved = storage()?.getItem(STORAGE_KEY) ?? undefined
  } catch {
    saved = undefined
  }
  current = normalizeTheme(saved)
  applyBodyClass(current)
}
