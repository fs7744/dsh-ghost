/** B3 工具注册表：19 个描述符齐全、参数合规、拒绝时返回人话（含领域原因原样）。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Engine, MemoryRepositories, UserError } from '../src/core/index.ts'
import type { EngineOptions } from '../src/core/index.ts'
import {
  TOOL_DESCRIPTORS, TOOL_NAMES, getTool, invokeTool, SettingsStore, StaticViewReader,
} from '../src/tools/index.ts'
import type { ToolContext } from '../src/tools/index.ts'

/** 全内存的工具上下文：端口用假的，Engine 是真的，拒绝语义才真实。 */
function buildCtx(): { ctx: ToolContext; store: SettingsStore } {
  const repo = new MemoryRepositories()
  const options = {
    repo,
    policy: () => ({
      version: 'v1', paused: false,
      gate: () => ({ admissible: true, strength: 'explicit', basis: { via: 'addressed', addressed: 'mention' } }),
      revalidate: () => true, admitsInferred: () => true, evalTimeoutMs: 1000,
    }),
    scope: { scope: () => ({ listened: true, observed: false }) },
    assessor: { request: () => {} },
    executor: { start: () => {}, deliver: () => {}, stop: () => {} },
    outbox: { send: () => {}, status: () => undefined, withdraw: () => {} },
    now: () => '2026-02-01T00:00:00.000Z',
  } as unknown as EngineOptions
  const engine = new Engine(options)
  const store = new SettingsStore({ now: () => '2026-02-01T00:00:00.000Z' })
  const ctx: ToolContext = {
    repo, engine, config: store,
    views: new StaticViewReader({ overview: '[overview] 当前没有需要人处理的票' }),
  }
  return { ctx, store }
}

test('19 个工具名齐全且无重复', () => {
  assert.equal(TOOL_NAMES.length, 19)
  assert.equal(new Set(TOOL_NAMES).size, 19)
  assert.equal(TOOL_DESCRIPTORS.length, 19)
  for (const name of TOOL_NAMES) assert.ok(name.startsWith('orchestrator_'))
})

test('描述符合规：说明书 <=120 字符、object 参数、handler 可调用', () => {
  for (const descriptor of TOOL_DESCRIPTORS) {
    assert.ok(descriptor.description.length > 0 && descriptor.description.length <= 120, descriptor.name)
    assert.equal(descriptor.parameters.type, 'object', descriptor.name)
    assert.equal(typeof descriptor.handler, 'function', descriptor.name)
  }
})

test('getTool 命中与 invokeTool 未知工具都给确定结果', () => {
  const { ctx } = buildCtx()
  assert.equal(getTool('orchestrator_read')?.name, 'orchestrator_read')
  assert.equal(getTool('orchestrator_nope'), undefined)
  assert.match(invokeTool('orchestrator_nope', {}, ctx), /没有名为 orchestrator_nope 的工具/)
})

test('orchestrator_read 命中与未命中视图都回人话', () => {
  const { ctx } = buildCtx()
  assert.match(invokeTool('orchestrator_read', { view: 'overview' }, ctx), /\[overview\]/)
  const text = invokeTool('orchestrator_read', { view: 'nope' }, ctx)
  assert.match(text, /没有名为 nope 的视图/)
  assert.match(text, /overview \/ tickets \/ records/)
})

test('orchestrator_settings_save 成功写进配置仓', () => {
  const { ctx, store } = buildCtx()
  const text = invokeTool('orchestrator_settings_save', { block: 'executor', values: { concurrency: 2 } }, ctx)
  assert.match(text, /已保存配置块 executor/)
  assert.deepEqual(store.read('executor'), { concurrency: 2 })
  assert.equal(store.writes.length, 1)
})

test('拒绝时把 unknownBlock 的原因原样返回让模型自愈', () => {
  const { ctx } = buildCtx()
  const expected = new UserError('unknownBlock', { block: 'weird' }).message
  assert.equal(invokeTool('orchestrator_settings_save', { block: 'weird', values: {} }, ctx), expected)
  assert.match(expected, /Unknown settings block: weird/)
})

test('拒绝时把 unknownTicket 的原因原样返回', () => {
  const { ctx } = buildCtx()
  assert.equal(
    invokeTool('orchestrator_ticket_retry', { ticketId: 'missing' }, ctx),
    new UserError('unknownTicket').message,
  )
})

test('orchestrator_prompts_save 缺占位符与空正文都被拒绝并给原因', () => {
  const { ctx } = buildCtx()
  const missing = invokeTool('orchestrator_prompts_save', { id: 'handoff', text: '没有任何占位符' }, ctx)
  assert.match(missing, /must keep/)
  assert.match(missing, /\{\{ticket\}\}/)
  assert.match(invokeTool('orchestrator_prompts_save', { id: 'shared', text: '   ' }, ctx), /cannot be empty/)
})

test('orchestrator_policy_sync 推进版本并通知引擎', () => {
  const { ctx, store } = buildCtx()
  assert.match(invokeTool('orchestrator_policy_sync', {}, ctx), /v1 同步到 v2/)
  assert.equal(store.writes.length, 0) // 走版本推进，不写配置块
})

test('参数缺失时回人话提示，不抛异常', () => {
  const { ctx } = buildCtx()
  assert.match(invokeTool('orchestrator_ack', { ticketId: 't1' }, ctx), /缺少/)
  assert.match(invokeTool('orchestrator_settings_save', { block: 'policy', values: 'not-object' }, ctx), /values 必须是一个对象/)
  assert.match(invokeTool('orchestrator_eval_read', {}, ctx), /需要 thread/)
})

test('19 个 handler 用空参数调用都返回非空人话文本', () => {
  const { ctx } = buildCtx()
  for (const name of TOOL_NAMES) {
    const text = invokeTool(name, {}, ctx)
    assert.equal(typeof text, 'string', `${name} 未返回字符串`)
    assert.ok(text.length > 0, `${name} 返回空文本`)
  }
})

test('SettingsStore 快照/恢复：settings、policy、prompts 能活过重启', () => {
  const store = new SettingsStore({ now: () => '2026-02-01T00:00:00.000Z' })
  store.save('policy', { paused: true })
  const bump = store.syncPolicy()
  store.savePrompt('work', '{{ticket}} 按流程做，别跳步')
  const snapshot = JSON.parse(JSON.stringify(store.snapshot())) as unknown

  const restored = new SettingsStore()
  restored.restore(snapshot)
  assert.deepEqual(restored.read('policy'), { paused: true })
  assert.equal(restored.snapshot().policyVersion, bump.to)
  assert.deepEqual(restored.prompts(), ['work'])

  // 坏快照整体忽略，不把内存配置清成半截。
  restored.restore({ blocks: 'not-an-object', prompts: ['nope'] })
  assert.deepEqual(restored.read('policy'), { paused: true })
})

test('配置拒写明文密钥：只能指向环境变量', () => {
  const store = new SettingsStore({ now: () => '2026-02-01T00:00:00.000Z' })
  assert.throws(
    () => store.save('accounts', { github: { token: 'ghp_abcdef123456' } }),
    (error: unknown) => {
      assert.ok(error instanceof UserError)
      assert.equal(error.code, 'plainSecret')
      assert.match(error.message, /tokenEnv/)
      return true
    },
  )
  // 指向环境变量的写法允许。
  store.save('accounts', { github: { tokenEnv: 'GITHUB_TOKEN' } })
  assert.equal(store.read('accounts')?.['github'] !== undefined, true)
})
