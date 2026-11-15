#!/usr/bin/env node
/**
 * 剧本编辑器验收（纯 Node，不启宿主）：模拟 UI 上的一串编辑。
 *
 * 判定「编辑即回写文本」：每一步都从文本重新解析，任何时刻的文本都是合法 `.flow`；
 * 最终文本能编译成 skill 包，且新节点/条件边/人闸/回退上限都写进了正文。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  compilePlaybook, editText, editTextAll, estimateTokens, parseFlow,
  renderBody, stringifyFlow, toGraph, validate,
} from '../packages/playbook/src/index.ts'

const REPO = join(import.meta.dirname, '..')
const source = readFileSync(join(REPO, 'packages', 'playbook', 'examples', 'ticket-flow.flow'), 'utf8')

let failures = 0
const check = (ok, label, extra = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra === '' ? '' : `：${extra}`}\n`)
  if (!ok) failures += 1
}

/** 模拟一次完整的编辑会话：加节点 → 连条件 → 改类型 → 改名 → 调顺序 → 改上限。 */
const steps = [
  { label: '加人闸节点', edit: { type: 'node.add', name: 'approve', kind: 'gate' } },
  { label: '加普通节点', edit: { type: 'node.add', name: 'notify' } },
  { label: '连一条条件边', edit: { type: 'edge.add', from: 'reply', on: 'needs-review', to: 'approve' } },
  { label: '加带上限的回边', edit: { type: 'edge.add', from: 'verify', on: 'retry', to: 'admit', max: 2 } },
  { label: '把步骤改成人闸', edit: { type: 'node.setKind', name: 'deliver', kind: 'gate' } },
  { label: '挂脚本', edit: { type: 'node.setScript', name: 'checkout', script: 'scripts/checkout.mjs' } },
  { label: '改名并同步引用', edit: { type: 'node.rename', name: 'work', to: 'implement' } },
  { label: '上移一个节点', edit: { type: 'node.move', name: 'verify', delta: -1 } },
  { label: '改回退上限', edit: { type: 'edge.set', from: 'verify', on: 'fail', max: 4 } },
]

const initial = compilePlaybook(source)
check(initial.errors.length === 0, '原始剧本可编译', `正文 ${initial.tokens.body} token`)

let text = source
for (const step of steps) {
  const result = editText(text, step.edit)
  const parsed = parseFlow(result.text)
  const ok = result.errors.length === 0 && parsed.errors.length === 0 && result.text !== text
  check(ok, step.label, ok ? `${parsed.flow.nodes.length} 节点` : (result.errors[0] ?? '文本没变化'))
  if (result.errors.length === 0) text = result.text
}

const flow = parseFlow(text).flow
const compiled = compilePlaybook(text)
const skill = compiled.files['SKILL.md'] ?? ''

process.stdout.write(`\n--- 回写后的 .flow ---\n${text.trimEnd()}\n---\n`)

check(validate(flow).length === 0, '编辑后图模型校验通过', validate(flow).join('; '))
check(compiled.errors.length === 0, '编辑后能编译成 skill 包', compiled.errors.join('; '))
check(skill.includes('?approve'), '人闸写进了 SKILL.md 正文')
check(skill.includes('needs-review -> approve'), '新增条件边写进了正文')
check(skill.includes('retry -> admit (max 2)'), '回退上限写进了正文')
check(skill.includes('fail -> implement (max 4)'), '改名与 max 修改都生效')
check(flow.nodes.length === 13, '节点数 11 → 13', `${flow.nodes.length}`)
check(toGraph(flow).nodes.length === 13, '布局图同步为 13 个节点')

// 单向数据流的两个不变量：文本是唯一真相源、编辑是确定性的
const roundTrip = parseFlow(stringifyFlow(flow))
check(renderBody(roundTrip.flow) === renderBody(flow), 'stringify → parse 不丢语义')
const replay = editTextAll(source, steps.map(step => step.edit))
check(replay.text === text && replay.errors.length === 0, '同一串编辑重放得到完全相同的文本')
check(renderBody(flow).split('\n').length === 13, '正文一行一节点', `正文 ${estimateTokens(renderBody(flow))} token`)

process.stdout.write(`\n${failures === 0 ? '剧本编辑器验收通过' : `${failures} 项失败`}\n`)
process.exit(failures === 0 ? 0 : 1)
