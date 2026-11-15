/**
 * 界面多语言（C5-12）：中 / 英，跟随系统 locale，可在设置里覆盖。
 * 壳层文案（托盘 / 菜单 / 通知 / 向导 / 关于 / 设置）由此提供，纯模块零 DOM。
 * 渲染层 apps/desktop 自带一份词表，两者各自服务所在进程，互不 import。
 */
export const SUPPORTED_LOCALES = ['zh-CN', 'en-US'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]

/** 词表：zh-CN 与 en-US 键集合一致；刻意留一个仅 en 的键用于验证回退。 */
const MESSAGES: Record<Locale, Record<string, string>> = {
  'zh-CN': {
    'app.name': 'dsh-ghost',
    'tray.show': '显示主窗口',
    'tray.quit': '退出',
    'tray.pending': '有票待人处理',
    'tray.done': '执行完成',
    'tray.approval': '需要审批',
    'menu.file': '文件',
    'menu.edit': '编辑',
    'menu.view': '视图',
    'menu.help': '帮助',
    'menu.about': '关于',
    'menu.licenses': '第三方许可',
    'menu.settings': '设置',
    'menu.reload': '重新加载',
    'menu.diagnostics': '导出诊断包',
    'menu.openFile': '打开文件',
    'onboarding.title': '首次启动向导',
    'onboarding.welcome': '欢迎使用 dsh-ghost',
    'onboarding.modelSource': '模型来源',
    'onboarding.workspace': '工作目录',
    'onboarding.approval': '审批档位',
    'onboarding.infoSources': '信息源开关',
    'onboarding.next': '下一步',
    'onboarding.back': '上一步',
    'onboarding.finish': '完成',
    'notice.pending': '{count} 张票待人处理',
    'notice.done': '执行完成',
    'notice.approval': '需要人工审批',
    'settings.locale': '语言',
    'settings.startup': '开机启动',
    'settings.update': '更新通道',
    'settings.telemetry': '匿名遥测',
    'common.ok': '确定',
    'common.cancel': '取消',
    'about.version': '版本 {version}',
    'about.disclaimer': 'Built on DeepSeek Harness. Not affiliated with or endorsed by DeepSeek.',
  },
  'en-US': {
    'app.name': 'dsh-ghost',
    'tray.show': 'Show main window',
    'tray.quit': 'Quit',
    'tray.pending': 'Tickets need attention',
    'tray.done': 'Execution finished',
    'tray.approval': 'Approval required',
    'menu.file': 'File',
    'menu.edit': 'Edit',
    'menu.view': 'View',
    'menu.help': 'Help',
    'menu.about': 'About',
    'menu.licenses': 'Third-party licenses',
    'menu.settings': 'Settings',
    'menu.reload': 'Reload',
    'menu.diagnostics': 'Export diagnostics',
    'menu.openFile': 'Open file',
    'onboarding.title': 'First-run setup',
    'onboarding.welcome': 'Welcome to dsh-ghost',
    'onboarding.modelSource': 'Model source',
    'onboarding.workspace': 'Workspace directory',
    'onboarding.approval': 'Approval preset',
    'onboarding.infoSources': 'Information sources',
    'onboarding.next': 'Next',
    'onboarding.back': 'Back',
    'onboarding.finish': 'Finish',
    'notice.pending': '{count} tickets need attention',
    'notice.done': 'Execution finished',
    'notice.approval': 'Approval required',
    'settings.locale': 'Language',
    'settings.startup': 'Launch on startup',
    'settings.update': 'Update channel',
    'settings.telemetry': 'Anonymous telemetry',
    'common.ok': 'OK',
    'common.cancel': 'Cancel',
    'about.version': 'Version {version}',
    'about.disclaimer': 'Built on DeepSeek Harness. Not affiliated with or endorsed by DeepSeek.',
    'only.en': 'English only entry',
  },
}

/**
 * 决定界面语言：override 只认 system / zh-CN / en-US，非法值按 system 处理；
 * system 模式按系统 locale 前缀判断（zh* -> zh-CN，其余 -> en-US）。
 */
export function resolveLocale(systemLocale: string, override?: string): Locale {
  if (override === 'zh-CN' || override === 'en-US') return override
  const lower = systemLocale.toLowerCase()
  return lower.startsWith('zh') ? 'zh-CN' : 'en-US'
}

export type Translator = (key: string, vars?: Record<string, string | number>) => string

/**
 * 回退顺序：当前语言 -> en-US -> key 本身。
 * 插值用 {name} 占位，缺失变量不报错（保持原占位符）。
 */
export function translate(key: string, locale: Locale, vars?: Record<string, string | number>): string {
  const primary: string | undefined = MESSAGES[locale][key]
  const fallback: string | undefined = locale === 'en-US' ? undefined : MESSAGES['en-US'][key]
  let text = primary ?? fallback ?? key
  if (vars !== undefined) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.split(`{${name}}`).join(String(value))
    }
  }
  return text
}

export function createTranslator(locale: Locale): Translator {
  return (key, vars) => translate(key, locale, vars)
}
