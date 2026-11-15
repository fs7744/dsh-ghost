/** B2 三个入口装配层：清单、分工、工具 / Remote / 触发源注册、飞书默认关闭。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryRepositories } from '../src/core/index.ts'
import {
  createAssembly, install, MANAGEMENT_REMOTES, DIVISION_NOTE,
  mainName, githubWatchName, feishuWatchName,
  createGithubWatchAssembly, createFeishuWatchAssembly,
  applyGithubWatch, applyFeishuWatch,
} from '../src/app/host/index.ts'
import type { HostContext, AssemblyDeps } from '../src/app/host/index.ts'

function fakeCtx() {
  const tools: Array<{ name: string; description: string; execute: (args: Record<string, unknown>) => string }> = []
  const remotes: string[] = []
  const sources: Array<{ id: string; kind: string }> = []
  const logs: string[] = []
  const ctx: HostContext = {
    logger: { info: (...args) => { logs.push(args.map(String).join(' ')) }, warn: (...args) => { logs.push(args.map(String).join(' ')) } },
    registerTool: tool => { tools.push(tool) },
    registerRemote: name => { remotes.push(name) },
    registerSource: spec => { sources.push({ id: spec.id, kind: spec.kind }) },
  }
  return { ctx, tools, remotes, sources, logs }
}
function deps(): AssemblyDeps {
  return { repo: new MemoryRepositories(), engine: {} as never }
}

test('createAssembly 产出 11 inject / 19 工具 / 7 视图 / 完整 Remote 清单', () => {
  const manifest = createAssembly({})
  assert.equal(manifest.plugin, 'dsh-superagent')
  assert.equal(manifest.inject.length, 11)
  assert.equal(manifest.tools.length, 19)
  assert.equal(manifest.views.length, 7)
  assert.ok(manifest.remotes.length >= 17)
})

test('分工说明点名 orchestrator-plugin 且明确不重复挂 Engine', () => {
  assert.match(DIVISION_NOTE, /orchestrator-plugin/)
  assert.match(DIVISION_NOTE, /不 new Engine/)
  assert.match(createAssembly({}).division, /注入同一份/)
})

test('三个入口的插件 id 与账本一致', () => {
  assert.equal(mainName, 'dsh-superagent')
  assert.equal(githubWatchName, 'dsh-superagent/github-watch')
  assert.equal(feishuWatchName, 'dsh-superagent/feishu-watch')
})

test('GitHub 源默认启用，飞书源默认关闭', () => {
  assert.equal(createGithubWatchAssembly().enabled, true)
  assert.equal(createFeishuWatchAssembly().enabled, false)
})

test('飞书 spec 用声明式 generic 映射且没有明文密钥', () => {
  const assembly = createFeishuWatchAssembly()
  assert.equal(assembly.spec.kind, 'generic')
  assert.equal(assembly.spec.auth?.type, 'hmac')
  assert.equal(assembly.spec.auth?.type === 'hmac' && assembly.spec.auth.secretEnv, 'FEISHU_WEBHOOK_SECRET')
  assert.ok(!JSON.stringify(assembly.spec).includes('secret:'))
})

test('管理面 Remote 清单覆盖四组已有端点与两组新增端点', () => {
  for (const prefix of ['ghostTickets/', 'ghostSources/', 'ghostMemory/', 'ghostEvolution/', 'ghostViews/', 'ghostTools/']) {
    assert.ok(MANAGEMENT_REMOTES.some(remote => remote.startsWith(prefix)), `缺 ${prefix}`)
  }
})

test('install 把 19 个工具与 2 个新增 Remote 注册到可注入的 HostContext', () => {
  const h = fakeCtx()
  const manifest = install(h.ctx, deps(), {})
  assert.equal(h.tools.length, 19)
  assert.deepEqual(h.remotes, ['ghostViews', 'ghostTools'])
  assert.equal(manifest.tools.length, 19)
  assert.ok(h.tools.every(tool => tool.description.length <= 120))
})

test('install 注册的工具能被就地调用并返回人话', () => {
  const h = fakeCtx()
  install(h.ctx, deps(), {})
  const read = h.tools.find(tool => tool.name === 'orchestrator_read')
  assert.ok(read)
  assert.match(read!.execute({ view: 'overview' }), /\[overview\]/)
})

test('install 只注册启用的触发源', () => {
  const h = fakeCtx()
  const gh = createGithubWatchAssembly()
  const fs = createFeishuWatchAssembly()
  install(h.ctx, deps(), {
    sources: [gh.spec, fs.spec],
    enabledSources: { github: true, feishu: false },
  })
  assert.equal(h.sources.length, 1)
  assert.equal(h.sources[0]?.id, 'github')
})

test('applyFeishuWatch 默认不注册，显式启用才注册', () => {
  const h = fakeCtx()
  const off = applyFeishuWatch(h.ctx)
  assert.equal(off.enabled, false)
  assert.equal(h.sources.length, 0)
  const on = applyFeishuWatch(h.ctx, { enabled: true })
  assert.equal(on.enabled, true)
  assert.equal(h.sources.length, 1)
  assert.equal(h.sources[0]?.kind, 'generic')
})

test('applyGithubWatch 把内置适配器 spec 交给注册表', () => {
  const h = fakeCtx()
  const assembly = applyGithubWatch(h.ctx)
  assert.equal(assembly.enabled, true)
  assert.equal(h.sources.length, 1)
  assert.equal(h.sources[0]?.id, 'github')
  assert.deepEqual(assembly.remotes, ['ghostSources/ingest'])
})
