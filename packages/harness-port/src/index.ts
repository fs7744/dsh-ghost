/**
 * harness-port：整个仓库里唯一"知道 harness 长什么样"的地方。
 *
 * 消费方只允许 import 这个包，不得直连 @deepseek-ai/*。
 * harness 升级时改动集中在这里 + remotes.generated.ts（生成物）。
 */
export { createTransport, login } from './transport.ts'
export type { EventFrame, RemoteTransport, Session, SocketLike, TransportOptions } from './transport.ts'
export type { RemoteEndpoint, RemoteMap } from './remotes.generated.ts'
export { REMOTE_EVENTS, isKnownRemoteEvent } from './events.generated.ts'
export type { RemoteEventDescriptor, RemoteEventName } from './events.generated.ts'
