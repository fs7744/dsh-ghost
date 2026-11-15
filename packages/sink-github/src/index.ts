/**
 * GitHub 评论出口：把领域里的 Outbox 端口落到 GitHub API 上。
 *
 * 三条要求：
 *  1. **幂等**：同一条消息（同一个 id）最多发一次；重试不会刷屏。
 *  2. **状态可查**：pending → sent，失败回到 pending 并记下原因。
 *  3. **可测**：HTTP 通过注入的 `post` 走，测试不需要真网络。
 *
 * 这里不做重试调度——重试属于调用方（定时器或下一次事务），
 * 出口只保证"发出去就记账、没发出去不改状态"。
 */
import type { Outbox, OutboundMessage, ReplyStatus } from '@dsh-ghost/superagent'

/** 一次评论投递的结果。 */
export interface PostResult {
  ok: boolean
  /** 失败原因（ok 为 false 时）。 */
  error?: string
  /** GitHub 返回的评论 id。 */
  commentId?: string
}

/** 出口配置。 */
export interface GithubSinkOptions {
  /** GitHub API 基址，默认公有云；自建/假服务器可覆盖。 */
  apiBase?: string
  /** 有 `repo` 权限的令牌。 */
  token: string
  /** 目标仓库，形如 `owner/name`。 */
  repo: string
  /** 投递函数；默认用 fetch。测试与假服务器可注入。 */
  post?: (url: string, body: unknown, headers: Record<string, string>) => Promise<PostResult>
}

/** 一条消息的去向。 */
interface Entry {
  message: OutboundMessage
  status: ReplyStatus
  error?: string
  commentId?: string
  attempts: number
}

/**
 * 创建 GitHub 评论出口。
 * @param options - 令牌、仓库与投递函数
 */
export function createGithubSink(options: GithubSinkOptions): Outbox & {
  /** 真的把 pending 发出去；返回本次成功条数。 */
  flush: () => Promise<{ sent: number; failed: number }>
  /** 全部记录（排障用）。 */
  entries: () => Entry[]
} {
  const apiBase = options.apiBase ?? 'https://api.github.com'
  const table = new Map<string, Entry>()
  const headers = {
    authorization: `Bearer ${options.token}`,
    accept: 'application/vnd.github+json',
    'content-type': 'application/json',
    'x-github-api-version': '2022-11-28',
  }

  const post = options.post ?? (async (url, body, requestHeaders) => {
    try {
      const response = await fetch(url, { method: 'POST', headers: requestHeaders, body: JSON.stringify(body) })
      if (!response.ok) return { ok: false, error: `HTTP ${response.status}` }
      const json = await response.json() as { id?: number }
      return { ok: true, ...(json.id === undefined ? {} : { commentId: String(json.id) }) }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })

  /** 消息对应到哪个 issue/PR 号。 */
  const targetOf = (message: OutboundMessage): string | undefined =>
    message.channel.address.number ?? (message.channel.thread.includes('#') ? message.channel.thread.split('#')[1] : undefined)

  return {
    send(message) {
      // 幂等：已存在就保留第一条，不覆盖
      if (table.has(message.id)) return
      table.set(message.id, { message, status: 'pending', attempts: 0 })
    },

    status(id) {
      return table.get(id)?.status
    },

    withdraw(id) {
      const entry = table.get(id)
      // 已经发出去的收不回；未发的直接丢弃
      if (entry !== undefined && entry.status === 'pending') entry.status = 'dropped'
    },

    async flush() {
      let sent = 0
      let failed = 0
      for (const entry of table.values()) {
        if (entry.status !== 'pending') continue
        const number = targetOf(entry.message)
        if (number === undefined) {
          entry.status = 'dropped'
          entry.error = 'no-target'
          continue
        }
        entry.attempts += 1
        const result = await post(
          `${apiBase}/repos/${options.repo}/issues/${number}/comments`,
          { body: entry.message.text },
          headers,
        )
        if (result.ok) {
          entry.status = 'sent'
          sent += 1
          if (result.commentId !== undefined) entry.commentId = result.commentId
        } else {
          entry.error = result.error ?? 'unknown'
          failed += 1
        }
      }
      return { sent, failed }
    },

    entries: () => [...table.values()],
  }
}
