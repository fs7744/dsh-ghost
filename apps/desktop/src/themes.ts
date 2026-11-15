/**
 * 皮肤预设（内置主题包）。
 *
 * 预设 = 一段 CSS。设置页点「应用」即注入；也可以「复制为可编辑的自定义皮肤」，
 * 落到 `.ghost/ui/custom.css` 后自行改造。
 *
 * 注入顺序：基础样式 → 预设 → 用户自定义（后者优先级最高，符合「用户最后决定」）。
 */
import { cyberpunkCss } from './themes/cyberpunk.ts'

export interface SkinPreset {
  /** 预设 id。 */
  id: string
  /** 界面上的名字。 */
  label: string
  /** 一句话说明。 */
  description: string
  /** CSS 正文；空串表示「默认（不注入）」。 */
  css: string
}

/** 内置预设。默认项的 css 为空——不注入任何东西，用基础样式。 */
export const SKIN_PRESETS: readonly SkinPreset[] = [
  { id: 'default', label: '默认', description: '跟随内置的暗色/浅色变量', css: '' },
  { id: 'cyberpunk', label: '赛博朋克', description: '霓虹青 × 酸性绿 × 深渊底', css: cyberpunkCss },
]

const STORAGE_KEY = 'dsh-ghost.skin'
const STYLE_ID = 'skin-preset'

/** 按 id 取预设。 */
export function findPreset(id: string): SkinPreset | undefined {
  return SKIN_PRESETS.find(preset => preset.id === id)
}

/** 读上次选的预设 id（没有就默认）。 */
export function currentPresetId(): string {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    return raw !== null && raw !== undefined && findPreset(raw) !== undefined ? raw : 'default'
  } catch {
    return 'default'
  }
}

/**
 * 应用预设：把 CSS 注入成一个 <style>；默认预设则移除它。
 * @returns 是否真的应用了（默认预设返回 false）
 */
export function applyPreset(id: string): boolean {
  const preset = findPreset(id)
  if (preset === undefined) return false
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, preset.id)
  } catch { /* 存不了也不影响本次生效 */ }
  if (typeof document === 'undefined') return false
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (preset.css === '') {
    style?.remove()
    return false
  }
  if (style === null) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.appendChild(style)
  }
  style.textContent = preset.css
  return true
}

/** 当前生效的预设 id（读设置里的值，不看 DOM）。 */
export function activePresetId(): string {
  return currentPresetId()
}
