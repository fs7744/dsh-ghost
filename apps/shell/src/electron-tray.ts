/**
 * 托盘与通知适配（C5-04）：票待人处理 / 执行完成 / 需审批，点击托盘恢复窗口。
 */
import { Tray, Menu, Notification, nativeImage } from 'electron'
import type { Translator } from './i18n.ts'

export type NoticeKind = 'pending' | 'done' | 'approval'

export interface TrayApi {
  setTooltip(text: string): void
  notify(kind: NoticeKind, count?: number): void
  destroy(): void
}

export interface TrayDeps {
  iconPath: string
  translate: Translator
  onShow(): void
  onQuit(): void
}

export function createTray(deps: TrayDeps): TrayApi {
  const tray = new Tray(nativeImage.createFromPath(deps.iconPath))
  tray.setToolTip(deps.translate('app.name'))
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: deps.translate('tray.show'), click: () => deps.onShow() },
    { type: 'separator' },
    { label: deps.translate('tray.quit'), click: () => deps.onQuit() },
  ]))
  tray.on('click', () => deps.onShow())

  return {
    setTooltip: text => tray.setToolTip(text),
    notify: (kind, count) => {
      if (!Notification.isSupported()) return
      const key = kind === 'pending' ? 'notice.pending' : kind === 'done' ? 'notice.done' : 'notice.approval'
      const body = deps.translate(key, count === undefined ? {} : { count })
      const notice = new Notification({ title: deps.translate('app.name'), body })
      notice.on('click', () => deps.onShow())
      notice.show()
    },
    destroy: () => tray.destroy(),
  }
}
