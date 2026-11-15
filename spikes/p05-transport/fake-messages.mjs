#!/usr/bin/env node
/**
 * 假的 Anthropic Messages 端点：只做两件事——**记录请求**、**回一个脚本化响应**。
 *
 * 用途：不需要任何模型 key，就能验证"模型侧收到的请求里到底有没有我们的工具"。
 * 第一轮回 `memory_list` 的 tool_use；拿到工具结果后的第二轮回一段文本结束回合。
 *
 * 用法: node fake-messages.mjs [--port 8899] [--out <dir>]
 */
import { createServer } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : fallback
}
const port = Number(argOf('--port', '8899'))
const outDir = resolve(argOf('--out', join(import.meta.dirname, '..', '..', 'out', 'fake-messages')))
mkdirSync(outDir, { recursive: true })

let count = 0

/** 一条 SSE 事件。 */
const event = (name, payload) => `event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`

/** 组装一个完整的 Anthropic 流式响应。 */
function stream(contentBlocks, stopReason) {
  const parts = [
    event('message_start', {
      type: 'message_start',
      message: { id: 'msg_mock', type: 'message', role: 'assistant', content: [], model: 'mock-1', stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } },
    }),
  ]
  contentBlocks.forEach((block, index) => {
    parts.push(event('content_block_start', { type: 'content_block_start', index, content_block: block.type === 'tool_use'
      ? { type: 'tool_use', id: block.id, name: block.name, input: {} }
      : { type: 'text', text: '' } }))
    parts.push(event('content_block_delta', index === 0
      ? { type: 'content_block_delta', index, delta: block.type === 'tool_use'
        ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input ?? {}) }
        : { type: 'text_delta', text: block.text ?? '' } }
      : { type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text ?? '' } }))
    parts.push(event('content_block_stop', { type: 'content_block_stop', index }))
  })
  parts.push(event('message_delta', { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 8 } }))
  parts.push(event('message_stop', { type: 'message_stop' }))
  return parts.join('')
}

const server = createServer((request, response) => {
  if (request.method !== 'POST') {
    response.writeHead(404).end('not found')
    return
  }
  let body = ''
  request.on('data', chunk => { body += chunk })
  request.on('end', () => {
    count += 1
    let payload = {}
    try { payload = JSON.parse(body) } catch { /* 记录原文 */ }
    writeFileSync(join(outDir, `request-${String(count).padStart(2, '0')}.json`), JSON.stringify(payload, null, 2))

    const hasToolResult = JSON.stringify(payload.messages ?? []).includes('tool_result')
    const tools = Array.isArray(payload.tools) ? payload.tools.map(tool => tool.name) : []
    process.stdout.write(`req#${count}  tools=[${tools.join(',')}]  toolResult=${hasToolResult}\n`)

    // 第一轮：要求调用 memory_list。第二轮（已有工具结果）：结束。
    const blocks = hasToolResult
      ? [{ type: 'text', text: '已查看记忆。' }]
      : tools.includes('memory_list')
        ? [{ type: 'tool_use', id: 'toolu_mock_1', name: 'memory_list', input: {} }]
        : [{ type: 'text', text: '没有 memory_list 工具可用。' }]

    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
    response.end(stream(blocks, hasToolResult ? 'end_turn' : 'tool_use'))
  })
})

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`fake-messages listening on http://127.0.0.1:${port}（请求记录到 ${outDir}）\n`)
})
