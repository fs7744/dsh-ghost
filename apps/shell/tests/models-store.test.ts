/** 模型配置持久化：写读往返、坏文件回退、原子替换。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFileCatalogStore } from '../src/models-store.ts'
import type { CatalogState } from '@dsh-ghost/model-manager'

const state: CatalogState = {
  providers: [{
    id: 'wb', displayName: 'WorkBuddy', api: 'openai-completions',
    baseURL: 'http://127.0.0.1:7864/v1', apiKeyEnv: 'WB_KEY',
    models: [{ id: 'hy3', capabilities: { contextWindow: 192000, maxTokens: 8192, reasoningEfforts: [] } }],
  }],
  bindings: [{ role: 'router', providerId: 'wb', modelId: 'hy3' }],
}

test('文件 store：写读往返，重启不丢', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ghost-models-'))
  const path = join(dir, 'models.json')
  const store = createFileCatalogStore(path)
  assert.deepEqual(await store.read(), { providers: [], bindings: [] })
  await store.write(state)
  assert.deepEqual(await store.read(), state)
  // 新实例重新读，模拟重启。
  assert.deepEqual(await createFileCatalogStore(path).read(), state)
  assert.equal(existsSync(`${path}.tmp`), false, '原子写不应留下临时文件')
})

test('文件 store：坏 JSON / 坏形状回退空目录，不抛错', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ghost-models-'))
  const path = join(dir, 'models.json')
  await writeFile(path, '{broken', 'utf8')
  assert.deepEqual(await createFileCatalogStore(path).read(), { providers: [], bindings: [] })
  await writeFile(path, JSON.stringify({ providers: 'nope', bindings: [] }), 'utf8')
  assert.deepEqual(await createFileCatalogStore(path).read(), { providers: [], bindings: [] })
  assert.equal((await readFile(path, 'utf8')).includes('nope'), true, '读失败不静默改文件')
})
