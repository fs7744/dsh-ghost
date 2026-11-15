/**
 * 「当前标签页」桥：让模型能操作**用户正在看的那个页面**（已登录、已打开）。
 *
 * 为什么需要：浏览器自动化的 Playwright 引擎跑在**独立临时画像**里——
 * 干净、安全，但看不见用户的登录态。想「点当前页面的查看新闻」「测一套考试系统」，
 * 必须驱动**当前标签页**，于是有了这条桥：
 *
 * ```
 * 模型 ──page_click/page_fill──▶ 宿主（排队一条命令）
 *                                  │
 * 扩展（chrome.debugger 挂在当前标签页）◀── 轮询取命令 ──┘
 *        │ 执行（Runtime.evaluate / Page.captureScreenshot）
 *        └── 回传结果 ──▶ 宿主 ──▶ 模型
 * ```
 *
 * 扩展是**主动轮询**方：宿主不能直接调用浏览器扩展（没有反向通道），
 * 所以命令进队列、扩展来取。模型侧的工具会等结果（有超时）。
 */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-tools'

/** 页面快照（扩展采集）。 */
export interface PageSnapshot {
  url: string
  title: string
  /** 页面可见文本（截断）。 */
  text: string
  /** 采集时间戳。 */
  at: number
}

/** 扩展要执行的动作。 */
export interface PageCommand {
  id: string
  /** 动作：click（按文本或选择器）、fill（填输入）、screenshot、read。 */
  action: 'click' | 'fill' | 'screenshot' | 'read'
  /** 目标：可见文本（click）或 CSS 选择器（fill）。 */
  target?: string
  /** 填入的文本。 */
  value?: string
  /** 截图保存目录（宿主给）。 */
  saveDir?: string
}

/** 执行结果。 */
export interface PageCommandResult {
  id: string
  ok: boolean
  /** 人话结果。 */
  message: string
  /** 截图文件路径（screenshot 动作，宿主写的）。 */
  path?: string
  /** 截图原始数据（base64 PNG）；由宿主落盘。 */
  data?: string
}

interface PendingCommand {
  command: PageCommand
  resolve: (result: PageCommandResult) => void
  timer: ReturnType<typeof setTimeout>
}

interface SessionBridge {
  snapshot: PageSnapshot | undefined
  /** 还没被扩展取走的命令。 */
  pending: PendingCommand[]
  /** 已取走、等待回传结果的命令（取走不等于完成）。 */
  inflight: Map<string, PendingCommand>
  /** 扩展是否在线（最近一次轮询时间）。 */
  lastSeenAt: number
}

/** 桥的存储：按 sessionId 分。 */
const bridges = new Map<string, SessionBridge>()

/**
 * 「当前页面」只有一个：本地单用户应用 + 一个浏览器扩展，
 * 所以最近一次上报的会话就是活动页（多标签/多会话的取舍写在这里）。
 */
let activeSessionId = ''

/** 当前活动页的 sessionId（没有扩展连着时为空串）。 */
export function activePageSessionId(): string {
  return activeSessionId
}

const bridgeFor = (sessionId: string): SessionBridge => {
  let bridge = bridges.get(sessionId)
  if (bridge === undefined) {
    bridge = { snapshot: undefined, pending: [], inflight: new Map(), lastSeenAt: 0 }
    bridges.set(sessionId, bridge)
  }
  return bridge
}

/** 扩展是否在线（60 秒内轮询过）。 */
export function isBridgeOnline(sessionId: string, now = Date.now()): boolean {
  const bridge = bridges.get(sessionId)
  return bridge !== undefined && now - bridge.lastSeenAt < 60_000
}

/** 上报快照（扩展侧调用；也是 Remote 的底层）。 */
export function registerSnapshot(sessionId: string, snapshot: PageSnapshot): void {
  const bridge = bridgeFor(sessionId)
  bridge.snapshot = {
    url: String(snapshot?.url ?? ''),
    title: String(snapshot?.title ?? ''),
    text: String(snapshot?.text ?? '').slice(0, 20_000),
    at: Date.now(),
  }
  bridge.lastSeenAt = Date.now()
  activeSessionId = sessionId
}

/**
 * 取一条待执行命令（扩展轮询）。
 * 注意：取走只是「在途」，命令仍在 inflight 里等结果——否则回传时找不到人可唤醒。
 */
export function takeCommand(sessionId: string): PageCommand | undefined {
  const bridge = bridgeFor(sessionId)
  const queued = bridge.pending.shift()
  if (queued === undefined) return undefined
  bridge.inflight.set(queued.command.id, queued)
  return queued.command
}

/** 回传结果，唤醒等待中的模型工具。 */
export function completeCommand(sessionId: string, result: PageCommandResult): boolean {
  const bridge = bridgeFor(sessionId)
  const pending = bridge.inflight.get(String(result?.id ?? ''))
  if (pending === undefined) return false
  bridge.inflight.delete(pending.command.id)
  clearTimeout(pending.timer)
  pending.resolve({
    id: String(result.id),
    ok: result.ok === true,
    message: String(result.message ?? ''),
    ...(result.path === undefined ? {} : { path: result.path }),
    ...(result.data === undefined ? {} : { data: String(result.data) }),
  })
  return true
}

/** 读当前页面快照。 */
export function readSnapshot(sessionId: string): { snapshot?: PageSnapshot; online: boolean } {
  const bridge = bridges.get(sessionId)
  if (bridge === undefined) return { online: false }
  return { ...(bridge.snapshot === undefined ? {} : { snapshot: bridge.snapshot }), online: isBridgeOnline(sessionId) }
}

/**
 * 宿主 Remote 面（扩展用）。
 */
export class GhostPageRemote extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, 'ghostPage', { namespace: 'ghostPage' })
  }

  /** 扩展上报页面快照。 */
  @Remote('register')
  register(input: { sessionId: string; snapshot: PageSnapshot }): { ok: boolean } {
    if (typeof input?.sessionId !== 'string' || input.sessionId === '') return { ok: false }
    registerSnapshot(input.sessionId, input.snapshot)
    return { ok: true }
  }

  /** 扩展轮询命令（长轮询：最多等 20 秒）。 */
  @Remote('next')
  async next(input: { sessionId: string }): Promise<{ command?: PageCommand }> {
    if (typeof input?.sessionId !== 'string' || input.sessionId === '') return {}
    bridgeFor(input.sessionId).lastSeenAt = Date.now()
    const queued = takeCommand(input.sessionId)
    if (queued !== undefined) return { command: queued }
    await new Promise(resolve => setTimeout(resolve, 20_000))
    const later = takeCommand(input.sessionId)
    return later === undefined ? {} : { command: later }
  }

  /** 扩展回传执行结果。 */
  @Remote('result')
  result(input: { sessionId: string; result: PageCommandResult }): { ok: boolean } {
    if (typeof input?.sessionId !== 'string' || input.sessionId === '') return { ok: false }
    return { ok: completeCommand(input.sessionId, input.result) }
  }

  /** 读当前页面快照。 */
  @Remote('read')
  read(input: { sessionId: string }): { snapshot?: PageSnapshot; online: boolean } {
    return readSnapshot(input?.sessionId ?? '')
  }
}

/**
 * 下发一条命令并等结果。
 * @param timeoutMs - 等待上限
 */
export function dispatchPageCommand(
  sessionId: string,
  command: Omit<PageCommand, 'id'>,
  timeoutMs = 60_000,
): Promise<PageCommandResult> {
  const bridge = bridgeFor(sessionId)
  const id = `pc-${Date.now()}-${Math.floor(Math.random() * 100000)}`
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const index = bridge.pending.findIndex(item => item.command.id === id)
      if (index >= 0) bridge.pending.splice(index, 1)
      bridge.inflight.delete(id)
      resolve({ id, ok: false, message: '扩展没有回应（页面桥可能没连上，或标签页被关掉了）。' })
    }, timeoutMs)
    bridge.pending.push({
      command: { ...command, id },
      resolve,
      timer,
    })
  })
}
