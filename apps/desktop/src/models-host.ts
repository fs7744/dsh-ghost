/**
 * 模型配置的本机 host：fetch('/api/models/*') 走同源，连不上后端时降级到
 * 内置 DEMO_STATE 并标 demo。独立模型页与设置页「模型」分类共用这一份逻辑。
 */
import type { ModelsHost, ProbeView, DiscoverSpec, DiscoverResult } from './models-panel.ts'
import { DEMO_STATE, buildLocalPresetView, type ModelsState } from './models-view.ts'

const API = '/api/models'

/** 桌面壳 preload 暴露的最小 API；浏览器 demo 模式下不存在。 */
interface ShellCredentialApi {
  setCredential(name: string, plain: string): Promise<{ stored: boolean; reason?: string }>
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json' },
  })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return (await response.json()) as T
}

/** 建一个模型配置 host。noticeTarget 指定提示文案写到哪个元素（设置页与独立页不同）。 */
export function createModelsHost(noticeTarget?: HTMLElement): ModelsHost {
  const shellApi = (window as unknown as { shellApi?: ShellCredentialApi }).shellApi
  let demoState: ModelsState = { ...DEMO_STATE }
  let offline = false
  return {
    async load(): Promise<ModelsState> {
      try {
        const state = await api<ModelsState>('/state')
        offline = false
        return { ...state, demo: false }
      } catch {
        offline = true
        return { ...demoState, demo: true }
      }
    },
    async save(state: ModelsState): Promise<void> {
      demoState = state
      if (offline) return
      await api<void>('/state', { method: 'POST', body: JSON.stringify(state) }).catch(() => {})
    },
    async probe(providerId: string): Promise<ProbeView> {
      if (offline) return { ok: false, label: 'demo 模式无后端' }
      try {
        return await api<ProbeView>('/probe', { method: 'POST', body: JSON.stringify({ providerId }) })
      } catch (error) {
        return { ok: false, label: '自测失败', detail: String(error).slice(0, 60) }
      }
    },
    async discover(spec: DiscoverSpec): Promise<DiscoverResult> {
      if (offline) return { ok: false, label: 'demo 模式无后端' }
      try {
        return await api<DiscoverResult>('/discover', { method: 'POST', body: JSON.stringify(spec) })
      } catch (error) {
        return { ok: false, label: '获取失败', detail: String(error).slice(0, 60) }
      }
    },
    async setCredential(name: string, plain: string) {
      if (shellApi?.setCredential === undefined) {
        return { stored: false, reason: 'no-safe-storage' }
      }
      return await shellApi.setCredential(name, plain)
    },
    async applyPreset(preset: string): Promise<ModelsState> {
      if (!offline) {
        try {
          return await api<ModelsState>('/preset', { method: 'POST', body: JSON.stringify({ preset }) })
        } catch {
          // 后端不可用：降级到本地生成，保持 demo 可用。
        }
      }
      const view = buildLocalPresetView(preset === 'vllm' ? 'vllm' : 'ollama')
      const next: ModelsState = {
        ...demoState,
        providers: [...demoState.providers.filter(item => item.id !== view.id), view],
      }
      demoState = next
      return { ...next, demo: true }
    },
    notice(text: string): void {
      const target = noticeTarget ?? document.getElementById('models-notice')
      if (target !== null && target !== undefined) target.textContent = text
    },
  }
}
