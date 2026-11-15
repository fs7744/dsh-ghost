/**
 * ghost-memory：把记忆工具与记忆管理 Remote 挂进 harness 宿主。
 *
 * 工具（`memory_list/read/write`）给模型用；`ghostMemory/*` Remote 给自建界面用，
 * 两边共用同一个 MemoryStore 与写入门槛，不会出现「模型记了、界面看不到」。
 * 总开关落盘到 `<root>/settings.json`，关闭后模型与界面都不能再写入（已写的仍可读）。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { MemoryStore, memoryTools, type EntryMeta, type JsonSchema, type MemoryWrite, type WriteOutcome } from '@dsh-ghost/memory'

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

/** 界面通过 Remote 能用到的记忆能力。 */
export interface MemoryApi {
  list(): Promise<EntryMeta[]>
  read(name: string): Promise<string | undefined>
  write(write: MemoryWrite): Promise<WriteOutcome>
  remove(name: string): Promise<boolean>
  status(): { enabled: boolean }
  toggle(enabled: boolean): { enabled: boolean }
}

// 网关调用 Remote 方法时不保证 this 是本实例，走模块级槽位（与 orchestrator 一致）。
let memorySlot: MemoryApi | undefined
const requireApi = (): MemoryApi => {
  if (memorySlot === undefined) throw new Error('ghost-memory 未就绪')
  return memorySlot
}

/** 记忆管理的 Remote 面：界面只读/写这里，不碰文件。 */
export class GhostMemoryRemote extends TypertRemoteService {
  constructor(ctx: Context, api: MemoryApi) {
    super(ctx, 'ghostMemory', { namespace: 'ghostMemory' })
    memorySlot = api
  }

  /** 列出全部条目（名字 / 标题 / 更新时间）。 */
  @Remote('list')
  async listEntries(): Promise<{ items: EntryMeta[] }> {
    return { items: await requireApi().list() }
  }

  /** 读一条正文；条目不存在时不带 content。 */
  @Remote('read')
  async readEntry(input: { name: string }): Promise<{ name: string; content?: string }> {
    const content = await requireApi().read(input.name)
    return { name: input.name, ...(content === undefined ? {} : { content }) }
  }

  /** 写一条（同样过 gate：缺来源、一次性措辞、非法名都会被拒）。 */
  @Remote('write')
  async writeEntry(input: MemoryWrite): Promise<{ outcome: WriteOutcome }> {
    return { outcome: await requireApi().write(input) }
  }

  /** 删除一条并同步索引。 */
  @Remote('remove')
  async removeEntry(input: { name: string }): Promise<{ removed: boolean }> {
    return { removed: await requireApi().remove(input.name) }
  }

  /** 总开关当前状态。 */
  @Remote('status')
  status(): { enabled: boolean } {
    return requireApi().status()
  }

  /** 打开 / 关闭写入（关闭后模型与界面都写不进去，已写的仍可读）。 */
  @Remote('toggle')
  toggle(input: { enabled: boolean }): { enabled: boolean } {
    return requireApi().toggle(input.enabled)
  }
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

  // 总开关：落盘到 <root>/settings.json，宿主重启后仍然生效。
  const settingsPath = join(config.root, 'settings.json')
  const loadEnabled = (): boolean => {
    try {
      return (JSON.parse(readFileSync(settingsPath, 'utf8')) as { enabled?: unknown }).enabled !== false
    } catch {
      return true
    }
  }
  const saveEnabled = (value: boolean): void => {
    try {
      mkdirSync(config.root, { recursive: true })
      writeFileSync(settingsPath, `${JSON.stringify({ enabled: value, at: new Date().toISOString() }, null, 2)}\n`)
    } catch { /* 写不了不影响本次会话的开关状态 */ }
  }
  let enabled = loadEnabled()

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
        if (tool.name === 'memory_write' && !enabled) return { text: '未写入：记忆写入已关闭（可在「记忆」页打开总开关）。' }
        return { text: await tool.execute((args ?? {}) as Record<string, unknown>) }
      },
    }), `ghost-memory: ${tool.name}`)
  }

  const api: MemoryApi = {
    list: async () => { await store.init(); return store.list() },
    read: async name => { await store.init(); return store.read(name) },
    write: async write => {
      if (!enabled) return { ok: false, reasons: ['记忆写入已关闭'] }
      return store.write(write)
    },
    remove: async name => { await store.init(); return store.remove(name) },
    status: () => ({ enabled }),
    toggle: value => { enabled = value; saveEnabled(value); return { enabled } },
  }
  // 纯 Node 自检用的假 ctx 没有 ctx.reflect；真实宿主才注册 Remote 服务。
  const cordis = ctx as unknown as { reflect?: unknown }
  if (cordis.reflect !== undefined) new GhostMemoryRemote(ctx, api)

  // 自检文件：让"插件真的活着"可被外部观测（日志级别不可靠，文件不会骗人）。
  // 同时它是排障入口：谁在什么时候、以什么配置加载了哪些工具。
  try {
    mkdirSync(config.root, { recursive: true })
    const tools = memoryTools(store).map(tool => tool.name)
    writeFileSync(join(config.root, 'plugin-state.json'), JSON.stringify({
      plugin: name,
      tools,
      // 运行时自检：注册完再从服务里查回来，确认真的在册（而不是"调用没抛错"）。
      verified: tools.map(tool => ({ name: tool, present: ctx.tools.get(tool) !== undefined })),
      mode: config.mode ?? 'indexed',
      at: new Date().toISOString(),
      pid: process.pid,
    }, null, 2))
  } catch {
    // 自检文件写不了不该影响插件本身
  }
}

export type { JsonSchema }
