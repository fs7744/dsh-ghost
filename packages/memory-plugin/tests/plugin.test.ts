import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
// 测编译产物：src 里有 @Remote 装饰器，Node 的 strip-types 不支持装饰器语法。
// test:plugin 会先编译该包，保证测的是最新源码。
import { apply } from '../lib/index.js'

/** 记录注册结果的假 tools 服务：验装配，不启 cordis 运行时。 */
function fakeContext() {
  const registered = []
  const effects = []
  const ctx = {
    tools: { register: (definition) => { registered.push(definition); return () => {} } },
    effect: (factory) => { effects.push(factory()); return () => {} },
  }
  return { ctx: ctx as unknown as Context, registered, effects }
}

const tempRoot = () => mkdtemp(join(tmpdir(), 'ghost-plugin-'))

test('挂载后注册三个工具，名字与描述来自描述符', async () => {
  const { ctx, registered } = fakeContext()
  apply(ctx, { root: await tempRoot() })
  const names = registered.map(definition => definition.name)
  assert.deepEqual(names, ['memory_list', 'memory_read', 'memory_write'])
  for (const definition of registered) {
    assert.ok(definition.description.length > 0)
    assert.equal(typeof definition.execute, 'function')
    assert.equal(typeof definition.output.render, 'function')
  }
})

test('工具能真的读写，返回值可渲染成文本块', async () => {
  const root = await tempRoot()
  const { ctx, registered } = fakeContext()
  apply(ctx, { root })
  const byName = new Map(registered.map(definition => [definition.name, definition]))

  const write = byName.get('memory_write')
  const list = byName.get('memory_list')
  assert.ok(write !== undefined && list !== undefined)

  const written = await write.execute({ name: 'build', title: '构建用 pnpm', text: '统一 pnpm。', source: 'task-1' })
  const rendered = write.output.render({}, written)
  assert.deepEqual(rendered, [{ type: 'text', text: '已记住。' }])

  const listed = await list.execute({})
  assert.match(list.output.render({}, listed)[0].text, /build — 构建用 pnpm/)

  const index = await readFile(join(root, 'MEMORY.md'), 'utf8')
  assert.match(index, /构建用 pnpm/)
})

test('block 形态沿用同一套工具，无需改注册代码', async () => {
  const { ctx, registered } = fakeContext()
  apply(ctx, { root: await tempRoot(), mode: 'block', maxResidentBytes: 400 })
  assert.equal(registered.length, 3)
})

test('总开关关闭后模型写不进去，已写的仍可读', async () => {
  const root = await tempRoot()
  const first = fakeContext()
  apply(first.ctx, { root })
  const firstWrite = first.registered.find(definition => definition.name === 'memory_write')
  assert.ok(firstWrite !== undefined)
  await firstWrite.execute({ name: 'kept', title: '保留', text: '已写的仍可读', source: 'task-1' })

  // 模拟界面把总开关关掉（Remote toggle 落盘的就是这个文件）
  await writeFile(join(root, 'settings.json'), JSON.stringify({ enabled: false }))

  const second = fakeContext()
  apply(second.ctx, { root })
  const byName = new Map(second.registered.map(definition => [definition.name, definition]))
  const blocked = await byName.get('memory_write')!.execute({ name: 'new-one', text: '不该写入', source: 'task-2' })
  assert.match(blocked.text, /已关闭/)

  const listed = await byName.get('memory_list')!.execute({})
  assert.match(listed.text, /kept/)
  const read = await byName.get('memory_read')!.execute({ name: 'kept' })
  assert.match(read.text, /已写的仍可读/)
})
