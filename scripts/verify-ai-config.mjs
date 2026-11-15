#!/usr/bin/env node
/**
 * 验收「程序内的 AI 能不能直接改配置」+「明文密钥会不会被拒」。
 *
 * 真跑一遍：假模型按脚本调我们的配置工具 →
 *   1) 写一个正常配置块 → 必须落盘到 orchestrator-settings.json；
 *   2) 再写一次带明文 token 的配置 → 必须被拒，且密钥不落盘、不进上下文。
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { boot, stop, login, createTransport } from './lib-driver.mjs'

const REPO = join(import.meta.dirname, '..')
const CAPTURE = join(REPO, 'out', 'ai-config-capture')
const STATE = join(REPO, '.ghost', 'tmp-ai-config-tickets.json')
const SETTINGS = join(REPO, '.ghost', 'orchestrator-settings.json')
const SECRET = 'ghp_plaintext_should_never_persist'

const freePort = () => new Promise(resolve => {
  const server = createServer()
  server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)) })
})
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

let failures = 0
const check = (ok, message) => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${message}\n`)
  if (!ok) failures += 1
}

const port = await freePort()
rmSync(CAPTURE, { recursive: true, force: true })
mkdirSync(CAPTURE, { recursive: true })
rmSync(SETTINGS, { force: true })

const fake = spawn(process.execPath, [
  join(REPO, 'spikes', 'p05-transport', 'fake-messages.mjs'), '--port', String(port), '--out', CAPTURE,
], {
  stdio: 'ignore',
  env: {
    ...process.env,
    FAKE_TOOL: 'orchestrator_settings_save',
    FAKE_ARGS: JSON.stringify({ block: 'policy', values: { note: 'ai-edited' } }),
    FAKE_TOOL2: 'orchestrator_settings_save',
    FAKE_ARGS2: JSON.stringify({ block: 'accounts', values: { github: { token: SECRET } } }),
  },
})

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
  const transport = createTransport({ ...session, onError: error => process.stdout.write(`WARN  ${String(error)}\n`) })
  const created = await transport.call('session/create', { request: { cwd: join(REPO, 'spikes', 'p05-transport', '.workspace') } })
  await transport.call('session/selectModel', { request: { sessionId: created?.sessionId, provider: 'mock', model: 'mock-1' } })
  await transport.call('session/prompt', {
    request: {
      requestId: `req-${Date.now()}`,
      sessionId: created?.sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: '帮我把配置改一下' }],
    },
  })

  const deadline = Date.now() + 40_000
  let files = []
  while (Date.now() < deadline) {
    files = readdirSync(CAPTURE).filter(name => name.endsWith('.json')).sort()
    if (files.length >= 3) break
    await sleep(500)
  }
  check(files.length >= 2, `模型侧至少跑了两轮（实际 ${files.length} 轮）`)

  const captured = files.map(name => readFileSync(join(CAPTURE, name), 'utf8'))
  const joined = captured.join('\n')
  check(joined.includes('orchestrator_settings_save'), '模型侧看到了 orchestrator_settings_save 工具')

  const saved = existsSync(SETTINGS) ? readFileSync(SETTINGS, 'utf8') : ''
  check(saved.includes('ai-edited'), 'AI 写的配置落盘了（重启也不丢）')
  check(!saved.includes(SECRET), '明文密钥没有落盘')
  check(joined.includes('plaintext secret'), '明文密钥被拒绝，并给了人话原因')
  // 模型自己发出的 tool_use 参数里当然带着它（那是模型产的），
  // 但**工具结果**不能把它再吐回上下文。
  const toolResults = captured.flatMap(raw => {
    const payload = JSON.parse(raw)
    const texts = []
    for (const message of payload.messages ?? []) {
      for (const part of message.content ?? []) {
        if (part?.type === 'tool_result') texts.push(JSON.stringify(part))
      }
    }
    return texts
  })
  check(toolResults.length > 0, `抓到了工具结果（${toolResults.length} 条）`)
  check(!toolResults.some(text => text.includes(SECRET)), '工具结果里没有回显明文密钥')
} catch (error) {
  failures += 1
  process.stdout.write(`FAIL  ${String(error)}\n`)
} finally {
  if (server !== undefined) await stop(server.child)
  fake.kill()
  rmSync(STATE, { force: true })
}

process.stdout.write(`\n${failures === 0 ? 'AI 改配置验收通过' : `${failures} 项失败`}\n`)
process.exit(failures === 0 ? 0 : 1)
