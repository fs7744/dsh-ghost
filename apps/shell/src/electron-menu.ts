/**
 * 原生菜单与快捷键适配（C5-07）。
 *
 * 主进程只管系统级快捷键（undo/redo/cut/copy/paste/selectAll 由 role 提供）；
 * 刻意不注册 Ctrl+1..9 —— 那些属于渲染层 apps/desktop/src/shortcuts.ts，
 * 避免两套快捷键互相抢占。
 */
import { Menu } from 'electron'
import type { Translator } from './i18n.ts'

export interface MenuDeps {
  translate: Translator
  onOpenFile(): void
  onDiagnostics(): void
  onSettings(): void
  onAbout(): void
  onLicenses(): void
  onReload(): void
}

export function buildApplicationMenu(deps: MenuDeps): void {
  const template: Parameters<typeof Menu.buildFromTemplate>[0] = [
    {
      label: deps.translate('menu.file'),
      submenu: [
        { label: deps.translate('menu.openFile'), click: () => deps.onOpenFile() },
        { label: deps.translate('menu.diagnostics'), click: () => deps.onDiagnostics() },
        { type: 'separator' },
        { label: deps.translate('tray.quit'), role: 'quit' },
      ],
    },
    {
      label: deps.translate('menu.edit'),
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: deps.translate('menu.view'),
      submenu: [
        { label: deps.translate('menu.reload'), click: () => deps.onReload() },
        { label: deps.translate('menu.settings'), click: () => deps.onSettings() },
      ],
    },
    {
      label: deps.translate('menu.help'),
      submenu: [
        { label: deps.translate('menu.about'), click: () => deps.onAbout() },
        { label: deps.translate('menu.licenses'), click: () => deps.onLicenses() },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
