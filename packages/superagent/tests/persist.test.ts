import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryRepositories, persisting, ticketStage } from '../src/core/index.ts'
import type { Ticket } from '../src/core/index.ts'

const tempFile = async () => join(await mkdtemp(join(tmpdir(), 'ghost-persist-')), 'tickets.json')

const ticket = (id: string) => ({
  id, title: `票 ${id}`, decisionId: 'd1', channels: [], assignments: [], inputs: [], undelivered: [],
  createdAt: '2026-03-01T00:00:00.000Z', updatedAt: '2026-03-01T00:00:00.000Z',
  origin: { triggerId: 'tr1', triggerIds: [] }, mandate: {},
}) as unknown as Ticket

test('事务结束即落盘：票出现在快照里', async () => {
  const file = await tempFile()
  const repo = persisting(new MemoryRepositories(), file)
  repo.atomic(() => { repo.tickets.save(ticket('t1')) })
  const snapshot = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(snapshot.version, 1)
  assert.equal(snapshot.tickets.length, 1)
  assert.equal(snapshot.tickets[0].id, 't1')
})

test('重启后能读回：新仓库 + 同一文件拿到历史票', async () => {
  const file = await tempFile()
  const first = persisting(new MemoryRepositories(), file)
  first.atomic(() => { first.tickets.save(ticket('t1')); first.tickets.save(ticket('t2')) })

  const second = persisting(new MemoryRepositories(), file)
  const ids = second.tickets.list().map(item => item.id).sort()
  assert.deepEqual(ids, ['t1', 't2'])
  assert.deepEqual(ticketStage(second.tickets.get('t1')), { stage: 'working', action: 'queued' })
})

test('文件不存在时静默跳过', () => {
  const repo = persisting(new MemoryRepositories(), join(tmpdir(), 'no-such-dir-xyz', 'x.json'))
  assert.deepEqual(repo.tickets.list(), [])
})

test('坏文件不会让仓库起不来', async () => {
  const file = await tempFile()
  const { writeFile } = await import('node:fs/promises')
  await writeFile(file, '{ 这不是 JSON')
  const repo = persisting(new MemoryRepositories(), file)
  assert.deepEqual(repo.tickets.list(), [])
})
