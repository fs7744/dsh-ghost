#!/usr/bin/env node
/**
 * 外部 agent（peer）验收：
 *  1. 登记一个**假 peer**（用 node 当命令行 agent）→ 宿主里能读到；
 *  2. 模型侧能看到 agent_peers / agent_delegate 两个工具；
 *  3. 真的把任务交给这个 peer 并拿到产出（走宿主里的工具执行路径）。
 *
 * 不需要任何 key：假 Messages 端点记录请求并回一个脚本化的 tool_use。
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { boot, stop, login, createTransport } from './lib-driver.mjs'

const HERE = import.meta.dirname
const REPO = join(HERE, '..')
const CAPTURE = join(REPO, 'out', 'fake-messages-peers')

let failures = 0
const check = (ok, message) => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${message}\n`)
  if (!ok) failures += 1
}

const freePort = () => new Promise(resolve => {
  const server = createServer()
  server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)) })
})
const sleep = ms => new Promise(r => setTimeout(r, ms))

const port = await freePort()
rmSync(CAPTURE, { recursive: true, force: true })
mkdirSync(CAPTURE, { recursive: true })

const fake = spawn(process.execPath, [
  join(REPO, 'spikes', 'p05-transport', 'fake-messages.mjs'), '--port', String(port), '--out', CAPTURE,
], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, FAKE_TOOL: 'agent_peers' },
})
await sleep(700)

const patch = [
  '- insert:',
  '    - id: ghost-memory',
  "      name: '@dsh-ghost/memory-plugin'",
  '      config:',
  `        root: '${join(REPO, '.ghost', 'memory').replace(/\\/g, '/')}'`,
  '    - id: ghost-peers',
  "      name: '@dsh-ghost/peer-agent-plugin'",
  '      config:',
  `        stateDir: '${join(REPO, '.ghost').replace(/\\/g, '/')}'`,
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

  // 1) 登记假 peer（node 当命令行 agent：把提示词回显出来）
  const saved = await transport.call('ghostPeers/save', {
    input: { peers: [{
      id: 'fake-peer',
      label: '假同事',
      kind: 'cli',
      command: process.execPath,
      args: ['-e', 'process.stdout.write("同事产出:" + process.argv[1])', '{prompt}'],
      description: '把任务原样回显，用来验证协作链路。',
    }] },
  })
  check(saved?.ok === true, `登记 peer 成功：${JSON.stringify(saved).slice(0, 120)}`)

  const listed = await transport.call('ghostPeers/list', {})
  const peers = Array.isArray(listed?.peers) ? listed.peers : []
  check(peers.some(peer => peer.id === 'fake-peer'), '宿主里能读到登记的 peer')

  // 2) 模型侧能看到两个工具
  const created = await transport.call('session/create', { request: { cwd: join(REPO, 'spikes', 'p05-transport', '.workspace') } })
  await transport.call('session/selectModel', { request: { sessionId: created?.sessionId, provider: 'mock', model: 'mock-1' } })
  await transport.call('session/prompt', {
    request: {
      requestId: `req-${Date.now()}`,
      sessionId: created?.sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: '有哪些同事可以用？' }],
    },
  })
  const deadline = Date.now() + 30_000
  let files = []
  while (Date.now() < deadline) {
    files = readdirSync(CAPTURE).filter(name => name.endsWith('.json')).sort()
    if (files.length > 0) break
    await sleep(400)
  }
  if (files.length === 0) {
    check(false, '没抓到模型请求')
  } else {
    const payload = JSON.parse(readFileSync(join(CAPTURE, files[0]), 'utf8'))
    const names = (payload.tools ?? []).map(tool => tool.name)
    check(names.includes('agent_peers'), '模型侧看到了 agent_peers 工具')
    check(names.includes('agent_delegate'), '模型侧看到了 agent_delegate 工具')
  }

  // 3) 真把任务交给 peer（直接用包里的 runPeer，验证执行路径）
  const { runPeer } = await import('../packages/peer-agent/lib/index.js')
  const result = await runPeer(peers[0], '做一件事', { timeoutMs: 20_000 })
  check(result.ok === true && result.output.includes('同事产出'), `peer 执行成功：${result.output.slice(0, 80)}`)
} catch (error) {
  check(false, `验收出错：${String(error).slice(0, 300)}`)
} finally {
  if (server !== undefined) await stop(server.child)
  fake.kill()
  rmSync(join(REPO, '.ghost', 'peers.json'), { force: true })
}

process.stdout.write(`\n${failures === 0 ? '外部 agent 验收通过' : `${failures} 项失败`}\n`)
process.exit(failures === 0 ? 0 : 1)
