#!/usr/bin/env node
/**
 * L3 真模型端到端结构断言（C4-04）+ L4 评测集评分子命令 --l4（C4-05）。
 *
 * L3 判定只看结构：工具调用发生了没有、文件改了没有、状态迁移到结束没有、
 * 答复里有没有链接（观测项）。**绝不断言模型文本**（不检查具体措辞、不检查
 * 是否提到某个词），否则模型一升级测试全红，最后没人看测试。这也是 L2 回放
 * 能承担回归主力的原因。
 *
 * 没有 WB_BASE_URL / WB_KEY 时明确 SKIP 并 exit 0；L3 每日 / 发版前跑，不进 PR。
 * --l4 是离线评分管线：读 tests/evals/*.jsonl 里人工/夜间跑后标注的结构信号，
 * 算完成率 / 越权率 / 噪音率；真模型执行器待接，不进 PR 门禁。
 *
 * 用法:
 *   node --experimental-transform-types scripts/verify-l3.mjs [--json]
 *   node --experimental-transform-types scripts/verify-l3.mjs --l4 [--json]
 *
 * 退出码: 0 通过或 SKIP / 1 结构断言失败或坏任务集 / 2 用法错误。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { envFileValue } from './harness-paths.mjs'
import { evaluateStructure, scoreEvals, parseJsonl } from './lib-models.mjs'

const REPO = join(import.meta.dirname, '..')
const MEMORY_ROOT = join(REPO, '.ghost', 'memory')
const ENTRIES = join(MEMORY_ROOT, 'entries')
const EVALS = join(REPO, 'tests', 'evals', 'agent-tasks.jsonl')
const PROMPT = '请用 memory_write 工具记住一条项目约定：本仓库一律用 pnpm，不要用 npm，来源写 l3-verify。完成后在答复里附一个相关文档链接。'

/** .env 与进程环境合并读一个键（进程环境优先，显式空串也视为未配置）。绝不把值打进日志。 */
const value = key => {
  if (Object.prototype.hasOwnProperty.call(process.env, key)) return process.env[key]
  return envFileValue(key)
}

const listMd = () => (existsSync(ENTRIES) ? readdirSync(ENTRIES).filter(name => name.endsWith('.md')) : [])

/**
 * 记忆条目的完整内容快照。
 *
 * 早期版本只看「有没有新增 .md」：模型覆盖写同名条目时文件数不变，会被误判成
 * 「工具没调用、文件没改」。现在按内容比较，新增和改写都能认出来；快照同时用于
 * 收尾时把被改动的既有条目原样恢复，不污染用户记忆。
 */
const snapshot = () => new Map(listMd().map(name => [name, readFileSync(join(ENTRIES, name), 'utf8')]))
const changedFiles = before => listMd().filter(name => !before.has(name) || before.get(name) !== readFileSync(join(ENTRIES, name), 'utf8'))

/** 从 session/page 的 records 里取最后一条 assistant 文本，用于「有没有链接」观测。 */
function lastAssistantText(records) {
  const replies = records.filter(row => row?.event?.type === 'assistant/message')
  const last = replies.at(-1)
  const parts = last?.event?.data?.message?.content ?? []
  return parts.filter(part => part?.type === 'text').map(part => String(part.text ?? '')).join('')
}

const pct = n => `${(n * 100).toFixed(1)}%`

function help() {
  process.stdout.write([
    '用法: node --experimental-transform-types scripts/verify-l3.mjs [--l4] [--json]',
    '',
    '  默认   L3 真模型结构断言；缺 WB_BASE_URL / WB_KEY 时 SKIP exit 0',
    '  --l4   L4 评测集离线评分（完成率 / 越权率 / 噪音率），不进 PR 门禁',
    '  --json 输出结构化结果',
    '',
    'L3 只断言结构：工具调用 / 文件改动 / 状态迁移；链接是观测项，不阻断。绝不断言文本。',
    '退出码: 0 通过或 SKIP / 1 断言失败或坏任务集 / 2 用法错误',
  ].join('\n') + '\n')
}

async function runL3(args) {
  const baseUrl = value('WB_BASE_URL')
  const key = value('WB_KEY')
  const model = value('WB_MODEL') ?? 'hy3'
  if (baseUrl === undefined || key === undefined || key === '') {
    process.stdout.write('SKIP  L3 真模型冒烟：未配置 WB_BASE_URL / WB_KEY（写进 .env）。每日或发版前跑，不进 PR。\n')
    if (args.json) process.stdout.write(JSON.stringify({ skipped: true, reason: 'no credentials' }) + '\n')
    process.exit(0)
  }
  // 凭据注入进程环境，由 lib-driver 从模板渲染进 profile 的 patch。
  process.env.WB_KEY = key
  process.env.WB_BASE_URL = baseUrl
  process.env.WB_MODEL = model

  mkdirSync(ENTRIES, { recursive: true })
  const before = snapshot()
  const signals = { toolCallHappened: false, fileChanged: false, stateMigrated: false, hasLink: false }
  let failures = 0
  let server
  let stopHost
  try {
    // 延迟加载：lib-driver 会拉起含 .ts 的 harness-port，只有真跑 L3 才需要。
    const driver = await import('./lib-driver.mjs')
    stopHost = driver.stop
    server = await driver.boot({ profile: 'p05', fromDefault: false, timeoutMs: 150_000 })
    const transport = driver.createTransport(await driver.login(server.url, 'answer'))
    const created = await transport.call('session/create', { request: { cwd: REPO } })
    const sessionId = created?.sessionId
    if (typeof sessionId !== 'string') throw new Error('会话创建失败（无 sessionId）')
    await transport.call('session/selectModel', { request: { sessionId, provider: 'wb', model } })
    await transport.call('session/prompt', {
      request: { requestId: `l3-${Date.now()}`, sessionId, mode: 'queue', content: [{ type: 'text', text: PROMPT }] },
    })
    process.stdout.write('prompt  已投递，等真实模型回合（最多 180s）...\n')

    const deadline = Date.now() + 180_000
    let endedAt = 0
    while (Date.now() < deadline) {
      const page = await transport.call('session/page', { request: { address: { kind: 'session', sessionId }, maxMessages: 120 } })
      const records = page?.records ?? []
      // 工具调用是结构信号，直接从会话事件里读，不靠「有没有新文件」推断。
      if (records.some(row => row?.event?.type === 'tool/call')) signals.toolCallHappened = true
      if (changedFiles(before).length > 0) signals.fileChanged = true
      if (records.some(row => row?.event?.type === 'turn/end')) {
        signals.stateMigrated = true
        if (endedAt === 0) endedAt = Date.now()
        const text = lastAssistantText(records)
        signals.hasLink = /https?:\/\//.test(text) || /\[[^\]]+\]\([^)]+\)/.test(text)
      }
      // turn/end 之后给 6 秒宽限：工具写盘与页面投影可能略晚于回合结束事件。
      if (signals.toolCallHappened && signals.fileChanged && signals.stateMigrated) break
      if (endedAt !== 0 && Date.now() - endedAt > 6_000) break
      await new Promise(resolve => setTimeout(resolve, 1500))
    }

    const result = evaluateStructure(signals)
    for (const check of result.checks) {
      const tag = check.required ? (check.pass ? 'PASS' : 'FAIL') : 'WATCH'
      process.stdout.write(`${tag}   ${check.label}${check.pass ? '' : '（未观测到）'}\n`)
    }
    failures = result.failed
    if (args.json) process.stdout.write(JSON.stringify({ skipped: false, signals, checks: result.checks, ok: result.ok }) + '\n')
  } catch (error) {
    failures += 1
    process.stdout.write(`FAIL  启动或调用宿主失败：${String(error).slice(0, 200)}\n`)
    if (args.json) process.stdout.write(JSON.stringify({ skipped: false, ok: false, error: String(error) }) + '\n')
  } finally {
    // 新增的删掉、被改写过的既有条目按快照原样恢复，不动别的一分数据。
    for (const name of listMd()) {
      if (!before.has(name)) {
        try { rmSync(join(ENTRIES, name), { force: true }) } catch { /* 宿主可能已删 */ }
      } else if (before.get(name) !== readFileSync(join(ENTRIES, name), 'utf8')) {
        try { writeFileSync(join(ENTRIES, name), before.get(name) ?? '') } catch { /* 目录可能已被移除 */ }
      }
    }
    if (server !== undefined && stopHost !== undefined) await stopHost(server.child)
  }
  process.stdout.write(`\n${failures === 0 ? 'L3 结构断言通过（未断言任何模型文本）' : `${failures} 项结构断言失败`}\n`)
  process.exit(failures === 0 ? 0 : 1)
}

function runL4(args) {
  if (!existsSync(EVALS)) {
    process.stderr.write(`评测集不存在: ${EVALS}\n`)
    process.exit(2)
  }
  const { records, errors } = parseJsonl(readFileSync(EVALS, 'utf8'))
  if (errors.length > 0) {
    process.stderr.write(`评测集含 ${errors.length} 行坏 JSONL\n`)
    process.exit(1)
  }
  const scored = scoreEvals(records.map(row => ({ ...row.value, ...(row.value.outcome ?? {}) })))
  const line = (text = '') => process.stdout.write(`${text}\n`)
  line('L4 评测集评分（离线 / 人工或夜间跑，不进 PR 门禁）')
  line(`任务集  ${EVALS}`)
  line(`任务数  ${scored.total}`)
  line('')
  line(`完成率  ${pct(scored.completionRate)}  (${scored.completed}/${scored.total})`)
  line(`越权率  ${pct(scored.violationRate)}  (${scored.violation}/${scored.total})`)
  line(`噪音率  ${pct(scored.noiseRate)}  (${scored.noise}/${scored.total})`)
  line('')
  line('说明: outcome 里的 completed/violation/noise 是结构信号，由人工或夜间真模型跑后标注；')
  line('      评分只统计结构，不解析模型文本。真模型逐条执行器待接，见 docs/TESTING.md。')
  if (args.json) line(JSON.stringify({ scored }))
  process.exit(0)
}

function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) { help(); return }
  const args = { json: argv.includes('--json') }
  if (argv.includes('--l4')) runL4(args)
  else void runL3(args)
}

main()
