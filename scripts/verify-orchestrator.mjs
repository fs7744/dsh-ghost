#!/usr/bin/env node
/**
 * 编排插件自检（纯 Node，不启 harness）：
 *  1. 编译产物能被加载
 *  2. ghost_ticket 能开票并返回票号
 *  3. 状态文件里能看到票与阶段
 */
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { apply } from '../packages/orchestrator-plugin/lib/index.js'

const stateFile = join(import.meta.dirname, '..', 'out', 'tickets-verify.json')
mkdirSync(dirname(stateFile), { recursive: true })
rmSync(stateFile, { force: true })

const registered = []
const ctx = {
  tools: { register: definition => { registered.push(definition); return () => {} } },
  effect: factory => { factory(); return () => {} },
}
apply(ctx, { stateFile, source: 'verify' })

const failures = []
const tool = registered.find(definition => definition.name === 'ghost_ticket')
if (tool === undefined) failures.push('没有注册 ghost_ticket')

const value = await tool.execute({ task: '检查 README 是否有过期段落' })
const text = tool.output.render({}, value)[0].text
process.stdout.write(`工具    ${tool.name} → ${text}\n`)
if (!/已开票/.test(text)) failures.push('开票失败')

const state = JSON.parse(readFileSync(stateFile, 'utf8'))
process.stdout.write(`状态    ${state.tickets.length} 张票：${state.tickets.map(t => `${t.id.slice(0, 8)}(${t.stage.stage})`).join(', ')}\n`)
if (state.tickets.length !== 1) failures.push(`状态文件票数应为 1，实际 ${state.tickets.length}`)

process.stdout.write(`\n${failures.length === 0 ? '编排插件自检通过' : failures.join('；')}\n`)
process.exit(failures.length === 0 ? 0 : 1)
