/**
 * 生产静态服务（C5-01）：serve apps/desktop/dist，并把 /connect 与 /api
 * 反向代理到 harness 宿主，保证渲染层「同源」取 token / 换 Cookie / 取数 /
 * 订阅事件。bind 127.0.0.1，端口由 OS 分配，不加载任何远程资源。
 */
import http from 'node:http'
import net from 'node:net'
import { readFileSync, existsSync } from 'node:fs'
import { resolveStaticPath, shouldProxy, isLocalModelsApi } from './static-server.ts'
import { createModelsApi } from './models-api.ts'
import { LOCAL_HOST } from './urls.ts'
import type { Logger } from './ports.ts'
import type { ProviderSpec } from '@dsh-ghost/model-manager'

export interface StaticServerDeps {
  distDir: string
  harnessPort: number
  logger: Logger
}

export interface StaticServer {
  readonly port: number
  setHarnessPort(port: number): void
  close(): Promise<void>
}

export async function startStaticServer(deps: StaticServerDeps): Promise<StaticServer> {
  // harness 崩溃重启可能换端口，代理目标可动态更新。
  let harnessPort = deps.harnessPort

  /** 模型管理页的连通性自测：真发一次 /models，凭据从进程环境读，绝不写日志。 */
  const modelsApi = createModelsApi({
    probe: async (provider: ProviderSpec) => {
      const base = (provider.baseURL ?? '').replace(/\/+$/, '')
      const key = process.env[provider.apiKeyEnv]
      try {
        const response = await fetch(`${base}/models`, {
          signal: AbortSignal.timeout(3000),
          headers: key === undefined ? {} : { authorization: `Bearer ${key}` },
        })
        return { ok: response.ok, status: response.status }
      } catch (error) {
        return { ok: false, error: String(error).slice(0, 120) }
      }
    },
  })

  const server = http.createServer((req, res) => {
    const path = req.url ?? '/'
    if (shouldProxy(path)) {
      proxyHttp(req, res, harnessPort, path)
      return
    }
    if (isLocalModelsApi(path)) {
      void handleLocalModels(req, res, path, modelsApi)
      return
    }
    const resolved = resolveStaticPath(deps.distDir, path)
    if (!resolved.ok) {
      res.writeHead(400)
      res.end('bad path')
      return
    }
    if (!existsSync(resolved.filePath)) {
      res.writeHead(404)
      res.end('not found')
      return
    }
    try {
      const body = readFileSync(resolved.filePath)
      res.writeHead(200, { 'Content-Type': resolved.mime, 'Cache-Control': 'no-store' })
      res.end(body)
    } catch {
      res.writeHead(500)
      res.end('read error')
    }
  })

  // 事件流 WebSocket（/api/remote.mux）按 TCP 隧道转发到宿主；token 在 URL query 里。
  server.on('upgrade', (req, socket, head) => {
    const upstream = net.connect(harnessPort, LOCAL_HOST, () => {
      upstream.write(`${req.method ?? 'GET'} ${req.url ?? '/'} HTTP/1.1\r\n`)
      for (const [key, value] of Object.entries(req.headers)) {
        if (Array.isArray(value)) {
          for (const one of value) upstream.write(`${key}: ${one}\r\n`)
        } else if (value !== undefined) {
          upstream.write(`${key}: ${value}\r\n`)
        }
      }
      upstream.write('\r\n')
      if (head.length > 0) upstream.write(head)
      upstream.pipe(socket)
      socket.pipe(upstream)
    })
    upstream.on('error', () => socket.destroy())
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, LOCAL_HOST, () => resolve())
  })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  deps.logger.info(`static server ${LOCAL_HOST}:${port} -> harness ${LOCAL_HOST}:${harnessPort}`)

  return {
    port,
    setHarnessPort: next => {
      harnessPort = next
      deps.logger.info(`harness proxy target -> ${LOCAL_HOST}:${next}`)
    },
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  }
}

/** 本机模型 API：限长、只收 JSON、错误也回 JSON，绝不落到静态文件查找。 */
async function handleLocalModels(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  path: string,
  api: ReturnType<typeof createModelsApi>,
): Promise<void> {
  let raw = ''
  for await (const chunk of req) {
    raw += String(chunk)
    if (raw.length > 64_000) {
      res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, label: '请求体过大' }))
      return
    }
  }
  let body: unknown = {}
  if (raw !== '') {
    try { body = JSON.parse(raw) } catch {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, label: '请求体不是合法 JSON' }))
      return
    }
  }
  const result = await api.handle(req.method ?? 'GET', path, body)
  res.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(result.body))
}

function proxyHttp(req: http.IncomingMessage, res: http.ServerResponse, harnessPort: number, path: string): void {
  const upstream = http.request(
    {
      hostname: LOCAL_HOST,
      port: harnessPort,
      path,
      method: req.method,
      headers: { ...req.headers, host: `${LOCAL_HOST}:${harnessPort}` },
    },
    up => {
      res.writeHead(up.statusCode ?? 502, up.headers)
      up.pipe(res)
    },
  )
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502)
    res.end('harness unavailable')
  })
  req.pipe(upstream)
}
