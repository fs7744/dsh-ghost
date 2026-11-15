/** ghost-ui 插件：放 JSON 就能加页面/注入界面/登记 LLM 服务。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// src 里有装饰器语法，先编译再测。
import { readCustomCss, readPanels, readProxy, readSlots, saveProviders, saveProxy } from '../lib/index.js'

const tempRoot = () => mkdtemp(join(tmpdir(), 'ghost-ui-'))

test('面板与插槽：放 JSON 就能读到，非法项给原因', async () => {
  const root = await tempRoot()
  await mkdir(join(root, 'panels'), { recursive: true })
  await mkdir(join(root, 'slots'), { recursive: true })
  await writeFile(join(root, 'panels', 'my.json'), JSON.stringify({
    id: 'my-panel', title: '我的面板', source: { endpoint: 'myPlugin/rows' },
  }))
  await writeFile(join(root, 'panels', 'bad.json'), JSON.stringify({ id: 'Bad Id' }))
  await writeFile(join(root, 'slots', 'bar.json'), JSON.stringify({
    slot: 'chat.toolbar', label: '打开面板', endpoint: 'myPlugin/open',
  }))

  const panels = readPanels(root)
  assert.equal(panels.panels.length, 1)
  assert.equal(panels.panels[0]?.id, 'my-panel')
  assert.equal(panels.errors.length, 1)
  const slots = readSlots(root)
  assert.equal(slots.slots.length, 1)
  assert.equal(slots.slots[0]?.slot, 'chat.toolbar')
})

test('LLM 服务：校验通过才写盘，明文密钥类的配置被拒', async () => {
  const root = await tempRoot()
  const good = {
    providers: [{
      id: 'ollama',
      displayName: 'Ollama',
      api: 'openai-completions',
      baseURL: 'http://127.0.0.1:11434/v1',
      apiKeyEnv: 'OLLAMA_KEY',
      models: [{ id: 'qwen3', capabilities: { contextWindow: 32768, maxTokens: 8192, reasoningEfforts: [] } }],
    }],
  }
  const saved = saveProviders(root, good.providers)
  assert.equal(saved.ok, true)
  assert.equal(saved.count, 1)
  const written = JSON.parse(await readFile(join(root, 'providers.json'), 'utf8'))
  assert.equal(written[0].id, 'ollama')

  const bad = saveProviders(root, [
    { id: 'Bad Id', displayName: '', api: 'nope', apiKeyEnv: 'sk-plaintext-key', models: [] },
  ] as never)
  assert.equal(bad.ok, false)
  assert.ok(bad.errors.length >= 3)
})

test('网络代理：只认 http(s) 地址，非法值不落盘', async () => {
  const root = await tempRoot()
  const bad = saveProxy(root, { http: 'ftp://proxy', https: 'not a url' })
  assert.equal(bad.ok, false)
  assert.equal(bad.errors.length, 2)

  const good = saveProxy(root, { http: 'http://127.0.0.1:7890', noProxy: 'localhost,127.0.0.1' })
  assert.equal(good.ok, true)
  const read = readProxy(root)
  assert.equal(read.http, 'http://127.0.0.1:7890')
  assert.equal(read.noProxy, 'localhost,127.0.0.1')
})

test('自定义皮肤：读 .ghost/ui/custom.css，没有就是空', async () => {
  const root = await tempRoot()
  assert.equal(readCustomCss(root), '')
  await writeFile(join(root, 'custom.css'), ':root{--accent:#ff0000;}')
  assert.match(readCustomCss(root), /--accent:#ff0000/)
})
