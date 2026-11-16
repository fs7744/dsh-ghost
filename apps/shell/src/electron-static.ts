/**
 * 生产静态服务（C5-01）：serve apps/desktop/dist，并把 /connect 与 /api
 * 反向代理到 harness 宿主，保证渲染层「同源」取 token / 换 Cookie / 取数 /
 * 订阅事件。bind 127.0.0.1，端口由 OS 分配，不加载任何远程资源。
 */
import http from 'node:http'
import net from 'node:net'
import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync } from 'node:fs'
import { dirname } from 'node:path'
import { resolveStaticPath, shouldProxy, isLocalModelsApi } from './static-server.ts'
import { createModelsApi } from './models-api.ts'
import { createFileCatalogStore } from './models-store.ts'
import { LOCAL_HOST } from './urls.ts'
import type { Logger } from './ports.ts'
import { discoveryUrl, discoveryHeaders, type ProviderSpec } from '@dsh-ghost/model-manager'

export interface StaticServerDeps {
  distDir: string
  harnessPort: number
  logger: Logger
  /** 模型配置落地文件；缺省用内存（重启即丢，只适合测试）。 */
  modelsFile?: string
  /** harness 实际读取的 providers.json；模型库保存时同步写这里，配置才进入 cordis patch。 */
  providersFile?: string
  /** 按 env 引用名取密钥（来自安全存储）；自测与模型发现优先用它，其次进程环境。 */
  getCredential?: (name: string) => string | undefined
  /** 扩展配对：校验配对码，换出宿主地址与 Cookie。 */
  pairExtension?: (code: string) => Promise<
    { origin: string; cookieName: string; cookieValue: string; cwd: string } | undefined
  >
}

export interface StaticServer {
  readonly port: number
  setHarnessPort(port: number): void
  close(): Promise<void>
}

export async function startStaticServer(deps: StaticServerDeps): Promise<StaticServer> {
  // harness 崩溃重启可能换端口，代理目标可动态更新。
  let harnessPort = deps.harnessPort

  const credentialFor = (name: string): string | undefined =>
    deps.getCredential?.(name) ?? process.env[name]

  /** 登录发现/自测：按协议拼端点与请求头，密钥只从安全存储或进程环境取，绝不写日志。 */
  const requestModels = async (provider: ProviderSpec, timeoutMs: number): Promise<Response> => {
    const url = discoveryUrl(provider.baseURL ?? '', provider.api)
    return await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: discoveryHeaders(provider.api, credentialFor(provider.apiKeyEnv)),
    })
  }

  /** 保存模型配置时同步写 harness 读取的 providers.json（原子写，失败即报错）。 */
  const syncProviders = (providers: readonly ProviderSpec[]): void => {
    const file = deps.providersFile
    if (file === undefined) return
    mkdirSync(dirname(file), { recursive: true })
    const temporary = `${file}.tmp`
    writeFileSync(temporary, `${JSON.stringify(providers, null, 2)}\n`)
    renameSync(temporary, file)
  }
  const loadLegacyProviders = (): readonly ProviderSpec[] => {
    const file = deps.providersFile
    if (file === undefined || !existsSync(file)) return []
    try {
      const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
      return Array.isArray(raw) ? raw as ProviderSpec[] : []
    } catch {
      return []
    }
  }

  const store = deps.modelsFile === undefined ? undefined : createFileCatalogStore(deps.modelsFile)
  const modelsApi = createModelsApi({
    ...(store === undefined ? {} : { store }),
    syncProviders,
    loadLegacyProviders,
    discover: async provider => await (await requestModels(provider, 6_000)).json(),
    probe: async (provider: ProviderSpec) => {
      try {
        const response = await requestModels(provider, 3_000)
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
    if (path === '/extension/pair') {
      void handleExtensionPair(req, res, deps)
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
      // **不要改写 Host**：harness 的 Host/Origin 栅栏要求 Origin 的 host:port
      // 与 Host 完全一致，而且会话 Cookie 是按 Host 里的 authority 签发的。
      // 改写成宿主的端口 → Origin 对不上 → 全部 403；Cookie 的 authority 也对不上
      // → WebSocket 事件流 401。开发态的 vite 代理用 changeOrigin:false 也是这个道理。
      headers: { ...req.headers },
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

/**
 * 扩展配对：POST /extension/pair { code } → { origin, cookie }。
 * 换 Cookie 的动作在壳里做（token 不出壳）；扩展只拿到「地址 + 会话 Cookie」。
 */
async function handleExtensionPair(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: StaticServerDeps,
): Promise<void> {
  if (req.method !== 'POST') {
    res.writeHead(405)
    res.end('method not allowed')
    return
  }
  let body = ''
  req.on('data', chunk => { body += chunk })
  req.on('end', () => {
    void (async (): Promise<void> => {
      let code = ''
      try {
        const parsed = JSON.parse(body) as { code?: unknown }
        code = typeof parsed.code === 'string' ? parsed.code : ''
      } catch {
        res.writeHead(400)
        res.end('bad json')
        return
      }
      if (deps.pairExtension === undefined) {
        res.writeHead(501)
        res.end('pairing disabled')
        return
      }
      const result = await deps.pairExtension(code)
      if (result === undefined) {
        res.writeHead(401)
        res.end('invalid code')
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(result))
    })()
  })
}
