/** 编排插件：拉取型信息源能真的把 API 响应变成票。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
// src 里有装饰器语法，Node 直接跑不了；先编译（test 脚本会先 tsc）。
import { apply } from '../lib/index.js'

function fakeContext() {
  const registered = []
  const ctx = {
    tools: { register: (definition) => { registered.push(definition); return () => {} } },
    effect: (factory) => { factory(); return () => {} },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  }
  return { ctx: ctx as unknown as Context, registered }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

test('拉取型来源：定时打 API，把响应喂成票', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ghost-orch-'))
  const stateFile = join(root, 'tickets.json')
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify({
    items: [
      { id: 'issue-1', title: '构建挂了' },
      { id: 'issue-2', title: '文档过期' },
    ],
  }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch
  try {
    const { ctx } = fakeContext()
    apply(ctx, {
      stateFile,
      sources: [{
        id: 'issues',
        kind: 'api',
        pull: { url: 'https://example.test/issues', intervalSeconds: 1, listPath: 'items' },
        mapping: { fields: { threadId: '{{id}}', text: '{{title}}' } },
      }],
    })
    await sleep(1500)
    const state = JSON.parse(await readFile(stateFile, 'utf8'))
    assert.ok(Array.isArray(state.tickets))
    assert.ok(state.tickets.length >= 1, '拉到的数据应该变成票')
    assert.match(JSON.stringify(state.tickets), /构建挂了/)
  } finally {
    globalThis.fetch = originalFetch
  }
})
