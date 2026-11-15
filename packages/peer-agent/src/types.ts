/** 外部 agent（peer）的配置与执行结果。 */

/** 接法类型。 */
export type PeerKind = 'cli' | 'http' | 'a2a'

/** 一个外部 agent 的配置。 */
export interface PeerAgent {
  /** 唯一 id（kebab-case）。 */
  id: string
  /** 展示名（如「Claude Code」）。 */
  label: string
  /** 接法。 */
  kind: PeerKind
  /** cli：可执行文件。 */
  command?: string
  /** cli：参数模板；可用 `{prompt}` 占位。 */
  args?: string[]
  /** cli：提示词怎么给（默认 argv）。 */
  promptVia?: 'argv' | 'stdin'
  /** cli：工作目录。 */
  cwd?: string
  /** cli/http：附加环境变量。 */
  env?: Record<string, string>
  /** http/a2a：地址。 */
  url?: string
  /** http/a2a：附加请求头。 */
  headers?: Record<string, string>
  /** 一句话说明这个 peer 会什么（给模型看）。 */
  description?: string
  /** agent card 地址（a2a 场景）。 */
  cardUrl?: string
}

/** 执行结果。 */
export interface PeerResult {
  ok: boolean
  /** peer 的输出。 */
  output: string
  /** 失败原因。 */
  error?: string
  /** 哪个 peer。 */
  peerId: string
}
