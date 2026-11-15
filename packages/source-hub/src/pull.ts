/**
 * 拉取型信息源：定时打 HTTP API，把响应喂回同一条归一化管线。
 *
 * 为什么需要：现有来源都是**推送**（webhook 投递进来）。但很多真实数据源
 * 只会给你一个查询接口（Jira 搜索、GitHub Issues 列表、内部工单系统…），
 * 没人来推 webhook。
 *
 * 设计上刻意复用 webhook 那条管线：拉到的响应被包装成 `SourceRequest`，
 * 再走同一套 `mapping` 与鉴权校验，最后产出同样的 `NormalizedEvent`。
 * 所以「怎么把一条数据变成票」只需要写一次。
 *
 * 凭据不落配置：请求头值写 `env:NAME` 指向环境变量。
 */
import { getPath } from './mapping.ts'
import type { SourceRequest } from './types.ts'

/** 拉取配置。 */
export interface ApiPullConfig {
  /** 拉取地址。 */
  url: string
  /** 请求方法，默认 GET。 */
  method?: 'GET' | 'POST'
  /** 请求头；值写 `env:NAME` 指向环境变量（不写明文密钥）。 */
  headers?: Record<string, string>
  /** 请求体（POST 时使用）。 */
  body?: string
  /** 列表在响应里的路径，如 `data.items`；省略表示整个响应就是一条。 */
  listPath?: string
  /** 轮询间隔（分钟），最小 1。 */
  intervalMinutes?: number
  /** 轮询间隔（秒），给测试与高频场景用；给了就优先用它。 */
  intervalSeconds?: number
}

export interface PullResult {
  ok: boolean
  /** 失败原因（人话）。 */
  reason?: string
  /** 包好的原始投递，逐条走归一化。 */
  requests: SourceRequest[]
}

/** 解析请求头值：`env:NAME` 取环境变量，其余按字面量。 */
export function resolveHeaderValue(value: string, env: NodeJS.ProcessEnv = process.env): string {
  const match = /^env:([A-Za-z_][A-Za-z0-9_]*)$/.exec(value.trim())
  if (match === null) return value
  const name = match[1]
  return name === undefined ? '' : (env[name] ?? '')
}

const DEFAULT_TIMEOUT_MS = 15_000

/**
 * 拉一次并包装成若干条 `SourceRequest`。
 * @param config - 拉取配置
 * @param options - 可注入 fetch / env（测试用）
 */
export async function pullFromApi(
  config: ApiPullConfig,
  options: {
    fetchImpl?: typeof fetch
    env?: NodeJS.ProcessEnv
    timeoutMs?: number
  } = {},
): Promise<PullResult> {
  const doFetch = options.fetchImpl ?? fetch
  const env = options.env ?? process.env
  if (config.url.trim() === '') return { ok: false, reason: '拉取地址为空', requests: [] }

  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(config.headers ?? {})) {
    const resolved = resolveHeaderValue(value, env)
    if (resolved !== '') headers[key] = resolved
  }
  const method = config.method ?? 'GET'
  if (method === 'GET') headers['accept'] = headers['accept'] ?? 'application/json'
  else headers['content-type'] = headers['content-type'] ?? 'application/json'

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    const response = await doFetch(config.url, {
      method,
      headers,
      ...(method === 'POST' ? { body: config.body ?? '' } : {}),
      signal: controller.signal,
    })
    if (!response.ok) return { ok: false, reason: `HTTP ${response.status}`, requests: [] }
    const text = await response.text()
    let body: unknown = text
    try {
      body = JSON.parse(text)
    } catch { /* 不是 JSON 就按原文处理 */ }
    const list = config.listPath === undefined ? undefined : getPath(body, config.listPath)
    if (Array.isArray(list)) {
      return {
        ok: true,
        requests: list.map(item => ({
          headers: {},
          rawBody: typeof item === 'string' ? item : JSON.stringify(item),
          body: item,
        })),
      }
    }
    return { ok: true, requests: [{ headers: {}, rawBody: text, body }] }
  } catch (error) {
    const reason = error instanceof Error && error.name === 'AbortError' ? '拉取超时' : String(error)
    return { ok: false, reason, requests: [] }
  } finally {
    clearTimeout(timer)
  }
}
