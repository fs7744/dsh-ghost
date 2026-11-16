/**
 * 静态服务反代宿主：Host/Origin 栅栏。
 *
 * harness 的 `dsh-client-connection` 要求请求的 Origin 与 Host 的 host:port
 * 完全一致，而且会话 Cookie 是按 Host 里的 authority 签发的。反代一旦把 Host
 * 改写成宿主端口，浏览器的 Origin（我们自己的端口）就对不上 → 全部 403，
 * Cookie 的 authority 也对不上 → 事件流 WebSocket 直接失败，界面就成了
 * 「未连接宿主、啥也配不了」。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { join } from 'node:path'
import { startStaticServer } from '../src/electron-static.ts'

interface Seen {
  host: string | undefined
  origin: string | undefined
  cookie: string | undefined
}

/** 起一个假宿主：回显它收到的 host / origin / cookie。 */
async function startFakeHarness(): Promise<{ port: number; seen: Seen[]; close: () => Promise<void> }> {
  const seen: Seen[] = []
  const server = http.createServer((req, res) => {
    seen.push({ host: req.headers.host, origin: req.headers.origin, cookie: req.headers.cookie })
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"ok":true}')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return {
    port,
    seen,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  }
}

test('反代不改写 Host：Origin 必须与 Host 同源，否则宿主一律 403', async () => {
  const harness = await startFakeHarness()
  const server = await startStaticServer({
    distDir: join(import.meta.dirname, '..', 'dist'),
    harnessPort: harness.port,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  })
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/api/remote/state`, {
      headers: { origin: `http://127.0.0.1:${server.port}` },
    })
    assert.equal(response.status, 200)

    const seen = harness.seen.at(-1)
    assert.ok(seen !== undefined, '宿主应该收到请求')
    assert.equal(seen.host, `127.0.0.1:${server.port}`, 'Host 必须保持浏览器看到的那个')
    assert.equal(seen.origin, `http://127.0.0.1:${server.port}`, 'Origin 原样透传')
    assert.equal(
      seen.host,
      new URL(seen.origin ?? '').host,
      'Origin 的 host:port 必须等于 Host，否则宿主直接 403',
    )
  } finally {
    await server.close()
    await harness.close()
  }
})
