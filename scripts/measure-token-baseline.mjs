#!/usr/bin/env node
/**
 * Token 基线实测：同一个真实请求，剪枝前 vs 剪枝后，固定开销差多少。
 *
 * 做法：
 *  1) 假模型抓一次真实请求（带我们的插件），量 `tools` 数组的字节与条目数；
 *  2) 把剪枝账本写成「8 个可选工具连续 9 次启动、30 天、0 调用」→ 宿主启动时真的会剪；
 *  3) 再抓一次同样规模的请求，对比。
 *
 * 输出的是**抓包实测**，不是估算；token 数按 CJK 1 字≈1 token、其余 4 字符≈1 token 折算。
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { boot, stop, login, createTransport } from './lib-driver.mjs'

const REPO = join(import.meta.dirname, '..')
const USAGE_FILE = join(REPO, '.ghost', 'tool-usage.json')
const STATE = join(REPO, '.ghost', 'tmp-baseline-tickets.json')

const freePort = () => new Promise(resolve => {
  const server = createServer()
  server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)) })
})
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/** 粗略 token 折算：CJK 1 字 1 token，其余 4 字符 1 token。 */
const estimateTokens = (text) => {
  let cjk = 0
  let other = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code > 0x2e80) cjk += 1
    else other += 1
  }
  return Math.ceil(cjk + other / 4)
}

/** 跑一轮：起宿主 → 发一句 → 抓一次请求 → 量 tools 开销。 */
async function measure(label, captureDir) {
  const port = await freePort()
  rmSync(captureDir, { recursive: true, force: true })
  mkdirSync(captureDir, { recursive: true })
  const fake = spawn(process.execPath, [
    join(REPO, 'spikes', 'p05-transport', 'fake-messages.mjs'), '--port', String(port), '--out', captureDir,
  ], { stdio: 'ignore' })
  await sleep(700)
  const patch = [
    '- insert:',
    '    - id: ghost-memory',
    "      name: '@dsh-ghost/memory-plugin'",
    '      config:',
    `        root: '${join(REPO, '.ghost', 'memory').replace(/\\/g, '/')}'`,
    '    - id: ghost-orchestrator',
    "      name: '@dsh-ghost/orchestrator-plugin'",
    '      config:',
    `        stateFile: '${STATE.replace(/\\/g, '/')}'`,
    '',
    '- id: llm-pi-ai',
    '  config:',
    '    providers:',
    '      mock:',
    '        displayName: Mock',
    '        api: anthropic-messages',
    `        baseURL: http://127.0.0.1:${port}`,
    '        apiKeyEnv: MOCK_KEY',
    '        models:',
    '          - id: mock-1',
    '            name: Mock 1',
    '            contextWindow: 200000',
    '            maxTokens: 8192',
  ].join('\n')
  process.env.MOCK_KEY = 'mock-key'
  let server
  try {
    server = await boot({ profile: 'p05', fromDefault: false, patch })
    const session = await login(server.url, 'none')
    const transport = createTransport({ ...session, onError: () => {} })
    const created = await transport.call('session/create', { request: { cwd: join(REPO, 'spikes', 'p05-transport', '.workspace') } })
    await transport.call('session/selectModel', { request: { sessionId: created?.sessionId, provider: 'mock', model: 'mock-1' } })
    await transport.call('session/prompt', {
      request: {
        requestId: `req-${Date.now()}`,
        sessionId: created?.sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: '看一眼现状' }],
      },
    })
    const deadline = Date.now() + 30_000
    let files = []
    while (Date.now() < deadline) {
      files = readdirSync(captureDir).filter(name => name.endsWith('.json')).sort()
      if (files.length > 0) break
      await sleep(400)
    }
    if (files.length === 0) throw new Error(`${label}: 没抓到请求`)
    const payload = JSON.parse(readFileSync(join(captureDir, files[0]), 'utf8'))
    const tools = Array.isArray(payload.tools) ? payload.tools : []
    const ours = tools.filter(tool => String(tool.name).startsWith('orchestrator_'))
    const toolJson = JSON.stringify(tools)
    const oursJson = JSON.stringify(ours)
    return {
      label,
      toolCount: tools.length,
      ourToolCount: ours.length,
      toolBytes: toolJson.length,
      ourBytes: oursJson.length,
      toolTokens: estimateTokens(toolJson),
      ourTokens: estimateTokens(oursJson),
    }
  } finally {
    if (server !== undefined) await stop(server.child)
    fake.kill()
    rmSync(STATE, { force: true })
  }
}

const OPTIONAL = [
  'orchestrator_settings_save', 'orchestrator_policy_sync', 'orchestrator_prompts_save',
  'orchestrator_eval', 'orchestrator_eval_read', 'orchestrator_eval_decide',
  'orchestrator_thread_unsubscribe', 'orchestrator_ticket_note',
]

const original = existsSync(USAGE_FILE) ? readFileSync(USAGE_FILE, 'utf8') : undefined
try {
  // ① 基线：账本干净 → 19 个工具全注册
  rmSync(USAGE_FILE, { force: true })
  const before = await measure('剪枝前', join(REPO, 'out', 'baseline-before'))

  // ② 剪枝：账本写成「9 次启动 / 30 天 / 0 调用」→ 宿主启动时真的剪掉 8 个可选工具
  const ledger = { version: 1, boots: 9, tools: {}, updatedAt: new Date().toISOString() }
  for (const name of OPTIONAL) {
    ledger.tools[name] = {
      calls: 0, failures: 0, seenBoots: 9, lastUsedBoot: 0,
      firstSeenAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
    }
  }
  writeFileSync(USAGE_FILE, `${JSON.stringify(ledger, null, 2)}\n`)
  const after = await measure('剪枝后', join(REPO, 'out', 'baseline-after'))

  const savedTools = before.ourToolCount - after.ourToolCount
  const savedTokens = before.ourTokens - after.ourTokens
  process.stdout.write('固定开销（每次请求都付）：\n')
  process.stdout.write(`  剪枝前  工具 ${before.toolCount} 个 / ${before.toolBytes} 字节 ≈ ${before.toolTokens} token\n`)
  process.stdout.write(`  剪枝后  工具 ${after.toolCount} 个 / ${after.toolBytes} 字节 ≈ ${after.toolTokens} token\n`)
  process.stdout.write(`  其中我们的 ${before.ourToolCount} 个工具占 ${before.ourBytes} 字节 ≈ ${before.ourTokens} token\n`)
  process.stdout.write(`  剪枝省下 ${savedTools} 个工具 ≈ ${savedTokens} token / 请求\n`)
  process.stdout.write('（token 按 CJK 1 字≈1、其余 4 字符≈1 折算，仅作量级参考）\n')
} finally {
  if (original === undefined) rmSync(USAGE_FILE, { force: true })
  else writeFileSync(USAGE_FILE, original)
}
