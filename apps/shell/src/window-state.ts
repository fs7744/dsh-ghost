/**
 * 窗口状态持久化（C5-01）：校验/修复窗口 bounds。
 * 尺寸过小、字段非法、或窗口中心落在所有显示器之外（拔掉外接屏）时回退默认，
 * 避免用户再也看不到窗口。纯模块，显示器信息由适配层注入。
 */
import type { WindowBounds } from './config.ts'

export interface DisplayBounds {
  x: number
  y: number
  width: number
  height: number
}

const MIN_WIDTH = 480
const MIN_HEIGHT = 320

function isBoundsLike(value: unknown): value is WindowBounds {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    const n = v[key]
    if (typeof n !== 'number' || !Number.isFinite(n)) return false
  }
  return true
}

export function sanitizeBounds(
  stored: unknown,
  defaults: WindowBounds,
  displays: readonly DisplayBounds[],
): WindowBounds {
  if (!isBoundsLike(stored)) return { ...defaults }
  const b = stored
  if (b.width < MIN_WIDTH || b.height < MIN_HEIGHT || b.width > 20000 || b.height > 20000) {
    return { ...defaults }
  }
  const cx = b.x + b.width / 2
  const cy = b.y + b.height / 2
  const visible = displays.length === 0 || displays.some(d =>
    cx >= d.x && cx <= d.x + d.width && cy >= d.y && cy <= d.y + d.height,
  )
  return visible ? { ...b } : { ...defaults }
}
