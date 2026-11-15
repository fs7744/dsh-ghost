/**
 * 7 个视图的示例数据：用一份内存仓储造出空/满/人闸三种状态的票，
 * 再跑一遍全部 builder。生成的 JSON 落在 examples/superagent-views.json，
 * 供自建界面联调时对照数据形状；测试也可直接用 sampleViews()。
 */

import { MemoryRepositories } from '../../core/index.ts'
import type { Ticket } from '../../core/index.ts'
import { VIEW_BUILDERS, VIEW_NAMES } from './builders.ts'
import type { PanelView, ViewName } from './types.ts'
import type { ViewExtra } from './builders.ts'

const AT = '2026-02-01T00:00:00.000Z'

/** 造一张最小合法票；差异部分用 over 覆盖。 */
function makeTicket(id: string, title: string, over: Partial<Ticket> = {}): Ticket {
  return {
    id,
    title,
    decisionId: `dec-${id}`,
    mandate: {
      strength: 'explicit',
      policyVersion: 'v1',
      basis: { via: 'addressed', addressed: 'mention' },
      actor: { source: 'github', id: 'alice' },
      scope: 'repo',
    },
    channels: [],
    assignments: [],
    inputs: [],
    undelivered: [],
    createdAt: AT,
    updatedAt: AT,
    origin: { triggerId: `tr-${id}`, triggerIds: [`tr-${id}`] },
    ...over,
  }
}

/** 一份含「工作中 / 待人答复 / 已结束」三类票的示例仓储。 */
export function sampleRepo(): MemoryRepositories {
  const repo = new MemoryRepositories()
  repo.tickets.save(makeTicket('tk-working', '把登录页的校验补齐', {
    assignments: [{ id: 'a1', state: 'running', createdAt: AT, report: { state: 'progress', summary: '正在改表单校验', at: AT } }],
  }))
  repo.tickets.save(makeTicket('tk-attention', '合并前请确认版本号', {
    attention: { id: 'att-1', question: '版本号用 v2 还是 v2.1？', triggerId: 'tr-tk-attention' },
    assignments: [{ id: 'a2', state: 'running', createdAt: AT, report: { state: 'progress', summary: '已改完，等确认', at: AT } }],
  }))
  // ready 报告且无 follow 项时领域会直接结束票：这张已结束的票不该出现在 Overview。
  repo.tickets.save(makeTicket('tk-done', '修好 README 的错字', {
    ended: { at: AT, by: 'executor', outcome: 'completed' },
    assignments: [{ id: 'a3', state: 'ended', createdAt: AT, report: { state: 'ready', summary: '已完成', at: AT } }],
  }))
  repo.threads.save({
    key: 'github:demo#1', ref: { source: 'github', id: 'demo#1' }, createdAt: AT,
    subscriptions: ['tk-working'], correlated: [], pending: [], meta: {},
  })
  repo.decisions.save({
    id: 'dec-1', evalId: 'ev-1', threadKey: 'github:demo#1', triggerIds: ['tr-tk-working'],
    policyVersion: 'v1', at: AT, kind: 'accept',
    reason: [{ code: 'said', values: { text: '外部请求：补齐登录页校验' } }],
    strength: 'explicit', ticketId: 'tk-working',
  })
  return repo
}

/** 示例用的注入配置：两个来源（飞书默认关闭）、设置块、部署配置与自检结果。 */
export function sampleExtra(): ViewExtra {
  return {
    sources: [
      { id: 'github', kind: 'github', description: 'GitHub webhook（内置适配器）', auth: 'hmac', enabled: true },
      { id: 'feishu', kind: 'generic', description: '飞书 bot 提及（声明式映射）', auth: 'hmac', enabled: false },
    ],
    settings: {
      policy: { version: 'v1', paused: false },
      executor: { concurrency: 2, timeoutMs: 120000 },
      prompts: { residentBudget: 700 },
    },
    deploy: {
      service: 'dsh-superagent',
      stateDir: '.ghost/superagent',
      machine: { os: 'windows', arch: 'x64' },
      accounts: ['github', 'feishu'],
      watchIntervalMinutes: 60,
    },
    checks: [
      { id: 'stateDir', ok: true, reason: '状态目录可写' },
      { id: 'githubSecret', ok: false, reason: '缺少环境变量 GH_WEBHOOK_SECRET' },
      { id: 'orchestratorRoute', ok: true, reason: '管理面全部走 Typert Remote，无自建 /orchestrator 路由' },
    ],
  }
}

/** 一次产出 7 个视图，供示例 JSON 与测试使用。 */
export function sampleViews(): Record<ViewName, PanelView> {
  const repo = sampleRepo()
  const extra = sampleExtra()
  const result = {} as Record<ViewName, PanelView>
  for (const name of VIEW_NAMES) result[name] = VIEW_BUILDERS[name](repo, extra)
  return result
}
