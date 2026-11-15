/**
 * ghost-memory：把记忆工具挂进 harness 的宿主插件。
 *
 * 这是本仓库第一个**宿主插件**，也是 `harness-port` 之外唯一允许 import `@deepseek-ai/*` 的地方
 * （宿主侧与客户端侧分开：客户端走 Remote，宿主侧只能直接调 ctx）。
 *
 * 注册的是**全局工具**（所有 agent 可见）；如果以后要做"按 agent 隔离的记忆"，
 * 改为在 agent 作用域上注册即可，工具定义本身不用动。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import { MemoryStore, memoryTools, type JsonSchema } from '@dsh-ghost/memory'

/** 插件名，cordis 用它做去重与诊断。 */
export const name = 'ghost-memory'

/** 依赖的工具注册表。 */
export const inject = ['tools']

/** 插件配置。 */
export interface Config {
  /** 记忆根目录：`indexed` 用 `<root>/MEMORY.md`，`block` 用 `<root>/user-memory.md`。 */
  root: string
  /** 存储形态，默认 `indexed`（项目记忆）。 */
  mode?: 'indexed' | 'block'
  /** 常驻预算（字节），默认 2048。 */
  maxResidentBytes?: number
}

/** 工具返回值：一个文本块。 */
interface MemoryToolValue {
  text: string
}

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: { text: { type: 'string' } },
  required: ['text'],
  additionalProperties: false,
} as const

/**
 * 挂载插件。
 * @param ctx - cordis 上下文（必须已注入 `tools`）
 * @param config - 记忆根目录与形态
 */
export function apply(ctx: Context, config: Config): void {
  const store = new MemoryStore({
    root: config.root,
    mode: config.mode ?? 'indexed',
    ...(config.maxResidentBytes === undefined ? {} : { maxResidentBytes: config.maxResidentBytes }),
  })

  for (const tool of memoryTools(store)) {
    ctx.effect(() => ctx.tools.register({
      name: tool.name,
      description: tool.description,
      // 我们的描述符用极简 JSON Schema；harness 的类型更宽，这里断言即可。
      parameters: tool.parameters as unknown as never,
      output: {
        schema: OUTPUT_SCHEMA as unknown as never,
        render: (_args, value) => [{ type: 'text', text: (value as unknown as MemoryToolValue).text }],
      },
      async execute(args) {
        return { text: await tool.execute((args ?? {}) as Record<string, unknown>) }
      },
    }), `ghost-memory: ${tool.name}`)
  }
}

export type { JsonSchema }
