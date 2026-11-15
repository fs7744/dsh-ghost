/**
 * 本机地址、一次性 token 与深链校验（C5-01 / C5-02 / C5-03 / C2-02）。
 *
 * 硬边界：宿主入口固定形如 http://127.0.0.1:<port>/?token=...；渲染层从
 * location.search 取 token，再 fetch /connect?token=...&interactions=answer
 * 换 API Cookie。本模块只做纯校验与拼接，零 I/O、零 DOM、零 electron。
 */

export const LOCAL_HOST = '127.0.0.1'
export const DEEP_LINK_SCHEME = 'dsh-ghost'
/** 事件订阅必须 interactions=answer；none 只够拉数据，不能订阅事件流。 */
export const CONNECT_INTERACTIONS = 'answer'

export interface ParsedHostUrl {
  ok: true
  origin: string
  port: number
  token: string
}
export interface HostUrlRejection {
  ok: false
  reason: string
}
export type HostUrlResult = ParsedHostUrl | HostUrlRejection

/** token 限定为 URL 安全字符集，杜绝 & = # 空格等拼接注入。 */
const SAFE_TOKEN = /^[A-Za-z0-9._~-]+$/

export function isSafeToken(token: string): boolean {
  return token.length > 0 && token.length <= 512 && SAFE_TOKEN.test(token)
}

/**
 * 解析宿主入口 URL：只接受 http + 127.0.0.1 + 合法端口 + 安全 token。
 * 拒绝 localhost / 0.0.0.0 / 远程主机（C2-02 的非本机 Host 403 同源防线）。
 */
export function parseHostUrl(input: string): HostUrlResult {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return { ok: false, reason: 'malformed-url' }
  }
  if (url.protocol !== 'http:') return { ok: false, reason: 'scheme-not-http' }
  if (url.hostname !== LOCAL_HOST) return { ok: false, reason: 'host-not-loopback-ipv4' }
  const port = Number(url.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, reason: 'bad-port' }
  const token = url.searchParams.get('token')
  if (token === null || !isSafeToken(token)) return { ok: false, reason: 'missing-or-unsafe-token' }
  return { ok: true, origin: url.origin, port, token }
}

/** 构造渲染层入口 URL；token 只注入到渲染层，不写日志、不落盘。 */
export function buildEntryUrl(port: number, token: string): string {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid port')
  if (!isSafeToken(token)) throw new Error('unsafe token')
  return `http://${LOCAL_HOST}:${port}/?token=${encodeURIComponent(token)}`
}

/**
 * 生成 connect 换取 API Cookie 的路径。
 * 壳依赖事件流（session / $events），因此强制 interactions=answer，
 * 传入 none 一律拒绝（与 C2-02「none 不能订阅事件」一致）。
 */
export function buildConnectPath(token: string, interactions: string = CONNECT_INTERACTIONS): string {
  if (!isSafeToken(token)) throw new Error('unsafe token')
  if (interactions !== CONNECT_INTERACTIONS) {
    throw new Error('shell requires interactions=answer for event subscription')
  }
  return `/connect?token=${encodeURIComponent(token)}&interactions=${CONNECT_INTERACTIONS}`
}

/** 日志脱敏：把 token 原值替换为占位符，避免一次性凭据进日志。 */
export function redactTokenInText(text: string, token: string): string {
  if (token === '') return text
  return text.split(token).join('***')
}

export type DeepLinkAction = 'open' | 'ticket' | 'session' | 'settings'
const DEEP_LINK_ACTIONS: readonly string[] = ['open', 'ticket', 'session', 'settings']

export interface ParsedDeepLink {
  ok: true
  action: DeepLinkAction
  target: string
  params: Record<string, string>
}
export interface DeepLinkRejection {
  ok: false
  reason: string
}
export type DeepLinkResult = ParsedDeepLink | DeepLinkRejection

/** 解析 dsh-ghost:// 深链（单实例唤醒时由第二实例把 URL 交给第一实例）。 */
export function parseDeepLink(input: string): DeepLinkResult {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return { ok: false, reason: 'malformed-url' }
  }
  if (url.protocol !== `${DEEP_LINK_SCHEME}:`) return { ok: false, reason: 'wrong-scheme' }
  const action = url.hostname.toLowerCase()
  if (!DEEP_LINK_ACTIONS.includes(action)) return { ok: false, reason: 'unknown-action' }
  let target: string
  try {
    target = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
  } catch {
    return { ok: false, reason: 'bad-encoding' }
  }
  const params: Record<string, string> = {}
  for (const [key, value] of url.searchParams) params[key] = value
  return { ok: true, action: action as DeepLinkAction, target, params }
}

export function isDeepLink(value: string): boolean {
  return value.toLowerCase().startsWith(`${DEEP_LINK_SCHEME}://`)
}
