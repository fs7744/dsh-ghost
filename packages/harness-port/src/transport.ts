/**
 * harness-port 的传输层：唯一与 harness 通信的实现。
 *
 * 设计约束（来自 P0.5 的实测结论）：
 *  1. 一元调用 `POST /api/<namespace>/<method>`，body 必须是 `{ type:'client-request', rpcId, method, payload:{ args } }`
 *  2. `args` 的键是 **wire 名**（不是 TS 参数名）——由 `remotes.generated.ts` 提供类型
 *  3. 订阅事件必须用 `interactions=answer` 换 Cookie，且 WebSocket 必须带同一个 Cookie
 *  4. 事件帧走 `/api/remote.mux`，先 `open` 一个 `$events` 流，再收 `item`
 *
 * 本文件不 import 任何 @deepseek-ai 包：它只依赖 fetch 和一个可注入的 WebSocket 工厂，
 * 所以在 Node 与 Electron 渲染进程里都能跑。
 */
import type { RemoteEndpoint, RemoteMap } from './remotes.generated.ts'

/** WebSocket 的最小面，Node 的 ws 与浏览器的 WebSocket 都能适配。 */
export interface SocketLike {
  send: (data: string) => void
  close: () => void
  onOpen: (handler: () => void) => void
  onMessage: (handler: (data: string) => void) => void
  onError: (handler: (error: unknown) => void) => void
}

/** 事件流下行帧。 */
export type EventFrame =
  | { type: 'ready'; clientId: string; host: { home: string } }
  | { type: 'emit'; event: string; args: readonly unknown[] }
  | { type: 'waterfall'; event: string; eventId: string; agentId: string; request: Record<string, unknown> }

/** 一次登录的结果：origin 与 API Cookie。 */
export interface Session {
  origin: string
  cookie: string
}

/** 传输层依赖。 */
export interface TransportOptions extends Session {
  /** 订阅事件时必需；不订阅可以不给。 */
  createWebSocket?: (url: string, headers: Record<string, string>) => SocketLike
  /** 事件流上的错误回调；默认打到 console。 */
  onError?: (error: unknown) => void
}

/** 一元调用与事件订阅。 */
export interface RemoteTransport {
  /**
   * 调一个端点。端点名与参数键都是编译期检查的。
   * @param endpoint - 形如 `session/list`
   * @param args - wire 名做键的参数对象
   */
  call: <E extends RemoteEndpoint>(endpoint: E, args: RemoteMap[E]['args']) => Promise<RemoteMap[E]['value']>
  /**
   * 订阅事件流。
   * @param handler - 每个下行帧回调一次
   * @param signal - 结束订阅
   */
  events: (handler: (frame: EventFrame) => void, signal?: AbortSignal) => Promise<void>
}

let counter = 0

/**
 * 用入口 URL 里的 token 换 API Cookie。
 * @param entryUrl - 启动日志里 `http://127.0.0.1:<port>/?token=…` 那一行
 * @param interactions - `answer` 才能订阅事件；`none` 只够读数据
 */
export async function login(entryUrl: string, interactions: 'none' | 'answer' = 'answer'): Promise<Session> {
  const url = new URL(entryUrl)
  const token = url.searchParams.get('token')
  if (token === null) throw new Error('入口 URL 里没有 token')
  const response = await fetch(`${url.origin}/connect?token=${encodeURIComponent(token)}&interactions=${interactions}`, {
    redirect: 'manual',
  })
  const cookie = (response.headers.getSetCookie?.() ?? []).map(value => value.split(';')[0]).join('; ')
  if (cookie === '') throw new Error(`/connect 未返回 Cookie（HTTP ${response.status}）`)
  return { origin: url.origin, cookie }
}

/**
 * 创建传输层。
 * @param options - 登录结果 + 可选的 WebSocket 工厂
 */
export function createTransport(options: TransportOptions): RemoteTransport {
  const { origin, cookie, createWebSocket, onError } = options

  return {
    async call(endpoint, args) {
      counter += 1
      const rpcId = `ghost-${counter}`
      const response = await fetch(`${origin}/api/${endpoint}`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload: { args } }),
      })
      const text = await response.text()
      let envelope: { type?: string; rpcId?: string; result?: { ok?: boolean; value?: unknown; error?: { code: string; message: string } } }
      try {
        envelope = JSON.parse(text)
      } catch {
        throw new Error(`${endpoint} 返回非 JSON（HTTP ${response.status}）：${text.slice(0, 200)}`)
      }
      if (envelope.result?.ok !== true) {
        const error = envelope.result?.error
        throw new Error(`${endpoint} 失败：${error?.code ?? 'unknown'} ${error?.message ?? ''}`)
      }
      return envelope.result.value as never
    },

    async events(handler, signal) {
      if (createWebSocket === undefined) throw new Error('未提供 createWebSocket，无法订阅事件')
      const socket = createWebSocket(`${origin.replace('http', 'ws')}/api/remote.mux`, { cookie })
      const streamId = 'ghost-events'
      // 先挂 onMessage 再开流，避免 ready 帧在 listener 装上之前到达。
      socket.onMessage(text => {
        let message: { type?: string; streamId?: string; value?: EventFrame; error?: { message: string } }
        try {
          message = JSON.parse(text)
        } catch {
          return
        }
        if (message.streamId !== streamId) return
        if (message.type === 'error') {
          (onError ?? console.error)(new Error(`事件流错误：${message.error?.message ?? 'unknown'}`))
          socket.close()
          return
        }
        if (message.type === 'item' && message.value !== undefined) handler(message.value)
      })
      socket.onError(error => (onError ?? console.error)(error))
      await new Promise<void>((resolve, reject) => {
        socket.onOpen(() => {
          socket.send(JSON.stringify({ type: 'open', streamId, endpoint: '$events', payload: { args: {} } }))
          resolve()
        })
        socket.onError(reject)
      })
      signal?.addEventListener('abort', () => socket.close())
    },
  }
}
