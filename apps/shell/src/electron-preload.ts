/**
 * preload：用 contextBridge 暴露最小 API，绝不暴露 ipcRenderer 本体。
 * 渲染层只能通过 window.shellApi 的具体方法访问主进程能力；ipcRenderer
 * 仅在本文件内部以方法调用形式出现，从不作为对象值挂到 window。
 */
import { contextBridge, ipcRenderer } from 'electron'

const shellApi = {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch: unknown) => ipcRenderer.invoke('config:set', patch),
  exportDiagnostics: () => ipcRenderer.invoke('diagnostics:export'),
  setCredential: (name: string, plain: string) => ipcRenderer.invoke('credentials:set', name, plain),
  getCredential: (name: string) => ipcRenderer.invoke('credentials:get', name),
  onboardingState: () => ipcRenderer.invoke('onboarding:state'),
  onboardingAnswer: (step: string, value: unknown) => ipcRenderer.invoke('onboarding:answer', step, value),
  onboardingBack: () => ipcRenderer.invoke('onboarding:back'),
  onboardingFinish: () => ipcRenderer.invoke('onboarding:finish'),
  appInfo: () => ipcRenderer.invoke('app:info'),
  telemetryExport: () => ipcRenderer.invoke('telemetry:export'),
  telemetryClear: () => ipcRenderer.invoke('telemetry:clear'),
  setTelemetryEnabled: (enabled: boolean) => ipcRenderer.invoke('telemetry:set-enabled', enabled),
  onOpenFiles: (handler: (files: string[]) => void) => {
    const listener = (_event: unknown, files: string[]) => handler(files)
    ipcRenderer.on('shell:open-files', listener)
    return () => ipcRenderer.removeListener('shell:open-files', listener)
  },
  onDeepLink: (handler: (links: string[]) => void) => {
    const listener = (_event: unknown, links: string[]) => handler(links)
    ipcRenderer.on('shell:deep-links', listener)
    return () => ipcRenderer.removeListener('shell:deep-links', listener)
  },
}

contextBridge.exposeInMainWorld('shellApi', shellApi)
