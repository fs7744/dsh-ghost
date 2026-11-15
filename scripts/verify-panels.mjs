#!/usr/bin/env node
/**
 * 自建界面面板验收（C8 剩余项 / C11-04）：真实宿主 Remote + 界面纯逻辑归一化。
 *
 * 判定：离线纯逻辑（空/畸形归一化、目录树、聚合、压缩点）正确；至少 4 个真实
 * Remote 端点能取数，且界面归一化函数对真实响应的形状断言通过。
 * 单个端点不可用只记 WARN，不硬失败（宿主能力随版本/配置变化，属正常降级）。
 *
 * 登记脚本：test:panels / verify:panels（集成时加入根 package.json）。
 */
import { join } from 'node:path'
import { boot, stop, login, createTransport } from './lib-driver.mjs'
import {
  normalizeSkills, normalizeJobs, sortJobs, normalizeGoals, normalizeTerminals,
} from '../apps/desktop/src/runtime-panels.ts'
import {
  normalizeProviders, normalizeSettings, normalizeBundles,
} from '../apps/desktop/src/admin-panels.ts'
import { normalizeFileEntries, buildFileTree } from '../apps/desktop/src/workspace.ts'
import { aggregateFeedback, sessionStats } from '../apps/desktop/src/feedback.ts'
import { computeOccupancy, findCompactionMarks } from '../apps/desktop/src/context-bar.ts'

const REPO = join(import.meta.dirname, '..')
let failures = 0
const check = (ok, label, extra = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra === '' ? '' : `：${extra}`}\n`)
  if (!ok) failures += 1
}
const warn = (label, reason) => {
  process.stdout.write(`WARN  ${label}：${String(reason).slice(0, 140)}\n`)
}
const brief = value => (Array.isArray(value) ? `${value.length} 项` : typeof value)

// ---- 离线纯逻辑：与宿主无关，先跑，保证归一化函数本身可信 ----
check(normalizeSkills(undefined).length === 0 && normalizeJobs(null).length === 0, '空 / 畸形响应归一化返回空数组')
const tree = buildFileTree(normalizeFileEntries([{ path: 'src/a.ts' }, { path: 'README.md' }]))
check(tree.length > 0 && tree.every(node => typeof node.name === 'string' && Array.isArray(node.children)),
  '目录树构建出可渲染节点', tree.map(node => node.name).join(', '))
check(aggregateFeedback({ items: [{ target: 'm1', kind: 'positive' }] }).positive === 1, '反馈聚合计数')
check(findCompactionMarks([{ type: 'event', event: { type: 'compaction/done', seq: 2, data: { summary: 'x' } } }]).length === 1,
  '压缩点标记计算')
check(computeOccupancy(500, 1000).ratio === 0.5 && sessionStats(null).turns === 0, '占用比例与会话统计容错')
check(normalizeSettings({ revision: 1, theme: 'dark' }).some(row => row.key === 'theme'), '设置 map 归一化')

const server = await boot({ profile: 'p05', fromDefault: false })
let transport
try {
  transport = createTransport(await login(server.url, 'none'))
  const created = await transport.call('session/create', { request: { cwd: REPO } })
  const agentId = created?.sessionId ?? ''
  check(typeof agentId === 'string' && agentId !== '', '宿主建会话', agentId.slice(0, 12))

  let live = 0
  /**
   * 调一个真实端点并用界面纯逻辑归一化。args 可为单个对象或候选数组（依次尝试，
   * 适配随宿主版本变化的 wire 必填字段）；全部不可用 -> WARN，归一化断言失败 -> FAIL。
   */
  const probe = async (label, endpoint, argsOrList, assertFn) => {
    const candidates = Array.isArray(argsOrList) ? argsOrList : [argsOrList]
    let raw
    let succeeded = false
    let lastError = ''
    for (const args of candidates) {
      try {
        raw = await transport.call(endpoint, args)
        succeeded = true
        break
      } catch (error) {
        lastError = String(error)
      }
    }
    if (!succeeded) {
      warn(`${label} (${endpoint}) 不可用`, lastError)
      return
    }
    live += 1
    try {
      const ok = assertFn(raw)
      check(ok, `${label} 真实响应归一化`, brief(raw))
    } catch (error) {
      failures += 1
      process.stdout.write(`FAIL  ${label} 归一化抛错：${String(error).slice(0, 140)}\n`)
    }
  }

  await probe('技能面板', 'skills/list', [
    { request: { sessionId: agentId } },
    { request: {} },
  ], raw => {
    const rows = normalizeSkills(raw)
    return Array.isArray(rows) && rows.every(row => typeof row.name === 'string' && row.name !== '')
  })
  await probe('模型提供方', 'llm/listProviders', {}, raw => {
    const rows = normalizeProviders(raw)
    return Array.isArray(rows) && rows.every(row => typeof row.name === 'string' && typeof row.models === 'number')
  })
  await probe('可配置提供方', 'llm/listConfigurableProviders', {}, raw => {
    const rows = normalizeProviders(raw)
    return Array.isArray(rows)
  })
  await probe('用户设置', 'settings/describe', {}, raw => {
    const rows = normalizeSettings(raw)
    return Array.isArray(rows) && rows.every(row => typeof row.key === 'string' && typeof row.value === 'string')
  })
  await probe('插件包权限开关', 'pluginManager/listBundles', {}, raw => {
    const rows = normalizeBundles(raw)
    return Array.isArray(rows) && rows.every(row => typeof row.enabled === 'boolean' && typeof row.builtin === 'boolean')
  })
  await probe('工作区文件树', 'workspaceFiles/list', [
    { workspaceFileScopeId: agentId, path: '' },
    { workspaceFileScopeId: '', path: '' },
  ], raw => {
    const rows = normalizeFileEntries(raw)
    const built = buildFileTree(rows)
    return Array.isArray(rows) && built.every(node => typeof node.name === 'string')
  })
  await probe('后台任务', 'job/list', [
    { request: { sessionId: agentId } },
    { request: {} },
  ], raw => {
    const rows = sortJobs(normalizeJobs(raw))
    return Array.isArray(rows) && rows.every(row => ['running', 'done', 'failed', 'idle'].includes(row.tone))
  })
  await probe('目标视图', 'goals/get', { agentId }, raw => {
    const rows = normalizeGoals(raw)
    return Array.isArray(rows)
  })
  await probe('终端面板', 'terminal/list', { sessionId: agentId }, raw => {
    const rows = normalizeTerminals(raw)
    return Array.isArray(rows) && rows.every(row => typeof row.id === 'string')
  })
  await probe('会话投影 / 上下文', 'session/projections', { request: { sessionId: agentId } }, raw => {
    const stats = sessionStats(raw)
    const pressure = raw?.values?.contextPressure ?? {}
    const occupancy = computeOccupancy(pressure.projectedTokens, pressure.contextWindow)
    return Number.isFinite(stats.turns) && occupancy.ratio >= 0 && occupancy.ratio <= 1
  })

  check(live >= 4, '至少 4 个真实端点可用', `${live} 个`)
} catch (error) {
  failures += 1
  process.stdout.write(`FAIL  ${String(error)}\n`)
} finally {
  await stop(server.child)
}
process.stdout.write(`\n${failures === 0 ? '面板验收通过' : `${failures} 项失败`}\n`)
process.exit(failures === 0 ? 0 : 1)
