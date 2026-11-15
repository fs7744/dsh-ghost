/**
 * 亮 / 暗主题（C8-20）。
 *
 * 暗色是 :root 默认变量；body.theme-light 在 style.css 里做浅底深字覆盖。
 * 归一化与切换计算是纯函数（零 DOM），localStorage 与 body class 的读写放在函数内
 * 并做环境判断，模块顶层不碰浏览器 API。
 */

export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'dsh-ghost.theme'

/** 任意值归一化：只有显式 'light' 才是浅色，其它一律暗色（暗色优先）。 */
export function normalizeTheme(value: unknown): Theme {
  return value === 'light' ? 'light' : 'dark'
}

export function toggleThemeValue(current: Theme): Theme {
  return current === 'dark' ? 'light' : 'dark'
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
  document.body.classList.toggle('theme-light', theme === 'light')
}

export function getTheme(): Theme {
  return current
}

export function applyTheme(theme: Theme): void {
  current = theme
  applyBodyClass(theme)
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
