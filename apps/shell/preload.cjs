/**
 * preload（CommonJS）：sandbox 下的 preload 必须是 CJS，不能用 ESM import。
 * 只通过 contextBridge 暴露具体方法，绝不把 ipcRenderer 本体挂到 window。
 */
const { contextBridge, ipcRenderer } = require('electron')

const shellApi = {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: patch => ipcRenderer.invoke('config:set', patch),
  exportDiagnostics: () => ipcRenderer.invoke('diagnostics:export'),
  setCredential: (name, plain) => ipcRenderer.invoke('credentials:set', name, plain),
  getCredential: name => ipcRenderer.invoke('credentials:get', name),
  onboardingState: () => ipcRenderer.invoke('onboarding:state'),
  onboardingAnswer: (step, value) => ipcRenderer.invoke('onboarding:answer', step, value),
  onboardingBack: () => ipcRenderer.invoke('onboarding:back'),
  onboardingFinish: () => ipcRenderer.invoke('onboarding:finish'),
  reportTickets: tickets => ipcRenderer.invoke('tickets:report', tickets),
  saveWorkspaceFile: (relativePath, content) => ipcRenderer.invoke('workspace:save', relativePath, content),
  git: (op, payload) => ipcRenderer.invoke('workspace:git', op, payload),
  appInfo: () => ipcRenderer.invoke('app:info'),
  telemetryExport: () => ipcRenderer.invoke('telemetry:export'),
  telemetryClear: () => ipcRenderer.invoke('telemetry:clear'),
  setTelemetryEnabled: enabled => ipcRenderer.invoke('telemetry:set-enabled', enabled),
  onOpenFiles: handler => {
    const listener = (_event, files) => handler(files)
    ipcRenderer.on('shell:open-files', listener)
    return () => ipcRenderer.removeListener('shell:open-files', listener)
  },
  onDeepLink: handler => {
    const listener = (_event, links) => handler(links)
    ipcRenderer.on('shell:deep-links', listener)
    return () => ipcRenderer.removeListener('shell:deep-links', listener)
  },
}

contextBridge.exposeInMainWorld('shellApi', shellApi)
