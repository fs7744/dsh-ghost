#!/usr/bin/env node
/**
 * 编译产物冒烟：**纯 Node**（不加任何 TS 加载器）能不能加载插件并完成注册。
 *
 * 这就是 harness 加载插件的方式——它只认 JS，不认 .ts。
 * 通过 = 我们的插件可以被打包进 profile。
 */
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, inject, name } from '../packages/memory-plugin/lib/index.js'

const root = await mkdtemp(join(tmpdir(), 'ghost-smoke-'))
const registered = []
const ctx = {
  tools: { register: definition => { registered.push(definition); return () => {} } },
  effect: factory => { factory(); return () => {} },
}

apply(ctx, { root })

const ok = registered.map(definition => definition.name)
const expected = ['memory_list', 'memory_read', 'memory_write']
const missing = expected.filter(name => !ok.includes(name))

process.stdout.write(`plugin  ${name}  inject=[${inject.join(',')}]\n`)
process.stdout.write(`tools   ${ok.join(', ') || '(空)'}\n`)

// 真的跑一次写入，确认编译后的代码也能工作（不只是能 import）
const write = registered.find(definition => definition.name === 'memory_write')
const value = await write.execute({ name: 'smoke', title: '冒烟', text: '编译产物可用。', source: 'smoke-test' })
const rendered = write.output.render({}, value)

process.stdout.write(`write   ${rendered[0]?.text}\n`)
process.stdout.write(missing.length === 0 ? '\nPASS  纯 Node 加载并注册成功\n' : `\nFAIL  缺少工具：${missing.join(',')}\n`)
process.exit(missing.length === 0 ? 0 : 1)
