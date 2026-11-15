/** 由 harness-contract/gen-events.mjs 生成，勿手改。 */
/* eslint-disable */

/** harness 转发的宿主事件名（含非所有者 Peer 的 waterfall 询问）。 */
export type RemoteEventName =
  | "agent-preset/selected"
  | "api-session/activity"
  | "api-session/added"
  | "api-session/error"
  | "api-session/removed"
  | "api-session/status"
  | "approval/request"
  | "commands/change"
  | "cordis/dynamic-package"
  | "cordis/dynamic-retract"
  | "cordis/inspect-query"
  | "cordis/inspect-query-resolved"
  | "cordis/request-run"
  | "cordis/request-run-resolved"
  | "credentials/record-updated"
  | "credentials/reference-updated"
  | "deepseek-account/model-sign-in-required"
  | "deepseek-account/session-expired"
  | "goal/activation-changed"
  | "llm/adapters-updated"
  | "llm/models-updated"
  | "permission-presets/catalog-changed"
  | "plugin-manager/changed"
  | "plugin-manager/install-log"
  | "plugin-manager/install-state"
  | "plugin-manager/update-state"
  | "plugin-market/changed"
  | "schedule/changed"
  | "settings/document-updated"
  | "user-questions/request"
  | "web/providers-changed"

/** 事件描述符：mode 决定是广播还是瀑布式询问，resources 是它携带的资源身份。 */
export interface RemoteEventDescriptor {
  event: RemoteEventName
  mode: 'emit' | 'waterfall'
  resources: readonly string[]
}

export const REMOTE_EVENTS: readonly RemoteEventDescriptor[] = [
  { event: "agent-preset/selected", mode: "emit", resources: [] },
  { event: "api-session/activity", mode: "emit", resources: ["session"] },
  { event: "api-session/added", mode: "emit", resources: ["session"] },
  { event: "api-session/error", mode: "emit", resources: ["session"] },
  { event: "api-session/removed", mode: "emit", resources: ["session"] },
  { event: "api-session/status", mode: "emit", resources: ["session"] },
  { event: "approval/request", mode: "waterfall", resources: [] },
  { event: "commands/change", mode: "emit", resources: [] },
  { event: "cordis/dynamic-package", mode: "emit", resources: [] },
  { event: "cordis/dynamic-retract", mode: "emit", resources: [] },
  { event: "cordis/inspect-query", mode: "emit", resources: [] },
  { event: "cordis/inspect-query-resolved", mode: "emit", resources: [] },
  { event: "cordis/request-run", mode: "emit", resources: [] },
  { event: "cordis/request-run-resolved", mode: "emit", resources: [] },
  { event: "credentials/record-updated", mode: "emit", resources: [] },
  { event: "credentials/reference-updated", mode: "emit", resources: [] },
  { event: "deepseek-account/model-sign-in-required", mode: "emit", resources: [] },
  { event: "deepseek-account/session-expired", mode: "emit", resources: [] },
  { event: "goal/activation-changed", mode: "emit", resources: [] },
  { event: "llm/adapters-updated", mode: "emit", resources: [] },
  { event: "llm/models-updated", mode: "emit", resources: [] },
  { event: "permission-presets/catalog-changed", mode: "emit", resources: [] },
  { event: "plugin-manager/changed", mode: "emit", resources: [] },
  { event: "plugin-manager/install-log", mode: "emit", resources: [] },
  { event: "plugin-manager/install-state", mode: "emit", resources: [] },
  { event: "plugin-manager/update-state", mode: "emit", resources: [] },
  { event: "plugin-market/changed", mode: "emit", resources: [] },
  { event: "schedule/changed", mode: "emit", resources: [] },
  { event: "settings/document-updated", mode: "emit", resources: [] },
  { event: "user-questions/request", mode: "waterfall", resources: [] },
  { event: "web/providers-changed", mode: "emit", resources: [] },
]

const KNOWN = new Set<string>(REMOTE_EVENTS.map(item => item.event))

/** 运行时判断一个事件名是否属于 harness 的转发白名单。 */
export function isKnownRemoteEvent(name: string): name is RemoteEventName {
  return KNOWN.has(name)
}
