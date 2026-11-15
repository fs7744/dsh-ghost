import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore, candidates, gate, memoryTools } from '../src/index.ts'

const tempRoot = () => mkdtemp(join(tmpdir(), 'ghost-mem-'))
const fixedNow = () => new Date('2026-11-15T08:00:00.000Z')

test('写入闸门：缺来源被拒', () => {
  const result = gate({ name: 'a', text: '用 pnpm。', source: '' })
  assert.equal(result.ok, false)
  assert.ok(result.reasons.some(reason => reason.includes('来源')))
})

test('写入闸门：一次性措辞 + 无标题被拒，并标记 oneShot', () => {
  const result = gate({ name: 'a', text: '本次先用 npm 临时绕过。', source: 'task-1' })
  assert.equal(result.ok, false)
  assert.equal(result.oneShot, true)
})

test('写入闸门：非法名字被拒', () => {
  const result = gate({ name: 'Not_Kebab', text: 'x', source: 'task-1' })
  assert.equal(result.ok, false)
})

test('索引形态：写入后索引有行、正文可读、删除同步', async () => {
  const root = await tempRoot()
  const store = new MemoryStore({ root, mode: 'indexed', now: fixedNow })
  await store.init()

  const outcome = await store.write({ name: 'build-command', title: '构建用 pnpm', text: '统一用 pnpm，不用 npm。', source: 'task-42' })
  assert.equal(outcome.ok, true)

  const index = await readFile(join(root, 'MEMORY.md'), 'utf8')
  assert.match(index, /`build-command` — 构建用 pnpm/)

  const body = await store.read('build-command')
  assert.equal(body?.trim(), '统一用 pnpm，不用 npm。')

  const listed = await store.list()
  assert.equal(listed.length, 1)
  assert.equal(listed[0]?.title, '构建用 pnpm')

  assert.equal(await store.remove('build-command'), true)
  assert.equal(await store.read('build-command'), undefined)
  assert.ok(!(await readFile(join(root, 'MEMORY.md'), 'utf8')).includes('build-command'))
})

test('幂等：同名覆盖不产生重复索引行，且留 .bak', async () => {
  const root = await tempRoot()
  const store = new MemoryStore({ root, mode: 'indexed', now: fixedNow })
  await store.init()
  await store.write({ name: 'x', title: '第一版', text: 'a', source: 't1' })
  await store.write({ name: 'x', title: '第二版', text: 'b', source: 't2' })

  const index = await readFile(join(root, 'MEMORY.md'), 'utf8')
  assert.equal(index.split('\n').filter(line => line.includes('`x`')).length, 1)
  assert.match(index, /第二版/)

  const files = await readdir(join(root, 'entries'))
  assert.ok(files.includes('x.md'))
  assert.ok(files.includes('x.md.bak'), '覆盖前应留备份')
})

test('常驻块形态：小预算内可写，超预算拒绝而不是静默截断', async () => {
  const root = await tempRoot()
  const store = new MemoryStore({ root, mode: 'block', maxResidentBytes: 220, now: fixedNow })
  await store.init()

  const first = await store.write({ name: 'reply-lang', title: '回答语言', text: '中文回答，结论先行。', source: 'task-1' })
  assert.equal(first.ok, true)

  const resident = await store.resident()
  assert.match(resident, /## 回答语言/)
  assert.match(resident, /来源：task-1/)

  const second = await store.write({ name: 'long', title: '很长的偏好', text: '啊'.repeat(200), source: 'task-2' })
  assert.equal(second.ok, false)
  assert.ok(second.ok === false && second.reasons.some(reason => reason.includes('常驻块已满')))
})

test('候选句子只挑带信号词的', () => {
  const found = candidates('这次先这样。以后统一用 pnpm。今天天气不错。约定：提交后必须推送。')
  assert.deepEqual(found, ['以后统一用 pnpm。', '约定：提交后必须推送。'])
})

test('工具：list 空态 → write → list 有标题 → read 有正文', async () => {
  const root = await tempRoot()
  const store = new MemoryStore({ root, mode: 'indexed', now: fixedNow })
  await store.init()
  const [list, read, write] = memoryTools(store)
  assert.ok(list !== undefined && read !== undefined && write !== undefined)

  assert.equal(await list.execute({}), '还没有任何记忆。')
  assert.equal(await write.execute({ name: 'build', title: '构建用 pnpm', text: '统一 pnpm。', source: 'task-1' }), '已记住。')
  assert.match(await list.execute({}), /build — 构建用 pnpm/)
  assert.equal((await read.execute({ name: 'build' })).trim(), '统一 pnpm。')
})

test('工具：写入被拒时把原因原样返回（让模型自愈）', async () => {
  const root = await tempRoot()
  const store = new MemoryStore({ root, mode: 'indexed', now: fixedNow })
  await store.init()
  const write = memoryTools(store).find(tool => tool.name === 'memory_write')
  assert.ok(write !== undefined)

  const rejected = await write.execute({ name: 'x', text: '本次临时这样。', source: 'task-1' })
  assert.match(rejected, /未写入/)
  assert.match(rejected, /一次性上下文/)
})

test('工具描述足够短（常驻成本受控）', () => {
  const tools = memoryTools(new MemoryStore({ root: 'unused', mode: 'indexed' }))
  for (const tool of tools) {
    assert.ok(tool.description.length <= 120, `${tool.name} 描述过长：${tool.description.length}`)
  }
})
