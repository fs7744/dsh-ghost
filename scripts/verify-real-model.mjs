#!/usr/bin/env node
/**
 * 真模型端到端：让真实模型走一遍"看到工具 → 调用 → 写进记忆"。
 *
 * 凭据来自 .env（已 gitignore）：WB_BASE_URL / WB_KEY / WB_MODEL。
 * 这是唯一会花钱的验证脚本，跑一次只发 1~3 个请求。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { boot, stop, login, createTransport } from './lib-driver.mjs'

const REPO = join(import.meta.dirname, '..')
const MEMORY_ROOT = join(REPO, '.ghost', 'memory')

/** 读 .env（不引第三方依赖）。 */
function env() {
  const file = join(REPO, '.env')
  const values = { ...process.env }
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
      if (match !== null) values[match[1]] = match[2]
    }
  }
  return values
}

const config = env()
const baseUrl = config.WB_BASE_URL
const key = config.WB_KEY
const model = config.WB_MODEL ?? 'hy3'
if (baseUrl === undefined || key === undefined) {
  process.stdout.write('缺少 WB_BASE_URL / WB_KEY（写进 .env）\n')
  process.exit(2)
}
// 凭据注入进程环境：宿主启动时由 lib-driver 从模板渲染进 profile 的 patch。
process.env.WB_KEY = key
process.env.WB_BASE_URL = baseUrl
process.env.WB_MODEL = model

// 每次从干净的记忆开始，才能证明是"这次写进去的"
rmSync(MEMORY_ROOT, { recursive: true, force: true })
mkdirSync(MEMORY_ROOT, { recursive: true })

let failures = 0
let server
const started = Date.now()
try {
  server = await boot({ profile: 'p05', fromDefault: false, timeoutMs: 150_000 })
  const session = await login(server.url, 'answer')
  const transport = createTransport({ ...session, onError: error => process.stdout.write(`WARN  ${String(error)}\n`) })

  const created = await transport.call('session/create', { request: { cwd: REPO } })
  const sessionId = created?.sessionId
  process.stdout.write(`会话    ${sessionId}\n`)

  const selected = await transport.call('session/selectModel', { request: { sessionId, provider: 'wb', model } })
  process.stdout.write(`模型    ${JSON.stringify(selected?.selected)}\n`)

  await transport.call('session/prompt', {
    request: {
      requestId: `real-${Date.now()}`,
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: '请用 memory_write 工具记住一条项目约定：这个仓库一律用 pnpm，不要用 npm。来源写 real-model-test。然后告诉我你写了什么。' }],
    },
  })
  process.stdout.write('prompt  已投递（等真实模型响应…）\n')

  // 等记忆条目出现（真实回合可能的耗时：几秒到一两分钟）
  const deadline = Date.now() + 180_000
  let entries = []
  while (Date.now() < deadline) {
    entries = existsSync(join(MEMORY_ROOT, 'entries')) ? readdirSync(join(MEMORY_ROOT, 'entries')).filter(name => name.endsWith('.md')) : []
    if (entries.length > 0) break
    await new Promise(r => setTimeout(r, 1000))
  }

  if (entries.length === 0) {
    failures += 1
    process.stdout.write('FAIL  模型没有写记忆（180s 内 entries/ 为空）\n')
  } else {
    const body = readFileSync(join(MEMORY_ROOT, 'entries', entries[0]), 'utf8')
    process.stdout.write(`PASS  模型写入了记忆：entries/${entries[0]}\n`)
    process.stdout.write('---\n' + body.trim().slice(0, 600) + '\n---\n')
    if (!/pnpm/i.test(body)) {
      failures += 1
      process.stdout.write('FAIL  内容里没有 pnpm\n')
    }
  }
  process.stdout.write(`耗时    ${((Date.now() - started) / 1000).toFixed(1)}s\n`)
} catch (error) {
  failures += 1
  process.stdout.write(`FAIL  ${String(error)}\n`)
} finally {
  if (server !== undefined) await stop(server.child)
}

process.stdout.write(`\n${failures === 0 ? '真模型端到端通过' : `${failures} 项失败`}\n`)
process.exit(failures === 0 ? 0 : 1)
