/**
 * 本地 LLM 负载均衡代理。
 *
 * 为什么需要：harness 的 llm-pi-ai 一次调用只能指定一个 provider/model，
 * 模型库页登记的多个服务如果只写进 providers.json，并不会被自动分摊请求。
 * 这里在壳里起一个只监听 127.0.0.1 的聚合端点，把它作为 wb provider 的
 * baseURL 注入 cordis.patch —— agent 的调用照旧，实际由这里按策略分发到
 * 多个真实服务，并在失败时换下一个候选。
 *
 * 只转发 OpenAI 兼容协议（openai-completions / openai-responses）：
 * Anthropic / Gemini 的线协议不同，硬转会把请求发坏，这类服务仍由 harness
 * 按各自协议直接注册使用，不参与本代理的分发。
 */
import http from 'node:http'
import { selectBalanceTarget, type BalanceStrategy, type BalanceCandidate } from '@dsh-ghost/model-manager'
import { createFileCatalogStore } from './models-store.ts'
import { LOCAL_HOST } from './urls.ts'
import type { Logger } from './ports.ts'
import type { CatalogState } from '@dsh-ghost/model-manager'

export interface LlmBalancerDeps {
  modelsFile: string
  /** 从安全存储按 env 引用名取密钥；明文只用于出站请求，绝不落日志。 */
  getCredential: (name: string) => string | undefined
  /** 没有启用任何服务时的透传目标（原来的 WB_BASE_URL）。 */
  fallbackBaseURL: string
  /** 默认模型名，用于 /models 聚合列表里保留 agent 当前选中的模型。 */
  fallbackModel?: string
  logger: Logger
}

export interface LlmBalancer {
  /** 给 cordis.patch 的 baseURL；没有可用服务时为 undefined（调用方回退直连）。 */
  baseURL?: string
  port: number
  close(): Promise<void>
}

interface Target {
  candidate: BalanceCandidate
  baseURL: string
  modelIds: readonly string[]
  apiKeyEnv: string
}

const OPENAI_APIS = new Set(['openai-completions', 'openai-responses'])
const MAX_BODY = 32 * 1024 * 1024

const readBody = async (req: http.IncomingMessage): Promise<Buffer> => {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY) throw new Error('请求体过大')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

/** 出站请求头：去掉 hop-by-hop 与 sentry 头，密钥按目标的 apiKeyEnv 注入。 */
const outboundHeaders = (req: http.IncomingMessage, key: string | undefined): Record<string, string> => {
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    if (['host', 'content-length', 'connection', 'authorization', 'accept-encoding'].includes(name)) continue
    headers[name] = Array.isArray(value) ? value.join(', ') : value
  }
  if (key !== undefined && key !== '') headers.authorization = `Bearer ${key}`
  return headers
}

export async function createLlmBalancer(deps: LlmBalancerDeps): Promise<LlmBalancer> {
  const store = createFileCatalogStore(deps.modelsFile)
  let cursor = 0

  /** 每次请求都重读配置：模型库改完不用重启壳，下一请求就按新策略走。 */
  const snapshot = (): { targets: Target[]; strategy: BalanceStrategy } => {
    let state: CatalogState
    try { state = store.read() as CatalogState } catch { state = { providers: [], bindings: [] } }
    const targets: Target[] = state.providers
      .filter(provider => provider.enabled !== false && OPENAI_APIS.has(provider.api))
      .filter(provider => typeof provider.baseURL === 'string' && provider.baseURL !== '')
      .map(provider => ({
        candidate: { id: provider.id, enabled: true, weight: provider.weight ?? 1 },
        baseURL: (provider.baseURL ?? '').replace(/\/+$/, ''),
        modelIds: provider.models.map(model => model.id),
        apiKeyEnv: provider.apiKeyEnv,
      }))
    return { targets, strategy: state.balance?.strategy ?? 'off' }
  }

  const server = http.createServer((req, res) => {
    void (async (): Promise<void> => {
      const path = (req.url ?? '').split('?')[0] ?? ''
      const { targets, strategy } = snapshot()

      if (path === '/v1/models' || path === '/models') {
        const models = new Map<string, string>()
        for (const target of targets) {
          for (const id of target.modelIds) models.set(id, target.candidate.id)
        }
        if (deps.fallbackModel !== undefined && deps.fallbackModel !== '') {
          models.set(deps.fallbackModel, 'wb')
        }
        const body = JSON.stringify({
          object: 'list',
          data: [...models.entries()].map(([id, ownedBy]) => ({ id, object: 'model', owned_by: ownedBy })),
        })
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end(body)
        return
      }

      if (path !== '/v1/chat/completions' && path !== '/chat/completions') {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'not found' } }))
        return
      }

      // 没有参与分发的 OpenAI 兼容服务：透传到原来的网关，行为与加代理前一致。
      if (targets.length === 0) {
        if (deps.fallbackBaseURL === '') {
          res.writeHead(503, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: { message: '没有可用的模型服务' } }))
          return
        }
        await relay(req, res, `${deps.fallbackBaseURL.replace(/\/+$/, '')}/chat/completions`, await readBody(req))
        return
      }

      let raw: Buffer
      try { raw = await readBody(req) } catch {
        res.writeHead(413, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: '请求体过大' } }))
        return
      }
      const payload = JSON.parse(raw.toString('utf8')) as { model?: unknown }
      const requestedModel = typeof payload.model === 'string' ? payload.model : ''

      // 先用策略选一次；失败后按列表顺序换还没试过的候选（任何策略都有故障转移兜底）。
      // 游标只由 selectBalanceTarget 推进，重试不改它，避免轮询"跳号"。
      const attempts = Math.min(targets.length, 8)
      const tried = new Set<string>()
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        let matched: Target | undefined
        if (strategy === 'off') {
          matched = targets.find(item => !tried.has(item.candidate.id))
        } else {
          const selection = selectBalanceTarget(targets.map(item => item.candidate), strategy, cursor)
          cursor = selection.cursor
          const chosen = selection.target
          const picked = chosen === undefined ? undefined : targets.find(item => item.candidate.id === chosen.id)
          matched = picked !== undefined && !tried.has(picked.candidate.id)
            ? picked
            : targets.find(item => !tried.has(item.candidate.id))
        }
        if (matched === undefined) break
        const id = matched.candidate.id
        tried.add(id)

        // 目标服务没有 agent 当前选中的模型时，改写成它自己的第一个模型——
        // 否则 pi-ai 会用不存在的 model id 发请求，必然 404。
        if (requestedModel !== '' && !matched.modelIds.includes(requestedModel) && matched.modelIds.length > 0) {
          payload.model = matched.modelIds[0]
        }
        const forwarded = Buffer.from(JSON.stringify(payload))
        const key = deps.getCredential(matched.apiKeyEnv)
        try {
          const ok = await relay(req, res, `${matched.baseURL}/chat/completions`, forwarded, key)
          if (ok) return
          // 响应还没发出才可能换目标；已经发出就只能结束，不能改写成另一个模型的流。
          if (!res.headersSent) continue
          return
        } catch (error) {
          deps.logger.error(`llm-balancer: ${id} 请求失败 ${String(error).slice(0, 100)}`)
          if (res.headersSent) return
        }
      }
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: '所有模型服务都不可用' } }))
      }
    })().catch(error => {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: String(error).slice(0, 120) } }))
      } else res.end()
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, LOCAL_HOST, () => resolve())
  })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  const hasTargets = snapshot().targets.length > 0
  if (hasTargets) deps.logger.info(`llm-balancer ${LOCAL_HOST}:${port} -> ${snapshot().strategy}`)
  return {
    ...(hasTargets ? { baseURL: `http://${LOCAL_HOST}:${port}/v1` } : {}),
    port,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  }
}

/** 转发一次请求并流式回传；返回 false 表示上游返回了可重试的错误（响应未发出）。 */
async function relay(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  body: Buffer,
  key?: string,
): Promise<boolean> {
  const upstream = await fetch(url, {
    method: 'POST',
    headers: {
      ...outboundHeaders(req, key),
      ...(body.length > 0 ? { 'content-type': req.headers['content-type'] ?? 'application/json' } : {}),
    },
    body: new Uint8Array(body),
    signal: AbortSignal.timeout(120_000),
  })
  // 只有限流/服务端错误才值得换服务重试；401/400 这类错误换了也一样，原样回传。
  if (!upstream.ok && !res.headersSent && (upstream.status === 429 || upstream.status >= 500)) return false
  res.writeHead(upstream.status, {
    'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
    'Cache-Control': 'no-store',
  })
  if (upstream.body === null) { res.end(); return true }
  const reader = upstream.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  res.end()
  return true
}
