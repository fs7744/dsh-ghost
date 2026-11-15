/**
 * B7-02 自检与 status 退出码，以及 C2-01 的静态断言。
 *
 * 纯逻辑、零 IO：配置 / 装配完整性由可注入的输入给出，路由扫描由调用方读入文件后传入。
 * 缺项一律给「明确原因」的人话，不静默略过；status 子命令直接把 exitCode 交出去。
 */

import { TOOL_NAMES } from '../tools/index.ts'
import { VIEW_NAMES } from '../app/views/index.ts'
import { MANAGEMENT_REMOTES } from '../app/host/index.ts'

/** status 退出码：0 全绿、1 配置缺项、2 触到安全红线。 */
export const EXIT_OK = 0
export const EXIT_INCOMPLETE = 1
export const EXIT_SECURITY = 2

/** 一条检查项。severity=security 的失败把退出码抬到 2。 */
export interface CheckItem {
  id: string
  ok: boolean
  reason: string
  severity?: 'missing' | 'security'
}

/** 自检输入，全部可注入；文件扫描结果由调用方传入。 */
export interface SelfCheckInput {
  env?: NodeJS.ProcessEnv
  /** 状态目录是否可写。 */
  stateDirReady?: boolean
  /** B6 提示词 / 剧本资产是否齐全（静态验收核对后注入）。 */
  assetsReady?: boolean
  /** C2-01 扫描命中的自建 /orchestrator 路由文件列表。 */
  selfBuiltRoutes?: readonly string[]
}

export interface SelfCheckResult {
  ok: boolean
  exitCode: number
  checks: CheckItem[]
  summary: string
}

/** 8 项完整性检查：配置 3 项、装配清单 3 项、资产 1 项、安全红线 1 项。 */
export function runSelfCheck(input: SelfCheckInput = {}): SelfCheckResult {
  const env = input.env ?? {}
  const githubEnabled = (env['DSH_GITHUB_ENABLED'] ?? 'yes') !== 'no'
  const feishuEnabled = (env['DSH_FEISHU_ENABLED'] ?? 'no') === 'yes'
  const routes = input.selfBuiltRoutes ?? []

  const checks: CheckItem[] = [
    {
      id: 'stateDir',
      ok: input.stateDirReady ?? false,
      reason: input.stateDirReady ?? false ? '状态目录可写' : '状态目录未就绪：请先运行 SETUP 向导或检查目录权限',
    },
    {
      id: 'githubSecret',
      ok: !githubEnabled || (env['GH_WEBHOOK_SECRET'] ?? '') !== '',
      reason: !githubEnabled ? 'GitHub 源未启用，无需密钥'
        : (env['GH_WEBHOOK_SECRET'] ?? '') !== '' ? 'GH_WEBHOOK_SECRET 已配置'
          : '缺少环境变量 GH_WEBHOOK_SECRET（GitHub webhook 签名密钥）',
    },
    {
      id: 'feishuSecret',
      ok: !feishuEnabled || (env['FEISHU_WEBHOOK_SECRET'] ?? '') !== '',
      reason: !feishuEnabled ? '飞书源默认关闭，无需密钥'
        : (env['FEISHU_WEBHOOK_SECRET'] ?? '') !== '' ? 'FEISHU_WEBHOOK_SECRET 已配置'
          : '飞书源已启用，但缺少环境变量 FEISHU_WEBHOOK_SECRET',
    },
    {
      id: 'tools',
      ok: TOOL_NAMES.length === 19,
      reason: TOOL_NAMES.length === 19 ? '19 个会话工具描述符齐全' : `会话工具数量异常：期望 19，实际 ${TOOL_NAMES.length}`,
    },
    {
      id: 'views',
      ok: VIEW_NAMES.length === 7,
      reason: VIEW_NAMES.length === 7 ? '7 个面板视图齐全' : `面板视图数量异常：期望 7，实际 ${VIEW_NAMES.length}`,
    },
    {
      id: 'remotes',
      ok: MANAGEMENT_REMOTES.length >= 17,
      reason: MANAGEMENT_REMOTES.length >= 17 ? '管理面 Remote 清单齐全（全部走 Typert Remote）' : '管理面 Remote 清单不完整',
    },
    {
      id: 'assets',
      ok: input.assetsReady ?? true,
      reason: input.assetsReady ?? true ? '提示词与 .flow 剧本资产齐全' : '提示词 / 剧本资产缺失：请运行 verify-superagent-assets.mjs',
    },
    {
      id: 'orchestratorRoute',
      ok: routes.length === 0,
      severity: 'security',
      reason: routes.length === 0
        ? '管理面全部走 Typert Remote，仓库里不存在自建 /orchestrator HTTP 路由'
        : `发现自建 /orchestrator HTTP 路由（绕过鉴权）：${routes.join(', ')}`,
    },
  ]

  const failed = checks.filter(item => !item.ok)
  const hasSecurity = failed.some(item => item.severity === 'security')
  const exitCode = failed.length === 0 ? EXIT_OK : hasSecurity ? EXIT_SECURITY : EXIT_INCOMPLETE
  return {
    ok: failed.length === 0,
    exitCode,
    checks,
    summary: failed.length === 0
      ? '配置完整，服务可启动'
      : `${failed.length} 项未就绪：${failed.map(item => `${item.id}（${item.reason}）`).join('；')}`,
  }
}

/**
 * C2-01 静态断言的核心匹配：一段文本里是否出现「自建 /orchestrator HTTP 路由」。
 *
 * 只认明确的路由注册写法，不认文档里对 /orchestrator 的叙述，也不认 Typert Remote 声明。
 * 这样 docs/FEATURES.md、docs/SUPERAGENT.md 里提到这个词不会误报。
 */
const ROUTE_PATTERNS: readonly RegExp[] = [
  /\.(get|post|put|delete|patch|all|use)\s*\(\s*['"`]\/orchestrator/i,
  /\broute\s*\(\s*['"`]\/orchestrator/i,
  /['"`]\/orchestrator['"`]\s*,\s*(req|res|handler|ctx|_req)/i,
  /createServer[\s\S]{0,200}?\.end?\s*\(?\s*['"`]\/orchestrator/i,
]

/** 判断单段代码是否含自建 /orchestrator 路由。 */
export function containsSelfBuiltOrchestratorRoute(text: string): boolean {
  return ROUTE_PATTERNS.some(pattern => pattern.test(text))
}

/** 断言定义自身不参与扫描：它含路由模式的字面文本，会被自己的正则误命中。 */
const ASSERTION_SELF = ['selfcheck.ts', 'verify-superagent-assets.mjs']

/** 扫一批文件内容，返回命中自建路由的代码文件路径。只扫代码文件，不扫文档，跳过断言定义自身。 */
export function findSelfBuiltRoutes(entries: readonly { path: string; text: string }[]): string[] {
  return entries
    .filter(entry => /\.(?:[cm]?[jt]s|tsx)$/.test(entry.path)
      && !ASSERTION_SELF.some(name => entry.path.endsWith(name))
      && containsSelfBuiltOrchestratorRoute(entry.text))
    .map(entry => entry.path)
}
