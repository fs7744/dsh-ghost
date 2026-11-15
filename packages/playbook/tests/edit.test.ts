/** 剧本编辑器数据层：文本往返、各类编辑、单向数据流、编译合法性。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  applyEdits, compilePlaybook, editText, editTextAll, estimateTokens, fromGraph,
  parseFlow, renderBody, stringifyFlow, toGraph, validate,
} from '../src/index.ts'

const example = readFileSync(new URL('../examples/ticket-flow.flow', import.meta.url), 'utf8')
const flowOf = (text: string) => parseFlow(text).flow

test('stringifyFlow 是 parseFlow 的逆运算（含头信息）', () => {
  const original = flowOf(example)
  const text = stringifyFlow(original)
  const again = parseFlow(text)
  assert.deepEqual(again.errors, [])
  assert.equal(again.flow.id, 'ticket-flow')
  assert.equal(again.flow.version, '2')
  assert.equal(again.flow.goal, original.goal)
  assert.equal(again.flow.budget, original.budget)
  assert.equal(again.flow.when, original.when)
  assert.equal(renderBody(again.flow), renderBody(original))
})

test('人闸 / 子剧本也能带条件边（解析器扩展后往返不丢）', () => {
  const { flow, errors } = parseFlow('# @x v1\n# goal 测试\n?review : reject -> fix (max 2)\ncall deploy : failed -> review (max 1)\nfix\n')
  assert.deepEqual(errors, [])
  assert.equal(flow.nodes[0]?.kind, 'gate')
  assert.equal(flow.nodes[0]?.edges[0]?.on, 'reject')
  assert.equal(flow.nodes[0]?.edges[0]?.max, 2)
  assert.equal(flow.nodes[1]?.kind, 'call')
  assert.equal(flow.nodes[1]?.call, 'deploy')
  assert.equal(flow.nodes[1]?.edges[0]?.to, 'review')
  assert.equal(renderBody(flowOf(stringifyFlow(flow))), renderBody(flow))
})

test('editText 加节点：文本立刻回写，且新文本可编译', () => {
  const result = editText(example, { type: 'node.add', name: 'approve', kind: 'gate' })
  assert.deepEqual(result.errors, [])
  assert.match(result.text, /\?approve/)
  assert.equal(flowOf(result.text).nodes.at(-1)?.kind, 'gate')
  assert.deepEqual(compilePlaybook(result.text).errors, [])
})

test('加条件边与回退上限：语义写进文本，编译通过', () => {
  const added = editTextAll(example, [
    { type: 'node.add', name: 'approve', kind: 'gate' },
    { type: 'edge.add', from: 'reply', on: 'needs-review', to: 'approve' },
    { type: 'edge.add', from: 'verify', on: 'retry', to: 'admit', max: 2 },
  ])
  assert.deepEqual(added.errors, [])
  const flow = flowOf(added.text)
  assert.equal(flow.nodes.find(node => node.name === 'verify')?.edges.find(edge => edge.on === 'retry')?.max, 2)
  assert.match(added.text, /retry -> admit \(max 2\)/)
  assert.deepEqual(validate(flow), [])
  assert.deepEqual(compilePlaybook(added.text).errors, [])
})

test('改名会同步所有指向它的跳转，不留下悬空引用', () => {
  const result = editText(example, { type: 'node.rename', name: 'work', to: 'implement' })
  assert.deepEqual(result.errors, [])
  assert.match(result.text, /implement\s+: blocked -> escalate/)
  assert.match(result.text, /fail -> implement/)
  assert.ok(!result.text.includes('-> work'))
  assert.deepEqual(validate(flowOf(result.text)), [])
})

test('删节点会连带删掉指向它的边并给出提示', () => {
  const result = editText(example, { type: 'node.remove', name: 'quiet' })
  assert.deepEqual(result.errors, [])
  assert.ok(!result.text.includes('quiet'))
  assert.ok(result.notes.some(note => note.includes('连带删除')))
  assert.deepEqual(validate(flowOf(result.text)), [])
})

test('改类型 / 挂脚本 / 调顺序都能回写', () => {
  const result = editTextAll(example, [
    { type: 'node.setKind', name: 'reply', kind: 'gate' },
    { type: 'node.setScript', name: 'checkout', script: 'scripts/checkout.mjs' },
    { type: 'node.move', name: 'verify', delta: -1 },
  ])
  assert.deepEqual(result.errors, [])
  const flow = flowOf(result.text)
  assert.equal(flow.nodes.find(node => node.name === 'reply')?.kind, 'gate')
  assert.equal(flow.nodes.find(node => node.name === 'checkout')?.script, 'scripts/checkout.mjs')
  const names = flow.nodes.map(node => node.name)
  assert.ok(names.indexOf('verify') < names.indexOf('work'))
  assert.match(result.text, /\?reply/)
  assert.match(result.text, /checkout  @scripts\/checkout\.mjs/)
})

test('改边：目标 / 条件名 / max / 清除 max', () => {
  const changed = editText(example, { type: 'edge.set', from: 'verify', on: 'fail', to: 'checkout', max: 4 })
  assert.deepEqual(changed.errors, [])
  assert.match(changed.text, /fail -> checkout \(max 4\)/)

  const renamed = editText(changed.text, { type: 'edge.set', from: 'verify', on: 'fail', newOn: 'broken' })
  assert.match(renamed.text, /broken -> checkout/)

  const cleared = editText(renamed.text, { type: 'edge.set', from: 'verify', on: 'broken', clearMax: true })
  assert.ok(!cleared.text.includes('broken -> checkout (max'))

  const removed = editText(cleared.text, { type: 'edge.remove', from: 'verify', on: 'broken' })
  assert.ok(!removed.text.includes('broken ->'))
})

test('非法操作被拒且文本不变', () => {
  const badName = editText(example, { type: 'node.add', name: '有空格' })
  assert.ok(badName.errors.length > 0)
  assert.equal(badName.text, example)

  const duplicate = editText(example, { type: 'node.add', name: 'work' })
  assert.ok(duplicate.errors.length > 0)
  assert.equal(duplicate.text, example)

  const dangling = editText(example, { type: 'edge.add', from: 'work', on: 'oops', to: 'nowhere' })
  assert.ok(dangling.errors.length > 0)
  assert.equal(dangling.text, example)
})

test('编辑后图层往返仍不丢语义（坐标只是缓存）', () => {
  const { flow } = editTextAll(example, [
    { type: 'node.add', name: 'approve', kind: 'gate' },
    { type: 'edge.add', from: 'reply', on: 'needs-review', to: 'approve' },
  ])
  assert.equal(renderBody(fromGraph(flow, toGraph(flow))), renderBody(flow))
  assert.deepEqual(toGraph(flow), toGraph(flow))
})

test('applyEdits 是纯函数：不改动入参', () => {
  const before = flowOf(example)
  const snapshot = renderBody(before)
  const result = applyEdits(before, [
    { type: 'node.add', name: 'approve' },
    { type: 'node.remove', name: 'quiet' },
  ])
  assert.deepEqual(result.errors, [])
  assert.equal(renderBody(before), snapshot)
  assert.equal(result.flow.nodes.length, before.nodes.length)
})

test('编辑后的正文仍然比等价 UI JSON 省 token', () => {
  const { flow, text } = editTextAll(example, [
    { type: 'node.add', name: 'approve', kind: 'gate' },
    { type: 'node.add', name: 'notify' },
  ])
  const bodyTokens = estimateTokens(renderBody(flow))
  const jsonTokens = estimateTokens(JSON.stringify({ nodes: flow.nodes, edges: flow.nodes.flatMap(n => n.edges) }, null, 2))
  assert.ok(jsonTokens / bodyTokens > 8, `JSON ${jsonTokens} vs 文本 ${bodyTokens}`)
  assert.ok(text.includes('?approve'))
})
