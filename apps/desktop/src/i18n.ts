/**
 * 界面文案与中英 i18n（C8-21 / C8-26）。
 *
 * 词表集中在本文件，中文优先：英文词表缺失的键先回退到中文，再回退到键名本身，
 * 界面永远不会因为漏翻而显示空白或 undefined。
 * 纯逻辑（translate / interpolate / isLocale）零 DOM，可在 Node 里单测；
 * locale 状态、localStorage 与 document 访问全部放在函数内并做环境判断，模块顶层
 * 不触碰任何浏览器 API，因此验收脚本直接 import 也不会报错。
 *
 * 登记脚本：test:panels / verify:panels（集成时加入根 package.json）。
 */

export type Locale = 'zh' | 'en'

/** 稳定语义键 -> 文案。新增文案只改这里，不要在渲染代码里写死句子。 */
export const MESSAGES: Record<Locale, Record<string, string>> = {
  zh: {
    'tab.chat': '对话',
    'tab.flow': '剧本',
    'tab.memory': '记忆',
    'tab.workspace': '工作区',
    'tab.terminal': '终端',
    'tab.jobs': '任务',
    'tab.plan': '计划',
    'tab.goals': '目标',
    'tab.collab': '协作',
    'tab.skills': '技能',
    'tab.settings': '设置',
    'tab.plugins': '插件',
    'tab.superagent': 'Superagent',
    'tab.stats': '统计',
    'tab.models': '模型',
    'common.refresh': '刷新',
    'common.retry': '重试',
    'common.loading': '加载中...',
    'common.empty': '这里还没有内容',
    'common.unavailable': '该能力未启用',
    'common.unavailable.detail': '宿主没有提供这个端点，或当前会话不可用。',
    'common.enabled': '已启用',
    'common.disabled': '已停用',
    'common.on': '开',
    'common.off': '关',
    'common.export': '导出',
    'common.theme': '主题',
    'common.language': '语言',
    'common.count': '{count} 项',
    'common.error': '出错了',
    'common.open': '打开',
    'common.copyPath': '复制路径',
    'common.preview': '预览',
    'common.approve': '批准',
    'common.deny': '拒绝',
    'common.always': '总是允许',
    'common.close': '关闭',
    'common.ask': '待人处理',
    'common.name': '名称',
    'common.state': '状态',
    'ctx.title': '上下文占用',
    'ctx.compaction': '压缩点',
    'ctx.none': '还没有压缩点',
    'ctx.original': '展开被压掉的原文',
    'ctx.used': '{used} / {total}',
    'feedback.like': '赞',
    'feedback.dislike': '踩',
    'feedback.total': '{total} 条反馈 · 赞 {positive} · 踩 {negative}',
    'stats.turns': '{turns} 回合',
    'stats.tokens': '{input} 输入 / {output} 输出 token',
    'stats.duration': '耗时 {ms}',
    'workspace.files': '文件',
    'workspace.tree': '文件树',
    'workspace.preview': '预览',
    'workspace.document': '文档预览',
    'workspace.deliverable': '交付物',
    'workspace.drop': '把文件拖到这里上传',
    'attach.upload': '附件',
    'attach.directory': '选择目录',
    'attach.picked': '已选：{path}',
    'runtime.running': '运行中',
    'runtime.idle': '空闲',
    'runtime.done': '已完成',
    'runtime.failed': '失败',
    'runtime.kill': '终止',
    'runtime.create': '新建',
    'admin.section': '分区',
    'admin.providers': '模型提供方',
    'admin.mcp': 'MCP 服务',
    'admin.bundles': '插件包',
    'admin.plugins': '插件',
    'admin.market': '市场',
    'admin.settings': '用户设置',
    'admin.install': '安装',
    'admin.toggle': '启用/停用',
    'superagent.needsPerson': '待人处理',
    'superagent.workItems': '工作项',
    'superagent.strategy': '策略',
    'superagent.execution': '执行状态',
    'approval.title': '需要你批准',
    'approval.hint': '这个操作需要人工确认。',
  },
  en: {
    'tab.chat': 'Chat',
    'tab.flow': 'Playbook',
    'tab.memory': 'Memory',
    'tab.workspace': 'Workspace',
    'tab.terminal': 'Terminal',
    'tab.jobs': 'Jobs',
    'tab.plan': 'Plan',
    'tab.goals': 'Goals',
    'tab.collab': 'Collab',
    'tab.skills': 'Skills',
    'tab.settings': 'Settings',
    'tab.plugins': 'Plugins',
    'tab.superagent': 'Superagent',
    'tab.stats': 'Stats',
    'tab.models': 'Models',
    'common.refresh': 'Refresh',
    'common.retry': 'Retry',
    'common.loading': 'Loading...',
    'common.empty': 'Nothing here yet',
    'common.unavailable': 'Capability not enabled',
    'common.unavailable.detail': 'The host did not expose this endpoint, or the session is unavailable.',
    'common.enabled': 'Enabled',
    'common.disabled': 'Disabled',
    'common.on': 'On',
    'common.off': 'Off',
    'common.export': 'Export',
    'common.theme': 'Theme',
    'common.language': 'Language',
    'common.count': '{count} items',
    'common.error': 'Error',
    'common.open': 'Open',
    'common.copyPath': 'Copy path',
    'common.preview': 'Preview',
    'common.approve': 'Approve',
    'common.deny': 'Deny',
    'common.always': 'Always allow',
    'common.close': 'Close',
    'common.ask': 'Needs you',
    'common.name': 'Name',
    'common.state': 'State',
    'ctx.title': 'Context usage',
    'ctx.compaction': 'Compaction points',
    'ctx.none': 'No compaction points yet',
    'ctx.original': 'Expand dropped original',
    'ctx.used': '{used} / {total}',
    'feedback.like': 'Like',
    'feedback.dislike': 'Dislike',
    'feedback.total': '{total} feedback · {positive} up · {negative} down',
    'stats.turns': '{turns} turns',
    'stats.tokens': '{input} in / {output} out tokens',
    'stats.duration': '{ms} elapsed',
    'workspace.files': 'Files',
    'workspace.tree': 'File tree',
    'workspace.preview': 'Preview',
    'workspace.document': 'Document preview',
    'workspace.deliverable': 'Deliverable',
    'workspace.drop': 'Drop files here to upload',
    'attach.upload': 'Attach',
    'attach.directory': 'Pick folder',
    'attach.picked': 'Picked: {path}',
    'runtime.running': 'Running',
    'runtime.idle': 'Idle',
    'runtime.done': 'Done',
    'runtime.failed': 'Failed',
    'runtime.kill': 'Kill',
    'runtime.create': 'Create',
    'admin.section': 'Section',
    'admin.providers': 'Model providers',
    'admin.mcp': 'MCP servers',
    'admin.bundles': 'Bundles',
    'admin.plugins': 'Plugins',
    'admin.market': 'Market',
    'admin.settings': 'User settings',
    'admin.install': 'Install',
    'admin.toggle': 'Enable/Disable',
    'superagent.needsPerson': 'Needs you',
    'superagent.workItems': 'Work items',
    'superagent.strategy': 'Strategy',
    'superagent.execution': 'Execution',
    'approval.title': 'Approval required',
    'approval.hint': 'This action needs your confirmation.',
  },
}

/** 判断任意值是否为受支持的 locale。 */
export function isLocale(value: unknown): value is Locale {
  return value === 'zh' || value === 'en'
}

/**
 * 缺词回退：当前语言 -> 中文 -> 键名。
 * @param dict - 可注入词表，便于单测覆盖缺词场景。
 */
export function translate(
  locale: Locale,
  key: string,
  dict: Record<Locale, Record<string, string>> = MESSAGES,
): string {
  const table = dict[locale] ?? {}
  const fallback = dict.zh ?? {}
  return table[key] ?? fallback[key] ?? key
}

/** 简单插值：把 {name} 换成 params.name；缺参保留占位符原样。 */
export function interpolate(template: string, params: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (whole: string, name: string): string => {
    const value = params[name]
    return value === undefined ? whole : String(value)
  })
}

const STORAGE_KEY = 'dsh-ghost.locale'
let current: Locale = 'zh'
const listeners = new Set<() => void>()

/** 读取 localStorage；Node 或隐私模式下安全返回 undefined。 */
function storage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

function applyHtmlLang(locale: Locale): void {
  if (typeof document === 'undefined' || document.documentElement === null) return
  document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
}

export function getLocale(): Locale {
  return current
}

/** 返回绑定到当前 locale 的翻译函数；切换语言后同一个函数立即返回新文案。 */
export function makeTranslator(): (key: string) => string {
  return (key: string): string => translate(current, key)
}

export function setLocale(next: Locale): void {
  if (!isLocale(next) || next === current) return
  current = next
  try {
    storage()?.setItem(STORAGE_KEY, next)
  } catch {
    // 存不下就算了，不影响本次会话
  }
  applyHtmlLang(next)
  for (const listener of listeners) listener()
}

export function toggleLocale(): Locale {
  const next: Locale = current === 'zh' ? 'en' : 'zh'
  setLocale(next)
  return next
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 从持久化恢复 locale（只改状态，不触发订阅：此时还没人订阅）。 */
export function initLocale(): void {
  let saved: unknown
  try {
    saved = storage()?.getItem(STORAGE_KEY) ?? undefined
  } catch {
    saved = undefined
  }
  if (isLocale(saved)) current = saved
  applyHtmlLang(current)
}
