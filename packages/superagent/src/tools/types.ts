/**
 * 会话工具层的公共类型。
 *
 * 这一层是「描述符 + 处理器」的注册表：描述符给模型看（说明书 + 参数 schema），
 * 处理器只依赖可注入的领域端口（Repositories / Engine / ConfigStore / ViewReader）。
 * 不 import 任何 harness 包、不碰 DOM、不碰 contracts.ts，也不改 harness 的工具注册。
 */

import type { Engine, Repositories } from '../core/index.ts'

/** 给模型看的参数说明书，取 JSON Schema 够用的最小子集。 */
export interface JsonSchema {
  type: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array'
  description?: string
  properties?: Record<string, JsonSchema>
  items?: JsonSchema
  required?: string[]
  enum?: string[]
  additionalProperties?: boolean
}

/** 一次工具调用的参数（外部输入，一律不信任）。 */
export type ToolArgs = Record<string, unknown>

/** 工具执行时可注入的全部依赖。 */
export interface ToolContext {
  /** 领域仓储：读票、线程、触发、决策。 */
  repo: Repositories
  /** 领域引擎：所有写操作都走它，保证事务与拒绝语义一致。 */
  engine: Engine
  /** 可注入的配置仓：settings / policy / prompts 的读写。 */
  config: ConfigStore
  /** 可注入的视图读取：orchestrator_read 用，返回人话 / JSON 文本。 */
  views: ViewReader
}

/** 配置仓契约：纯内存实现在 context.ts，宿主接真实存储时替换实现即可。 */
export interface ConfigStore {
  /** 已存在的配置块名。 */
  blocks(): string[]
  /** 读一个配置块；不存在返回 undefined。 */
  read(block: string): Record<string, unknown> | undefined
  /** 写一个配置块；未知块抛 UserError('unknownBlock')。 */
  save(block: string, value: Record<string, unknown>): void
  /** 把策略推进到新版本，返回 {from, to}，供 engine.policyChanged 使用。 */
  syncPolicy(from?: string): { from: string; to: string }
  /** 保存一段提示词正文；空、超预算、缺占位符时抛 UserError。 */
  savePrompt(id: string, text: string): void
  /** 已保存的提示词 id。 */
  prompts(): string[]
  /** 允许保存的提示词分片名；不在其中抛 UserError('unknownPromptPart')。 */
  promptParts(): string[]
}

/** 视图读取契约：把面板名映射成人话文本，找不到返回 undefined。 */
export interface ViewReader {
  read(view: string): string | undefined
}

/** 一个工具：描述符含 name / description / parameters，handler 返回人话文本。 */
export interface ToolDescriptor {
  /** 完整工具名，前缀 orchestrator_。 */
  name: string
  /** 给模型看的说明书，长度不超过 120 字符。 */
  description: string
  /** 参数 JSON Schema。 */
  parameters: JsonSchema
  /** 处理器：读参数、调端口、返回人话；拒绝时由 invokeTool 把原因原样返回。 */
  handler: (args: ToolArgs, ctx: ToolContext) => string
}
