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
    'tab.changes': '变更',
    'tab.capabilities': '宿主能力',
    'capabilities.presets': 'Agent 预设',
    'capabilities.computerUse': '电脑操控（Computer Use）',
    'capabilities.hostPlugins': '可开启的宿主插件',
    'capabilities.automation': '自动化（浏览器 / 电脑操控）',
    'capabilities.browserAutomation': '浏览器自动化',
    'capabilities.computerControl': 'Windows 电脑操控',
    'capabilities.available': '可用',
    'capabilities.noBrowser': '本机没找到 Chrome / Edge',
    'capabilities.notWindows': '仅 Windows 支持',
    'capabilities.automationToggled': '开关已切换（立即生效）',
    'capabilities.ledger': '能力台账',
    'capabilities.default': '默认',
    'capabilities.use': '使用',
    'capabilities.enable': '开启',
    'capabilities.on': '已开启',
    'capabilities.selected': '已切换预设',
    'capabilities.needsRestart': '已保存，重启宿主后生效',
    'capabilities.cua.ready': '可用',
    'capabilities.cua.unavailable': '宿主 CUA 未装载（官方面向 macOS）；可在这里开启后重启宿主。',
    'capabilities.state.wired': '已接入',
    'capabilities.state.host-default': '宿主默认',
    'capabilities.state.toggleable': '可开启',
    'capabilities.state.not-wired': '未接入',
    'changes.clean': '工作区没有未提交的改动',
    'changes.conflict': '冲突',
    'changes.needShell': '差异与合并需要桌面端（浏览器里没有 git 通道）。',
    'changes.resolve': '解决冲突',
    'changes.ours': '用我方',
    'changes.theirs': '用对方',
    'changes.resolved': '冲突已解决',
    'workspace.conflict': '这个文件里有 git 冲突标记（<<<<<<< / ======= / >>>>>>>），可在「变更」页处理。',
    'workspace.truncated': '文件太长，只显示前面部分（共 {lines} 行）。',
    'tab.terminal': '终端',
    'tab.jobs': '任务',
    'tab.plan': '计划',
    'tab.goals': '目标',
    'tab.collab': '协作',
    'tab.skills': '技能',
    'tab.extensions': '扩展',
    'skills.modelInvocable': '模型可直接调用',
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
    'stats.uncached': '未缓存输入 {value} token',
    'stats.cacheRead': '缓存读 {value} token',
    'stats.cacheWrite': '缓存写 {value} token',
    'stats.output': '输出 {value} token',
    'stats.cacheHit': '缓存命中率 {value}',
    'stats.cost': '本次花费 {value}',
    'stats.cost.detail': '明细（输入+写 / 缓存读 / 输出）',
    'stats.cost.unset': '花费：未配置单价',
    'stats.pricing': '单价（每百万 token，美元）',
    'stats.pricing.hint': '留空则只显示 token，不显示金额',
    'stats.pricing.save': '保存单价',
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
    'settings.llmServices': 'LLM 服务',
    'settings.proxy': '网络代理',
    'settings.proxy.save': '保存代理',
    'settings.proxy.hint': '保存后需要重启宿主才会生效；本地回环地址始终直连。',
    'settings.proxy.saved': '代理已保存，重启宿主后生效',
    'settings.skin': '自定义皮肤',
    'settings.extension': '浏览器扩展',
    'settings.peers': '外部 agent（同事）',
    'settings.peers.add': '登记',
    'settings.peers.remove': '删除',
    'settings.peers.empty': '还没有登记外部 agent',
    'settings.peers.hint': '支持三种接法：cli（命令行程序，如 claude -p）、http（JSON 服务）、a2a（Agent2Agent 协议）。登记后模型可用 agent_peers / agent_delegate 找它们协作。',
    'settings.peers.incomplete': '至少要填 id、显示名与 command/URL',
    'settings.peers.badArgs': 'args 要是 JSON 字符串数组',
    'settings.peers.added': '已登记',
    'settings.peers.removed': '已删除',
    'settings.extension.address': '应用地址',
    'settings.extension.code': '配对码',
    'settings.extension.generate': '生成配对码',
    'settings.extension.generated': '配对码已生成（5 分钟内有效，一次性）',
    'settings.extension.hint': '在 Chrome/Edge 的扩展页里「加载已解压的扩展程序」，选仓库的 apps/extension 目录；侧栏里填上面的地址与配对码即可对话。',
    'settings.extension.needShell': '配对需要桌面端（浏览器里没有这个通道）。',
    'settings.skin.hint': '把 CSS 放到 .ghost/ui/custom.css，用 html:root 覆盖下面的变量即可换肤（同优先级时自定义在后生效）。',
    'settings.skin.vars': '已覆盖的变量',
    'settings.skin.reload': '重新加载皮肤',
    'settings.skin.apply': '应用',
    'settings.skin.copy': '复制为可编辑皮肤',
    'settings.skin.applied': '皮肤已应用',
    'settings.skin.copied': '已复制到 .ghost/ui/custom.css，可自行改造',
    'settings.skin.empty': '还没有自定义皮肤文件',
    'settings.llmServices.add': '登记服务',
    'settings.llmServices.hint': '登记后需要重启宿主才会生效；凭据只填 env 变量名，不填明文密钥。',
    'settings.llmServices.incomplete': '至少要填 id 与模型 id',
    'settings.llmServices.saved': '已登记，重启宿主后生效',
    'ui.extensions': '扩展',
    'admin.bundles': '插件包',
    'admin.plugins': '插件',
    'admin.market': '市场',
    'admin.market.addIndex': '添加索引',
    'admin.market.noIndex': '还没配置市场索引，填一个索引 URL 再搜。',
    'admin.mcp.probe': '探测',
    'admin.mcp.restart': '重启',
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
    'tab.changes': 'Changes',
    'tab.capabilities': 'Host capabilities',
    'capabilities.presets': 'Agent presets',
    'capabilities.computerUse': 'Computer Use',
    'capabilities.hostPlugins': 'Host plugins you can enable',
    'capabilities.automation': 'Automation (browser / computer)',
    'capabilities.browserAutomation': 'Browser automation',
    'capabilities.computerControl': 'Windows computer control',
    'capabilities.available': 'available',
    'capabilities.noBrowser': 'No Chrome / Edge found on this machine',
    'capabilities.notWindows': 'Windows only',
    'capabilities.automationToggled': 'Toggled (takes effect immediately)',
    'capabilities.ledger': 'Capability ledger',
    'capabilities.default': 'default',
    'capabilities.use': 'Use',
    'capabilities.enable': 'Enable',
    'capabilities.on': 'Enabled',
    'capabilities.selected': 'Preset selected',
    'capabilities.needsRestart': 'Saved. Restart the host to apply.',
    'capabilities.cua.ready': 'available',
    'capabilities.cua.unavailable': 'Host CUA is not loaded (official build targets macOS). You can enable it here and restart the host.',
    'capabilities.state.wired': 'wired',
    'capabilities.state.host-default': 'host default',
    'capabilities.state.toggleable': 'enableable',
    'capabilities.state.not-wired': 'not wired',
    'changes.clean': 'No uncommitted changes in the workspace',
    'changes.conflict': 'conflict',
    'changes.needShell': 'Diffs and merges need the desktop app (no git channel in the browser).',
    'changes.resolve': 'Resolve conflict',
    'changes.ours': 'Keep ours',
    'changes.theirs': 'Keep theirs',
    'changes.resolved': 'Conflict resolved',
    'workspace.conflict': 'This file has git conflict markers (<<<<<<< / ======= / >>>>>>>). Resolve it in the Changes tab.',
    'workspace.truncated': 'File is long; showing the first part ({lines} lines total).',
    'tab.terminal': 'Terminal',
    'tab.jobs': 'Jobs',
    'tab.plan': 'Plan',
    'tab.goals': 'Goals',
    'tab.collab': 'Collab',
    'tab.skills': 'Skills',
    'tab.extensions': 'Extensions',
    'skills.modelInvocable': 'Model-invocable',
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
    'stats.uncached': 'Uncached in {value} tokens',
    'stats.cacheRead': 'Cache read {value} tokens',
    'stats.cacheWrite': 'Cache write {value} tokens',
    'stats.output': 'Out {value} tokens',
    'stats.cacheHit': 'Cache hit rate {value}',
    'stats.cost': 'Cost {value}',
    'stats.cost.detail': 'detail (in+write / cache read / out)',
    'stats.cost.unset': 'Cost: no unit price configured',
    'stats.pricing': 'Unit price (USD per million tokens)',
    'stats.pricing.hint': 'Leave empty to show tokens only',
    'stats.pricing.save': 'Save price',
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
    'settings.llmServices': 'LLM services',
    'settings.proxy': 'Network proxy',
    'settings.proxy.save': 'Save proxy',
    'settings.proxy.hint': 'Restart the host to apply. Loopback always bypasses the proxy.',
    'settings.proxy.saved': 'Proxy saved. Restart the host to apply.',
    'settings.skin': 'Custom skin',
    'settings.extension': 'Browser extension',
    'settings.peers': 'External agents (peers)',
    'settings.peers.add': 'Register',
    'settings.peers.remove': 'Remove',
    'settings.peers.empty': 'No external agents registered yet',
    'settings.peers.hint': 'Three kinds: cli (a command line program such as claude -p), http (JSON service), a2a (Agent2Agent protocol). The model can then collaborate via agent_peers / agent_delegate.',
    'settings.peers.incomplete': 'id, label and command/URL are required',
    'settings.peers.badArgs': 'args must be a JSON array of strings',
    'settings.peers.added': 'Registered',
    'settings.peers.removed': 'Removed',
    'settings.extension.address': 'App address',
    'settings.extension.code': 'Pairing code',
    'settings.extension.generate': 'Generate code',
    'settings.extension.generated': 'Code generated (5 minutes, single use)',
    'settings.extension.hint': 'Load the unpacked extension from apps/extension in Chrome/Edge, then paste the address and code in the side panel.',
    'settings.extension.needShell': 'Pairing needs the desktop app (no such channel in the browser).',
    'settings.skin.hint': 'Put CSS in .ghost/ui/custom.css and override the variables below with html:root (same specificity, custom wins).',
    'settings.skin.vars': 'Overridden variables',
    'settings.skin.reload': 'Reload skin',
    'settings.skin.apply': 'Apply',
    'settings.skin.copy': 'Copy as editable skin',
    'settings.skin.applied': 'Skin applied',
    'settings.skin.copied': 'Copied to .ghost/ui/custom.css — edit it freely',
    'settings.skin.empty': 'No custom skin file yet',
    'settings.llmServices.add': 'Register',
    'settings.llmServices.hint': 'Restart the host to apply. Credentials: env var name only, never a plaintext key.',
    'settings.llmServices.incomplete': 'id and model id are required',
    'settings.llmServices.saved': 'Registered. Restart the host to apply.',
    'ui.extensions': 'Extensions',
    'admin.bundles': 'Bundles',
    'admin.plugins': 'Plugins',
    'admin.market': 'Market',
    'admin.market.addIndex': 'Add index',
    'admin.market.noIndex': 'No market index configured. Add an index URL first.',
    'admin.mcp.probe': 'Probe',
    'admin.mcp.restart': 'Restart',
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
