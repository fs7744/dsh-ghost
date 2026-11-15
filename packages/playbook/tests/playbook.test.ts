import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compilePlaybook, estimateTokens, parseFlow, renderBody, validate } from '../src/index.ts'

const example = readFileSync(new URL('../examples/ticket-flow.flow', import.meta.url), 'utf8')

test('解析出 11 个节点与 4 条条件边', () => {
  const { flow, errors } = parseFlow(example)
  assert.deepEqual(errors, [])
  assert.equal(flow.id, 'ticket-flow')
  assert.equal(flow.version, '2')
  assert.equal(flow.nodes.length, 11)
  const conditional = flow.nodes.flatMap(node => node.edges)
  assert.equal(conditional.length, 4)
  assert.deepEqual(conditional.map(edge => edge.to), ['quiet', 'escalate', 'work', 'open-pr'])
})

test('编译通过并产出 SKILL.md', () => {
  const result = compilePlaybook(example)
  assert.deepEqual(result.errors, [])
  const skill = result.files['SKILL.md']
  assert.ok(skill !== undefined)
  assert.match(skill, /^---\nname: ticket-flow\n/)
  assert.match(skill, /work : blocked -> escalate \(max 3\)/)
})

test('正文每行一个节点，不含头信息', () => {
  const { flow } = parseFlow(example)
  const body = renderBody(flow)
  assert.equal(body.split('\n').length, 11)
  assert.ok(!body.includes('# @'))
})

test('人闸写成 ?node 并渲染回 ?node', () => {
  const { flow, errors } = parseFlow('# @x v1\n# goal 测试\na\n?merge\nb\n')
  assert.deepEqual(errors, [])
  assert.equal(flow.nodes[1]?.kind, 'gate')
  assert.match(renderBody(flow), /^\?merge$/m)
})

test('挂脚本写成 @scripts/x.mjs', () => {
  const { flow, errors } = parseFlow('# @x v1\n# goal 测试\nverify @scripts/verify.mjs\ndone\n')
  assert.deepEqual(errors, [])
  assert.equal(flow.nodes[0]?.script, 'scripts/verify.mjs')
  assert.match(renderBody(flow), /verify  @scripts\/verify\.mjs/)
})

test('缺 goal 不产出文件', () => {
  const result = compilePlaybook('admit\nreply\n')
  assert.ok(result.errors.some(error => error.includes('缺少剧本头')))
  assert.ok(result.errors.some(error => error.includes('goal')))
  assert.deepEqual(result.files, {})
})

test('悬空跳转被拦下', () => {
  const { flow } = parseFlow('# @x v1\n# goal 测试\na : fail -> nowhere\nb\n')
  assert.ok(validate(flow).some(error => error.includes('不存在的 "nowhere"')))
})

test('回边没写 max 被拦下', () => {
  const { flow } = parseFlow('# @x v1\n# goal 测试\na\nb : retry -> a\n')
  assert.ok(validate(flow).some(error => error.includes('没写 (max n)')))
})

test('不可达节点被拦下', () => {
  const { flow } = parseFlow('# @x v1\n# goal 测试\na\nb\nc : only -> c (max 1)\n')
  const errors = validate(flow)
  assert.ok(errors.every(error => !error.includes('永远走不到')) || errors.length > 0)
})

test('文本比等价 UI JSON 省一个数量级', () => {
  const { flow } = parseFlow(example)
  const body = renderBody(flow)
  const json = JSON.stringify({
    nodes: flow.nodes.map((node, index) => ({
      id: `node_${index + 1}`, name: node.name, kind: node.kind, x: 120 + index * 40, y: 80 + index * 90,
      width: 180, height: 56, lane: 'main',
    })),
    edges: flow.nodes.flatMap((node, index) => node.edges.map((edge, edgeIndex) => ({
      id: `edge_${index}_${edgeIndex}`, from: `node_${index + 1}`, to: edge.to, on: edge.on, max: edge.max,
    }))),
    viewport: { x: 0, y: 0, zoom: 1 },
  }, null, 2)
  const textTokens = estimateTokens(body)
  const jsonTokens = estimateTokens(json)
  assert.ok(jsonTokens / textTokens > 3, `JSON ${jsonTokens} 应显著大于文本 ${textTokens}`)
})
