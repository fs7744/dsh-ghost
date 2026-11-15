#!/usr/bin/env node
/**
 * P1 验收：用"生成出来的元数据"调通真实端点，而不是手拼 JSON。
 *
 * 依赖 harness-contract/remotes.json（由 gen-remotes.mjs 从 typert descriptor 生成）。
 * 这里不写死任何 wire 名——参数骨架从描述符里读。
 */
import { readFileSync } from 'node:fs'
import { boot, connect, rpc, stop } from './lib/harness-client.mjs'

const contract = JSON.parse(readFileSync(new URL('../../harness-contract/remotes.json', import.meta.url), 'utf8'))
const byEndpoint = new Map(contract.remotes.map(remote => [remote.endpoint, remote]))

/** 按描述符构造最小参数骨架：必填对象参数给 {}，可选参数跳过。 */
function skeleton(endpoint) {
  const remote = byEndpoint.get(endpoint)
  if (!remote) throw new Error(`描述符里没有 ${endpoint}（先跑 gen-remotes.mjs）`)
  const args = {}
  for (const parameter of remote.parameters) {
    if (parameter.optional) continue
    args[parameter.wire] = {}
  }
  return args
}

const targets = ['session/list', 'session/modelCatalog']
const results = []

const server = await boot()
try {
  const session = await connect(server.url)
  process.stdout.write(`boot  ${server.url.replace(/token=[\w.-]+/, 'token=***')}\n`)
  process.stdout.write(`contract  ${contract.endpoints} 个端点，来自 ${contract.packages} 个包\n\n`)

  for (const endpoint of targets) {
    const args = skeleton(endpoint)
    const started = Date.now()
    const value = await rpc(session, endpoint, args)
    const summary = Array.isArray(value?.items)
      ? `items=${value.items.length}`
      : value === undefined ? 'void' : `keys=${Object.keys(value).slice(0, 5).join(',')}`
    results.push({ endpoint, ok: true, args, ms: Date.now() - started, summary })
    process.stdout.write(`PASS  ${endpoint.padEnd(22)} args=${JSON.stringify(args)}  ${summary}  ${Date.now() - started}ms\n`)
  }
} catch (error) {
  results.push({ endpoint: '(fatal)', ok: false, error: String(error) })
  process.stdout.write(`FAIL  ${String(error)}\n`)
} finally {
  await stop(server.child)
}

const failed = results.filter(r => !r.ok).length
process.stdout.write(`\n${results.length - failed}/${results.length} 通过（全程未加载任何 harness 前端包）\n`)
process.exit(failed === 0 ? 0 : 1)
