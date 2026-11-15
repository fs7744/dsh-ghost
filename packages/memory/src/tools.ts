/**
 * 记忆工具：模型可见的三个动作。
 *
 * 设计原则（省 token + 防误用）：
 *  - **描述即说明书**：每个工具的 description 就是模型看到的全部，不额外写文档；
 *  - **只回文本**：工具结果是给人话，不是 JSON 堆——模型不需要解析结构化字段；
 *  - **错误可自愈**：写入被拒时，把"为什么被拒"原文返回，模型下一轮就能改。
 *
 * 这里只定义与 harness 无关的描述符；把它挂进 `agent.ctx.tools.register` 是适配层的事。
 */
import type { MemoryStore } from './store.ts'

/** 极简 JSON Schema（够 harness 的 zod 适配器转换）。 */
export interface JsonSchema {
  type: 'object'
  properties: Record<string, { type: string; description?: string }>
  required?: string[]
  additionalProperties?: boolean
}

/** 一个工具的描述与执行体。 */
export interface ToolDescriptor {
  name: string
  description: string
  parameters: JsonSchema
  execute: (args: Record<string, unknown>) => Promise<string>
}

/**
 * 构建三个记忆工具。
 * @param store - 记忆库
 */
export function memoryTools(store: MemoryStore): ToolDescriptor[] {
  return [
    {
      name: 'memory_list',
      description: '列出已记住的条目（只有标题）。想知道"以前定过什么"时先调这个，而不是猜。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      async execute() {
        const entries = await store.list()
        if (entries.length === 0) return '还没有任何记忆。'
        return entries.map(entry => `- ${entry.name} — ${entry.title}`).join('\n')
      },
    },
    {
      name: 'memory_read',
      description: '读一条记忆的正文。name 来自 memory_list 的结果。',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: '条目名，例如 build-command' } },
        required: ['name'],
        additionalProperties: false,
      },
      async execute(args) {
        const name = String(args.name ?? '')
        const body = await store.read(name)
        return body === undefined ? `没有这条记忆：${name}` : body.trim()
      },
    },
    {
      name: 'memory_write',
      description:
        '记住一条**跨会话仍然成立**的事实（约定、偏好、踩过的坑）。临时状态不要写。必须给出 source：这条是从哪次任务或哪个文件得知的。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'kebab-case 条目名，例如 build-command' },
          title: { type: 'string', description: '一行标题，进索引' },
          text: { type: 'string', description: '正文，写清结论与原因' },
          source: { type: 'string', description: '来源：任务 id、文件路径或对话标识' },
        },
        required: ['name', 'text', 'source'],
        additionalProperties: false,
      },
      async execute(args) {
        const outcome = await store.write({
          name: String(args.name ?? ''),
          text: String(args.text ?? ''),
          source: String(args.source ?? ''),
          ...(args.title === undefined ? {} : { title: String(args.title) }),
        })
        if (outcome.ok) return '已记住。'
        return `未写入：\n${outcome.reasons.map(reason => `- ${reason}`).join('\n')}`
      },
    },
  ]
}
