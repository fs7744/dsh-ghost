#!/usr/bin/env node
/**
 * 进化后端验收（C10-05/06/07）：真实宿主上调 ghostEvolution/* 走完
 * 「三次返工 → 提案 → 批准 → L2 约束 → 驳回分支 → runs.jsonl」，并清理测试数据。
 *
 * 端点跑不通（例如新包没同步进宿主 profile）会如实记 FAIL 并 exit(1)，不伪造通过。
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { boot, stop, login, createTransport } from './lib-driver.mjs'
import { DSH_HOME } from '../spikes/p05-transport/lib/harness-client.mjs'

const REPO = join(import.meta.dirname, '..')
const PROFILE = 'p05'
const EVOLUTION_ROOT = join(REPO, '.ghost', 'memory', 'evolution')
const ENTRIES = join(REPO, '.ghost', 'memory', 'entries')
const KEY_A = 'verify-evolution-npm'
const KEY_B = 'verify-evolution-pnpm'
const L2_A = 'verify-evo-constraint'
const L2_B = 'verify-evo-rejected'

let failures = 0
const check = (ok, label, extra = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra === '' ? '' : `：${extra}`}\n`)
  if (!ok) failures += 1
}

/**
 * lib-driver 的 syncPlugins 只认固定列表，新包要自己同步进 profile，
 * 否则宿主运行时解析不到 `@dsh-ghost/evolution` 等包名，端点会跑不通。
 */
function syncNewPackages() {
  const target = join(DSH_HOME, 'profiles', PROFILE, 'node_modules', '@dsh-ghost')
  mkdirSync(target, { recursive: true })
  for (const name of ['evolution', 'playbook-runtime', 'playbook']) {
    const from = join(REPO, 'packages', name)
    if (!existsSync(join(from, 'package.json'))) continue
    const to = join(target, name)
    mkdirSync(to, { recursive: true })
    cpSync(join(from, 'package.json'), join(to, 'package.json'))
    for (const dir of ['lib', 'src']) {
      const source = join(from, dir)
      if (existsSync(source)) cpSync(source, join(to, dir), { recursive: true })
    }
  }
}

/** 清理测试数据：提案/runs 目录 + 两个测试 L2 条目（含 .bak）。 */
function cleanFiles() {
  rmSync(EVOLUTION_ROOT, { recursive: true, force: true })
  for (const name of [L2_A, L2_B]) {
    for (const suffix of ['.md', '.md.bak']) rmSync(join(ENTRIES, `${name}${suffix}`), { force: true })
  }
}

syncNewPackages()
cleanFiles()

const server = await boot({ profile: PROFILE, fromDefault: false })
let transport
try {
  transport = createTransport(await login(server.url, 'none'))
  const call = (endpoint, input) => transport.call(`ghostEvolution/${endpoint}`, input === undefined ? {} : { input })
  const memCall = (endpoint, input) => transport.call(`ghostMemory/${endpoint}`, input === undefined ? {} : { input })

  // 确保总开关打开，否则 L2 写入会被 gate 拒。
  await memCall('toggle', { enabled: true })
  const occ = (n) => ({ at: new Date().toISOString(), note: `第 ${n} 次返工` })
  const constraintA = { name: L2_A, title: '不要用 npm', text: '统一用 pnpm，不用 npm。', source: 'verify-evolution' }
  const constraintB = { name: L2_B, title: '驳回用约束', text: '这条不该被写入。', source: 'verify-evolution' }

  // 1. 三次返工才触发提案
  const p1 = await call('propose', { key: KEY_A, occurrences: [occ(1)], constraint: constraintA })
  check(p1?.created === false && p1?.count === 1, '第 1 次返工不生成提案', JSON.stringify(p1).slice(0, 120))
  const p2 = await call('propose', { key: KEY_A, occurrences: [occ(2)], constraint: constraintA })
  check(p2?.created === false && p2?.count === 2, '第 2 次返工仍不生成提案')
  const p3 = await call('propose', { key: KEY_A, occurrences: [occ(3)], constraint: constraintA })
  check(p3?.created === true && p3?.proposal?.status === 'pending', '第 3 次返工生成 pending 提案', JSON.stringify(p3).slice(0, 160))
  const proposalId = p3?.proposal?.id
  check(typeof proposalId === 'string' && proposalId !== '', '提案带 id')

  // 2. 提案可查看
  const listed = await call('list')
  check((listed?.items ?? []).some(item => item.id === proposalId), 'list 能查到刚生成的提案')

  // 3. 人闸批准 → 写进 L2 项目记忆
  const approved = await call('approve', { id: proposalId, by: 'verify-evolution' })
  check(approved?.applied === true && approved?.proposal?.status === 'approved',
    '批准后 applied=true 且状态 approved', JSON.stringify(approved).slice(0, 160))
  const l2 = await memCall('read', { name: L2_A })
  check((l2?.content ?? '').includes('pnpm'), 'ghostMemory/read 能读到 L2 约束正文')

  // 4. 驳回分支
  for (let index = 0; index < 3; index += 1) {
    await call('propose', { key: KEY_B, occurrences: [occ(index + 1)], constraint: constraintB })
  }
  const listB = await call('list')
  const pendingB = (listB?.items ?? []).find(item => item.status === 'pending' && item.id !== proposalId)
  check(pendingB !== undefined, '驳回分支有第二个 pending 提案')
  if (pendingB !== undefined) {
    const rejected = await call('reject', { id: pendingB.id, by: 'verify-evolution' })
    check(rejected?.applied === false && rejected?.proposal?.status === 'rejected',
      '驳回返回 applied=false 且状态 rejected', JSON.stringify(rejected).slice(0, 160))
    const l2b = await memCall('read', { name: L2_B })
    check(l2b?.content === undefined, '驳回不落盘：L2 里没有该约束')
  }

  // 5. runs.jsonl 与看板
  const metrics = await call('metrics', {
    record: { ticketId: 'verify-1', at: new Date().toISOString(), completed: true, tokens: 120, toolCalls: 8, rework: 1 },
  })
  check(metrics?.recorded >= 1 && metrics?.runs >= 1, 'metrics 记录 run 并返回看板', JSON.stringify(metrics).slice(0, 160))
  check(existsSync(join(EVOLUTION_ROOT, 'runs.jsonl')), 'runs.jsonl 真的落盘')
  check(existsSync(join(EVOLUTION_ROOT, 'proposals')), '提案落盘为文件（可 git 回滚）')

  // 6. 其它新端点冒烟：单项失败不阻断后续，未同步/签名不合法都会如实记 FAIL。
  const smoke = async (label, endpoint, input, judge) => {
    try {
      const result = await transport.call(endpoint, { input })
      check(judge(result), label, JSON.stringify(result).slice(0, 120))
    } catch (error) {
      check(false, label, String(error))
    }
  }
  await smoke('ghostPlaybook/generate 生成合法 .flow', 'ghostPlaybook/generate',
    { prompt: '收到 issue 后验证再回复', goal: '产出可审阅结果' },
    result => result?.ok === true && typeof result.text === 'string')
  await smoke('ghostPlaybook/diff 返回结构化 diff', 'ghostPlaybook/diff',
    { before: '# @a v1\n# goal g\nx\n', after: '# @a v1\n# goal g\nx\ny\n' },
    result => result?.ok === true && (result.diff?.summary.added ?? 0) >= 1)
  await smoke('ghostPlaybook/tryRun 推演到终点', 'ghostPlaybook/tryRun',
    { text: '# @a v1\n# goal g\nx\ny\n', from: 'x' },
    result => result?.ok === true && result.result?.reason === 'end')
  await smoke('ghostPlaybook/rewrite 只改局部', 'ghostPlaybook/rewrite',
    { text: '# @a v1\n# goal g\nx\ny\n', instruction: '把 x 改成人闸', selection: { node: 'x' } },
    result => result?.ok === true && (result.text ?? '').includes('?x'))
  // --help 分支不会启动任何子进程，是安全的运行时冒烟路径。
  await smoke('ghostPlaybook/runScript --help 不执行脚本', 'ghostPlaybook/runScript',
    { script: 'scripts/x.mjs', args: ['--help'] },
    result => result?.ok === true && result.outcome?.code === 'HELP')
  await smoke('ghostInit/draft 生成草案', 'ghostInit/draft', { root: REPO },
    result => result?.ok === true && typeof result.content === 'string')
  await smoke('ghostCompaction/config 返回默认配置', 'ghostCompaction/config', {},
    result => result?.ok === true && (result.config?.triggerRatio ?? 0) > 0)
  await smoke('ghostCompaction/config 拒绝非法配置', 'ghostCompaction/config',
    { config: { triggerRatio: 1.5 } },
    result => result?.ok === false)
} catch (error) {
  failures += 1
  process.stdout.write(`FAIL  端点调用异常：${String(error)}\n`)
} finally {
  // 无论成败都清掉临时数据，不把脏数据留给下一次验收。
  try {
    await transport?.call('ghostMemory/toggle', { input: { enabled: true } })
    await transport?.call('ghostMemory/remove', { input: { name: L2_A } })
    await transport?.call('ghostMemory/remove', { input: { name: L2_B } })
  } catch { /* 宿主可能已退出 */ }
  cleanFiles()
  await stop(server.child)
}
process.stdout.write(`\n${failures === 0 ? '进化验收通过' : `${failures} 项失败`}\n`)
process.exit(failures === 0 ? 0 : 1)
