/**
 * 脚本共享纯逻辑单测（scripts/lib-models.mjs）：故障模式、回放规范化、
 * 门禁汇总、升级计划、port 违规检出、结构断言与评分。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FAULT_MODES, selectFaultMode, normalizeRecord, stableStringify, diffRecords, parseJsonl,
  summarizeGates, buildUpgradePlan, UPGRADE_STEP_IDS, validateVersion, rewritePackageVersions,
  classifyImports, evaluateStructure, scoreEvals,
} from '../../scripts/lib-models.mjs'

test('FAULT_MODES 共 7 种且缺省 normal', () => {
  assert.equal(FAULT_MODES.length, 7)
  assert.deepEqual(selectFaultMode(), { mode: 'normal', source: 'default' })
  for (const mode of FAULT_MODES) assert.equal(selectFaultMode({ header: mode })?.mode, mode)
})

test('selectFaultMode 优先级 header > path > query', () => {
  assert.deepEqual(selectFaultMode({ header: 'timeout', path: '/fault/http500/v1/chat', query: { fault: 'bad-json' } }),
    { mode: 'timeout', source: 'header' })
  assert.deepEqual(selectFaultMode({ path: '/fault/http429/v1/models', query: { fault: 'bad-json' } }),
    { mode: 'http429', source: 'path' })
  assert.deepEqual(selectFaultMode({ query: { fault: 'truncated' } }), { mode: 'truncated', source: 'query' })
})

test('selectFaultMode 拒绝未知模式，不静默降级', () => {
  assert.equal(selectFaultMode({ header: 'nope' }), null)
  assert.equal(selectFaultMode({ path: '/fault/nope/v1/chat' }), null)
  assert.equal(selectFaultMode({ query: { fault: 'NOPE' } }), null)
})

test('normalizeRecord 去掉时间/id/token/耗时且键顺序无关', () => {
  const a = normalizeRecord({ id: 'a', at: 1, tokens: 9, usage: { total_tokens: 5 }, kind: 'tool', args: { b: 2, a: 1 } })
  const b = normalizeRecord({ args: { a: 1, b: 2 }, kind: 'tool', id: 'b', at: 999, durationMs: 3 })
  assert.equal(stableStringify(a), stableStringify(b))
  assert.deepEqual(a, { kind: 'tool', args: { a: 1, b: 2 } })
})

test('stableStringify 数组保序、对象键排序', () => {
  assert.equal(stableStringify({ b: 1, a: 2 }), '{"a":2,"b":1}')
  assert.equal(stableStringify([3, 1, 2]), '[3,1,2]', '数组顺序是语义，不能排序')
  assert.equal(stableStringify({ z: { b: 1, a: 2 } }), '{"z":{"a":2,"b":1}}')
})

test('diffRecords 易变字段与键顺序变化仍相等', () => {
  const expected = '{"id":"a","at":1,"tokens":10,"kind":"tool","args":{"b":2,"a":1}}\n'
  const actual = '{"args":{"a":1,"b":2},"kind":"tool","id":"b","at":9,"tokens":99,"durationMs":7}\n'
  const result = diffRecords(expected, actual)
  assert.equal(result.equal, true, JSON.stringify(result.diffs))
  assert.equal(result.compared, 1)
})

test('diffRecords 语义差异 / 缺行 / 多出都失败', () => {
  const base = '{"kind":"tool","value":1}\n{"kind":"end"}\n'
  assert.equal(diffRecords(base, '{"kind":"other","value":1}\n{"kind":"end"}\n').equal, false)
  assert.equal(diffRecords(base, '{"kind":"tool","value":1}\n').equal, false)
  assert.equal(diffRecords(base, base + '{"kind":"extra"}\n').equal, false)
  assert.equal(parseJsonl('not json\n').errors.length, 1)
  assert.equal(diffRecords('not json\n', base).equal, false)
})

test('summarizeGates 汇总成表并给出正确 exitCode', () => {
  const pass = summarizeGates([{ name: 'typecheck', ok: true }, { name: 'test', ok: true, detail: '133 用例' }])
  assert.equal(pass.allPass, true)
  assert.equal(pass.exitCode, 0)
  assert.equal(pass.passed, 2)
  assert.match(pass.table, /PASS/)
  const fail = summarizeGates([{ name: 'check:ui', ok: false, detail: '类型错误' }])
  assert.equal(fail.allPass, false)
  assert.equal(fail.exitCode, 1)
  assert.equal(fail.failed, 1)
  assert.match(fail.table, /FAIL/)
  assert.equal(summarizeGates([]).exitCode, 0)
})

test('buildUpgradePlan 固定 8 步顺序且标出落盘步骤', () => {
  const plan = buildUpgradePlan('0.2.3')
  assert.deepEqual(plan.steps.map(step => step.id), UPGRADE_STEP_IDS)
  assert.equal(plan.steps.length, 8)
  assert.equal(plan.steps[0]?.id, 'change-version')
  assert.equal(plan.steps[7]?.id, 'write-matrix')
  // 第 3 步在 --apply 下会重生成 remotes/events 两个生成物，属于落盘步骤。
  assert.deepEqual(plan.steps.filter(step => step.mutates).map(step => step.id), ['change-version', 'verify-contract', 'write-matrix'])
  assert.ok(plan.steps.every(step => typeof step.portHint === 'string' && step.portHint !== ''))
  assert.match(plan.steps[2]?.command ?? '', /gen:events/)
  assert.match(plan.steps[2]?.command ?? '', /verify:events/)
})

test('validateVersion 与 rewritePackageVersions 单点改写', () => {
  assert.equal(validateVersion('0.2.3'), true)
  assert.equal(validateVersion('0.2.2-rc.3'), true)
  assert.equal(validateVersion('latest'), false)
  assert.equal(validateVersion('0.2'), false)
  const pkg = JSON.stringify({
    name: 'x',
    dependencies: { '@deepseek-ai/cordis': '4.1.0', '@deepseek-ai/dsh-agent': '0.2.2-rc.3', left: '1.0.0' },
    devDependencies: { '@deepseek-ai/dsh-typert-protocol': '0.2.2-rc.3' },
  }, null, 2) + '\n'
  const { text, changed } = rewritePackageVersions(pkg, '0.2.3')
  const next = JSON.parse(text)
  assert.equal(next.dependencies['@deepseek-ai/cordis'], '4.1.0', 'cordis 缺省保持独立版本线')
  assert.equal(next.dependencies['@deepseek-ai/dsh-agent'], '0.2.3')
  assert.equal(next.devDependencies['@deepseek-ai/dsh-typert-protocol'], '0.2.3')
  assert.equal(next.dependencies.left, '1.0.0', '非 @deepseek-ai 依赖不碰')
  assert.equal(changed.length, 2)
  assert.equal(JSON.parse(rewritePackageVersions(pkg, '0.2.3', '4.2.0').text).dependencies['@deepseek-ai/cordis'], '4.2.0')
})

test('classifyImports 检出 import/require/内部路径并区分白名单与 strict', () => {
  const allowlist = new Map([['packages/memory-plugin/src/index.ts', '插件必须用 TypertRemoteService 装饰器']])
  const source = [
    "import type { Context } from '@deepseek-ai/cordis'",
    "const x = require('@deepseek-ai/dsh-tools')",
    "import y from '@deepseek-ai/dsh-agent/src/internal.ts'",
  ].join('\n') + '\n'
  const found = classifyImports(source, 'packages/foo/src/a.ts', { allowlist })
  assert.equal(found.length, 3)
  assert.ok(found.every(item => item.severity === 'error'))
  assert.deepEqual(found.map(item => item.kind).sort(), ['import', 'internal-path', 'require'])
  assert.equal(found.find(item => item.kind === 'internal-path')?.whitelisted, false)

  const white = classifyImports("import x from '@deepseek-ai/cordis'\n", 'packages/memory-plugin/src/index.ts', { allowlist })
  assert.equal(white.length, 1)
  assert.equal(white[0]?.severity, 'warn')
  assert.equal(white[0]?.whitelisted, true)
  const strict = classifyImports("import x from '@deepseek-ai/cordis'\n", 'packages/memory-plugin/src/index.ts', { allowlist, strict: true })
  assert.equal(strict[0]?.severity, 'error')
  assert.equal(classifyImports("import x from '@deepseek-ai/cordis'\n", 'packages/harness-port/src/a.ts', { allowlist }).length, 0)
  assert.equal(classifyImports("import x from 'left'\n", 'packages/foo/src/a.ts', { allowlist }).length, 0)
})

test('evaluateStructure 与 scoreEvals 只统计结构信号', () => {
  const ok = evaluateStructure({ toolCallHappened: true, fileChanged: true, stateMigrated: true, hasLink: false })
  assert.equal(ok.ok, true, '链接是观测项，不阻断')
  assert.equal(ok.failed, 0)
  assert.equal(ok.checks.find(item => item.id === 'has-link')?.required, false)
  const bad = evaluateStructure({ toolCallHappened: false, fileChanged: false, stateMigrated: true, hasLink: false })
  assert.equal(bad.ok, false)
  assert.equal(bad.failed, 2)
  assert.deepEqual(scoreEvals([]), { total: 0, completed: 0, violation: 0, noise: 0, completionRate: 0, violationRate: 0, noiseRate: 0 })
  const scored = scoreEvals([{ completed: true }, { violation: true }, { noise: true }, { completed: true }])
  assert.equal(scored.total, 4)
  assert.equal(scored.completionRate, 0.5)
  assert.equal(scored.violationRate, 0.25)
  assert.equal(scored.noiseRate, 0.25)
})
