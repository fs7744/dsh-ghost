/**
 * ghost-memory：把记忆工具与记忆管理 Remote 挂进 harness 宿主。
 *
 * 工具（`memory_list/read/write`）给模型用；`ghostMemory/*` Remote 给自建界面用，
 * 两边共用同一个 MemoryStore 与写入门槛，不会出现「模型记了、界面看不到」。
 * 总开关落盘到 `<root>/settings.json`，关闭后模型与界面都不能再写入（已写的仍可读）。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { MemoryStore, memoryTools, type EntryMeta, type JsonSchema, type MemoryWrite, type WriteOutcome } from '@dsh-ghost/memory'
import { buildMemoryBlock, countMemoryEntries } from '@dsh-ghost/economizer'
// 纯逻辑模块只做类型引用（type-only，编译后擦除）；运行时值走下方的惰性动态 import。
// 这样即使宿主 profile 未同步这些包，插件本体仍能加载，现有 ghostMemory/* 不受影响。
import type {
  CompactionConfig, ConstraintDraft, DecideInput, DecideResult, EvolutionService,
  MetricsInput, MetricsResult, Proposal, ProposeInput, ProposeResult,
} from '@dsh-ghost/evolution'
import type {
  FlowDiff, GenerateRequest, RewriteRequest, TryRunOptions, TryRunResult,
} from '@dsh-ghost/playbook'
import type { RunOutcome } from '@dsh-ghost/playbook-runtime'

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
  /** 仓库根目录，供 `ghostInit/draft` 扫描生成 GHOST.md 草案；缺省取宿主 cwd。 */
  repoRoot?: string
  /** 前置简报的字符预算，默认 1200。 */
  briefChars?: number
  /** 少于这么多条记忆就不产出简报，默认 3。 */
  briefMinEntries?: number
}

/** 工具返回值：一个文本块。 */
interface MemoryToolValue {
  text: string
}

/** 界面通过 Remote 能用到的记忆能力。 */
export interface MemoryApi {
  list(): Promise<EntryMeta[]>
  /** 给会话前置用的一小段记忆索引（条目不足时 text 为空）。 */
  brief(): Promise<{ text: string; entries: number }>
  /** 给会话前置用的一小段记忆索引（条目不足时 text 为空）。 */
  brief(): Promise<{ text: string; entries: number }>
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

// ——— 进化 / 剧本 / 初始化 / 压缩：新 Remote 与纯模块 ———
// 网关调用 Remote 方法时 this 不保证是本实例，一律走模块级槽位。
// 纯模块用惰性动态 import：宿主 profile 没同步这些包时，插件本体仍照常加载
// （现有 ghostMemory/* 完全不受影响），只有这些新端点会明确报「模块未就绪」。

type EvolutionModule = typeof import('@dsh-ghost/evolution')
type PlaybookModule = typeof import('@dsh-ghost/playbook')
type RuntimeModule = typeof import('@dsh-ghost/playbook-runtime')

let evolutionModule: EvolutionModule | undefined
let playbookModule: PlaybookModule | undefined
let runtimeModule: RuntimeModule | undefined

const loadEvolution = async (): Promise<EvolutionModule> => {
  if (evolutionModule === undefined) evolutionModule = await import('@dsh-ghost/evolution')
  return evolutionModule
}
const loadPlaybook = async (): Promise<PlaybookModule> => {
  if (playbookModule === undefined) playbookModule = await import('@dsh-ghost/playbook')
  return playbookModule
}
const loadRuntime = async (): Promise<RuntimeModule> => {
  if (runtimeModule === undefined) runtimeModule = await import('@dsh-ghost/playbook-runtime')
  return runtimeModule
}

// apply() 里写入的槽位：记忆 api、提案/脚本根、仓库根。
let evolutionApiSlot: MemoryApi | undefined
let evolutionRootSlot: string | undefined
let runtimeRootSlot: string | undefined
let repoRootSlot: string | undefined
let evolutionServicePromise: Promise<EvolutionService> | undefined
/**
 * 脚本运行时必须复用同一个实例：并发上限与幂等键都活在实例里。
 * 之前每次 Remote 调 runScript() 都新建一个，幂等键等于没用。
 */
let runtimeInstance: { root: string; runtime: import('@dsh-ghost/playbook-runtime').Runtime } | undefined

/** 惰性构造进化服务：纯模块第一次被用到时才加载。 */
const getEvolutionService = (): Promise<EvolutionService> => {
  if (evolutionServicePromise === undefined) {
    evolutionServicePromise = (async () => {
      const evo = await loadEvolution()
      const api = evolutionApiSlot
      const removeMemory = api === undefined
        ? undefined
        : async (name: string): Promise<void> => { await api.remove(name) }
      const writeMemory = api === undefined
        ? undefined
        : async (constraint: ConstraintDraft): Promise<void> => {
            // L2 项目记忆走同一个 MemoryStore + gate；名字规整成 kebab-case，来源必填。
            const name = constraint.name.toLowerCase()
              .replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63) || 'constraint'
            const outcome = await api.write({
              name,
              ...(constraint.title === '' ? {} : { title: constraint.title }),
              text: constraint.text,
              source: constraint.source === '' ? 'evolution' : constraint.source,
            })
            if (!outcome.ok) throw new Error(`写入 L2 项目记忆失败：${outcome.reasons.join('；')}`)
          }
      return evo.createEvolutionService({
        root: evolutionRootSlot ?? join(process.cwd(), '.ghost', 'memory', 'evolution'),
        ...(writeMemory === undefined ? {} : { writeMemory }),
        ...(removeMemory === undefined ? {} : { removeMemory }),
      })
    })()
  }
  return evolutionServicePromise
}

/** C10-05/06/07：记忆与剧本进化提案 + 度量看板。 */
export class GhostEvolutionRemote extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, 'ghostEvolution', { namespace: 'ghostEvolution' })
  }

  /** 列出全部提案（可查看）。 */
  @Remote('list')
  async listProposals(): Promise<{ items: Proposal[] }> {
    return { items: await (await getEvolutionService()).list() }
  }

  /** 记一次返工；同一 key 累计到 3 次才生成提案。 */
  @Remote('propose')
  async propose(input: ProposeInput): Promise<ProposeResult> {
    // typert 网关要求 Remote 参数是简单标识符、不能有默认值；缺省在这里兜。
    return (await getEvolutionService()).propose(input ?? { key: 'unnamed' })
  }

  /** 人闸批准：memory 提案写入 L2 项目记忆。 */
  @Remote('approve')
  async approve(input: DecideInput): Promise<DecideResult> {
    return (await getEvolutionService()).approve(input)
  }

  /** 人闸驳回：绝不写任何记忆或剧本文件。 */
  @Remote('reject')
  async reject(input: DecideInput): Promise<DecideResult> {
    return (await getEvolutionService()).reject(input)
  }

  /** 记录一条 run 并返回 before/after 看板。 */
  @Remote('metrics')
  async metrics(input: MetricsInput): Promise<MetricsResult> {
    return (await getEvolutionService()).metrics(input ?? {})
  }
}

/** C9-05/06/07/08/10：剧本 AI 生成/重写、diff、试跑与脚本执行。 */
export class GhostPlaybookRemote extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, 'ghostPlaybook', { namespace: 'ghostPlaybook' })
  }

  /** 一句话生成合法 .flow（产物过同一道校验，非法返回 ok:false）。 */
  @Remote('generate')
  async generate(input: GenerateRequest): Promise<{ ok: boolean; text?: string; id?: string; error?: string }> {
    try {
      const pb = await loadPlaybook()
      const result = pb.generateFlow(input ?? { prompt: '' })
      return { ok: true, text: result.text, id: result.flow.id }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  }

  /** 选中局部按一句指令重写，产物过同一道校验。 */
  @Remote('rewrite')
  async rewrite(input: RewriteRequest): Promise<{ ok: boolean; text?: string; error?: string }> {
    try {
      const pb = await loadPlaybook()
      const result = pb.rewriteFlow(input)
      return { ok: true, text: result.text }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  }

  /** 单步试跑：从某节点推演，返回轨迹与停止原因。 */
  @Remote('tryRun')
  async tryRun(input: { text: string } & TryRunOptions): Promise<{ ok: boolean; result?: TryRunResult; error?: string }> {
    try {
      const pb = await loadPlaybook()
      return { ok: true, result: pb.tryRunText(input.text, input) }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  }

  /** 两版 .flow 的结构化 + 文本 diff。 */
  @Remote('diff')
  async diff(input: { before: string; after: string }): Promise<{ ok: boolean; diff?: FlowDiff; error?: string }> {
    try {
      const pb = await loadPlaybook()
      return { ok: true, diff: pb.diffFlows(input.before, input.after) }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  }

  /** 执行编译出的 scripts/*（白名单/超时/并发/幂等/输出上限）。 */
  @Remote('runScript')
  async runScript(input: {
    script: string
    args?: string[]
    timeoutMs?: number
    idempotencyKey?: string
  }): Promise<{ ok: boolean; outcome?: RunOutcome; error?: string }> {
    try {
      const rt = await loadRuntime()
      const root = runtimeRootSlot ?? process.cwd()
      if (runtimeInstance === undefined || runtimeInstance.root !== root) {
        runtimeInstance = { root, runtime: rt.createRuntime({ packageRoot: root }) }
      }
      const outcome = await runtimeInstance.runtime.run({
        script: input.script,
        ...(input.args === undefined ? {} : { args: input.args }),
        ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
        ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
      })
      return { ok: true, outcome }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  }
}

/** C11-07：扫描仓库生成 GHOST.md 草案（只返回草案，不覆盖既有文件）。 */
export class GhostInitRemote extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, 'ghostInit', { namespace: 'ghostInit' })
  }

  @Remote('draft')
  async draft(input: { root?: string }): Promise<{
    ok: boolean
    content?: string
    sources?: string[]
    uncertainties?: string[]
    wouldWrite?: boolean
    error?: string
  }> {
    try {
      const evo = await loadEvolution()
      // `/init` 只该扫当前仓库；Remote 调用方传任意 root 会把扫描面扩到整台机器。
      const base = resolve(repoRootSlot ?? process.cwd())
      const requested = resolve(input?.root ?? base)
      const rel = relative(base, requested)
      if (rel.startsWith('..') || isAbsolute(rel)) {
        return { ok: false, error: `只允许扫描仓库内目录：${requested}` }
      }
      const scan = await evo.scanRepo(requested)
      const result = evo.draftGhostMd(scan)
      return {
        ok: true,
        content: result.content,
        sources: result.sources,
        uncertainties: result.uncertainties,
        wouldWrite: result.wouldWrite,
      }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  }
}

/** C11-03：压缩策略配置的校验与序列化（settings 形态）。 */
export class GhostCompactionRemote extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, 'ghostCompaction', { namespace: 'ghostCompaction' })
  }

  @Remote('config')
  async config(input: { config?: unknown }): Promise<{
    ok: boolean
    config?: CompactionConfig
    settings?: string
    errors?: string[]
  }> {
    try {
      const evo = await loadEvolution()
      if (input?.config === undefined) {
        const defaults = evo.DEFAULT_COMPACTION
        return { ok: true, config: defaults, settings: evo.toSettingsJson(defaults) }
      }
      const verdict = evo.validateCompaction(input.config)
      if (!verdict.ok) return { ok: false, errors: verdict.errors }
      const config = evo.normalizeCompaction(input.config)
      return { ok: true, config, settings: evo.toSettingsJson(config) }
    } catch (error) {
      return { ok: false, errors: [String(error)] }
    }
  }
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

  /** 前置简报：把索引压成一小段，供桌面聊天/开票在模型看到上下文之前注入。 */
  @Remote('brief')
  async brief(): Promise<{ text: string; entries: number }> {
    return requireApi().brief()
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
    brief: async () => {
      await store.init()
      const index = await store.resident()
      const text = buildMemoryBlock(index, {
        maxChars: config.briefChars ?? 1200,
        minEntries: config.briefMinEntries ?? 3,
      })
      return { text, entries: countMemoryEntries(index) }
    },
    read: async name => { await store.init(); return store.read(name) },
    write: async write => {
      if (!enabled) return { ok: false, reasons: ['记忆写入已关闭'] }
      return store.write(write)
    },
    remove: async name => { await store.init(); return store.remove(name) },
    status: () => ({ enabled }),
    toggle: value => { enabled = value; saveEnabled(value); return { enabled } },
  }
  // 新 Remote 的槽位：无论是否真实宿主都备好，纯 Node 自检也能拿到一致配置。
  evolutionApiSlot = api
  evolutionRootSlot = join(config.root, 'evolution')
  runtimeRootSlot = join(config.root, 'scripts')
  repoRootSlot = config.repoRoot ?? process.cwd()
  // 纯 Node 自检用的假 ctx 没有 ctx.reflect；真实宿主才注册 Remote 服务。
  const cordis = ctx as unknown as { reflect?: unknown }
  if (cordis.reflect !== undefined) {
    new GhostMemoryRemote(ctx, api)
    new GhostEvolutionRemote(ctx)
    new GhostPlaybookRemote(ctx)
    new GhostInitRemote(ctx)
    new GhostCompactionRemote(ctx)
  }

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
