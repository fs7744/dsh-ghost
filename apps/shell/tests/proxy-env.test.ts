/** 壳侧：把工作区里登记的代理转成宿主进程 env。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readProxyEnv } from '../src/proxy-env.ts'

test('没有配置就没有 env；配置了就给全大小写两套', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ghost-proxy-'))
  assert.deepEqual(readProxyEnv(root), {})

  await mkdir(join(root, '.ghost', 'ui'), { recursive: true })
  await writeFile(join(root, '.ghost', 'ui', 'proxy.json'), JSON.stringify({
    http: 'http://127.0.0.1:7890',
    https: 'https://127.0.0.1:7890',
    noProxy: 'localhost',
  }))
  const env = readProxyEnv(root)
  assert.equal(env.HTTP_PROXY, 'http://127.0.0.1:7890')
  assert.equal(env.http_proxy, 'http://127.0.0.1:7890')
  assert.equal(env.HTTPS_PROXY, 'https://127.0.0.1:7890')
  assert.equal(env.NO_PROXY, 'localhost')
})
