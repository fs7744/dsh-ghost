#!/usr/bin/env node
/**
 * 工具可见性验收：用假 Messages 端点跑**一个真实回合**，看模型侧收到的请求里有没有我们的工具。
 *
 * 这是整条链的最后一环：
 *   插件注册工具 → harness 组请求 → 模型侧看到 tools[] → 模型要求调用 → 工具执行 → 结果回传
 *
 * 不需要任何 key：fake-messages.mjs 记录请求并回一个脚本化的 tool_use。
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { boot, stop, login, createTransport } from './lib-driver.mjs'

const HERE = import.meta.dirname
const REPO = join(HERE, '..')
const DSH_HOME = join(REPO, 'spikes', 'p05-transport', '.dsh-home')
const PROFILE_DIR = join(DSH_HOME, 'profiles', 'p05')
const CAPTURE = join(REPO, 'out', 'fake-messages')

const freePort = () => new Promise(resolve => {
  const server = createServer()
  server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)) })
})
const sleep = ms => new Promise(r => setTimeout(r, ms))

const port = await freePort()
rmSync(CAPTURE, { recursive: true, force: true })
mkdirSync(CAPTURE, { recursive: true })

// 1) 起假端点
const fake = spawn(process.execPath, [join(REPO, 'spikes', 'p05-transport', 'fake-messages.mjs'), '--port', String(port), '--out', CAPTURE], { stdio: ['ignore', 'pipe', 'pipe'] })
let fakeLogs = ''
fake.stdout.on('data', chunk => { fakeLogs += chunk.toString() })
fake.stderr.on('data', chunk => { fakeLogs += chunk.toString() })
await sleep(700)

// 2) 把 mock 路由写进 profile 的 patch（base 的 llm-pi-ai 行是 dormant：零路由）
writeFileSync(join(PROFILE_DIR, 'cordis.patch.yml'), [
  '# dsh-ghost 的插件层（由 verify-tool-visibility.mjs 生成）',
  '- insert:',
  '    - id: ghost-memory',
  "      name: '@dsh-ghost/memory-plugin'",
  '      config:',
  `        root: '${join(REPO, '.ghost', 'memory').replace(/\\/g, '/')}'`,
  '',
  '# 给 pi-ai 加一条 mock 路由',
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
  '',
].join('\n'))

process.env.MOCK_KEY = 'mock-key'

let failures = 0
let server
try {
  server = await boot({ profile: 'p05', fromDefault: false })
  const session = await login(server.url, 'none')
  const transport = createTransport({ ...session, onError: error => process.stdout.write(`WARN  ${String(error)}\n`) })

  const created = await transport.call('session/create', { request: { cwd: join(REPO, 'spikes', 'p05-transport', '.workspace') } })
  process.stdout.write(`会话    ${created?.sessionId}\n`)

  const selected = await transport.call('session/selectModel', { request: { sessionId: created?.sessionId, provider: 'mock', model: 'mock-1' } })
  process.stdout.write(`模型    ${JSON.stringify(selected?.selected)}\n`)

  await transport.call('session/prompt', {
    request: {
      requestId: `req-${Date.now()}`,
      sessionId: created?.sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: '看看记忆里有什么' }],
    },
  })
  process.stdout.write('prompt  已投递，等待模型侧请求…\n')

  // 3) 等抓包文件出现
  const deadline = Date.now() + 40_000
  let files = []
  while (Date.now() < deadline) {
    files = readdirSync(CAPTURE).filter(name => name.endsWith('.json')).sort()
    if (files.length > 0) break
    await sleep(500)
  }

  if (files.length === 0) {
    failures += 1
    process.stdout.write('FAIL  模型侧没有收到任何请求\n')
    process.stdout.write(fakeLogs.slice(-600) + '\n')
  } else {
    const first = JSON.parse(readFileSync(join(CAPTURE, files[0]), 'utf8'))
    const toolNames = (first.tools ?? []).map(tool => tool.name)
    const ours = toolNames.filter(name => name.startsWith('memory_'))
    process.stdout.write(`请求    ${files.length} 次；tools 共 ${toolNames.length} 个\n`)
    process.stdout.write(`工具    ${toolNames.slice(0, 12).join(', ')}${toolNames.length > 12 ? ' …' : ''}\n`)
    if (ours.length === 3) {
      process.stdout.write(`PASS  模型侧看到我们的三个工具：${ours.join(', ')}\n`)
    } else {
      failures += 1
      process.stdout.write(`FAIL  我们的工具只出现 ${ours.length}/3：${ours.join(', ') || '(无)'}\n`)
    }
    await sleep(2500)
    // 找"带了工具结果"的那一轮——注意中间可能夹着别的请求（如标题生成）。
    const all = readdirSync(CAPTURE).filter(name => name.endsWith('.json')).sort()
    const withResult = all
      .map(name => JSON.parse(readFileSync(join(CAPTURE, name), 'utf8')))
      .filter(payload => JSON.stringify(payload.messages ?? []).includes('tool_result'))
    if (withResult.length === 0) {
      failures += 1
      process.stdout.write(`FAIL  没有任何一轮请求带回工具结果（共 ${all.length} 次请求）\n`)
    } else {
      const payload = withResult[0]
      const calledMemory = JSON.stringify(payload.messages ?? []).includes('memory_list')
      process.stdout.write(`${calledMemory ? 'PASS' : 'FAIL'}  工具被调用且结果回传：${calledMemory ? 'memory_list' : '未包含 memory_list'}\n`)
      if (!calledMemory) failures += 1
    }
  }
} catch (error) {
  failures += 1
  process.stdout.write(`FAIL  ${String(error)}\n`)
} finally {
  if (server !== undefined) await stop(server.child)
  fake.kill()
}

process.stdout.write(`\n${failures === 0 ? '工具可见性验收通过' : `${failures} 项失败`}\n`)
process.exit(failures === 0 ? 0 : 1)
