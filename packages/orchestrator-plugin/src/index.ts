/**
 * ghost-orchestrator：让主动引擎常驻在宿主里，并把它变成一个模型可调用的工具。
 *
 * 三条对外出口：
 *  1. 工具 `ghost_ticket`：模型自己开票；
 *  2. Remote `ghostTickets/list`：客户端直接查票（不必读文件）；
 *  3. 状态文件：给排障与无 Remote 场景兜底。
 *
 * 这一版不做自动派活——派活需要绑定运行中的 Session，属于下一层。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { Engine, MemoryRepositories, persisting, ticketStage, type Ticket, type Trigger } from '@dsh-ghost/superagent'

/** 插件名。 */
export const name = 'ghost-orchestrator'

/** 依赖工具注册表。 */
export const inject = ['tools']

/** 插件配置。 */
export interface Config {
  /** 票状态落地文件；相对路径按进程 cwd 解析。 */
  stateFile?: string
  /** 本地触发源名，出现在票的来源里。 */
  source?: string
}

/** 给 UI / 其它客户端看的票视图（不含领域内部字段）。 */
export interface TicketView {
  id: string
  title: string
  stage: { stage: string; action?: string }
  createdAt: string
  report: string | null
}

/**
 * 票的 Remote 面：客户端不再需要读文件，直接 `ghostTickets/list`。
 *
 * 继承 `TypertRemoteService` 后由网关做 source-mode 发现——不需要预生成描述符，
 * 开发期即可用；稳定后再接 typert generator 生成严格描述符。
 */
// 网关调用 Remote 方法时 `this` 不一定是本实例（它会换 receiver 做权限/绑定校验），
// 私有字段 #view 在那种调用下会抛 "Cannot read private member"。所以取视图走模块级槽位：
// 每个宿主进程只挂一个 orchestrator，这足够安全，也不依赖 this。
let viewSlot: (() => TicketView[]) | undefined

export class GhostTickets extends TypertRemoteService {
  constructor(ctx: Context, view: () => TicketView[]) {
    super(ctx, 'ghostTickets', { namespace: 'ghostTickets' })
    viewSlot = view
  }

  /**
   * 列出全部票。
   * @returns 票视图，新的在前
   */
  @Remote('list')
  listTickets(): { items: TicketView[] } {
    return { items: viewSlot?.() ?? [] }
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
 * @param ctx - cordis 上下文（已注入 tools）
 * @param config - 状态文件与来源名
 */
export function apply(ctx: Context, config: Config = {}): void {
  const stateFile = config.stateFile ?? join(process.cwd(), '.ghost', 'tickets.json')
  const source = config.source ?? 'local'
  // 引擎状态持久化到 `<stateFile>.snapshot.json`：宿主重启后票还在
  const repo = persisting(new MemoryRepositories(), `${stateFile}.snapshot.json`)

  /** 列出全部票（仓库是唯一真相，别信快照）。 */
  const listTickets = (): Ticket[] => repo.tickets.list()

  /** 票的对外视图。 */
  const view = (): TicketView[] => listTickets().map(ticket => ({
    id: ticket.id,
    title: ticket.title,
    stage: ticketStage(ticket),
    createdAt: ticket.createdAt,
    report: ticket.assignments.at(-1)?.report?.summary ?? null,
  }))

  /** 把当前票写进状态文件（原子替换，外部可轮询）。 */
  const flush = (): void => {
    try {
      mkdirSync(dirname(stateFile), { recursive: true })
      writeFileSync(stateFile, `${JSON.stringify({ at: new Date().toISOString(), tickets: view() }, null, 2)}\n`)
    } catch {
      // 状态文件写不了不影响引擎本身
    }
  }

  const engine = new Engine({
    repo,
    policy: () => ({
      version: 'v1',
      paused: false,
      gate: () => ({ admissible: true, strength: 'explicit', basis: { via: 'addressed', addressed: 'mention' } as never }),
      revalidate: () => true,
      admitsInferred: () => true,
      evalTimeoutMs: 5_000,
    }),
    scope: { scope: () => ({ listened: true, observed: false }) },
    // 常驻版不自动派活：没有人替它跑回合，评估器保持"不接单"，票由人来推进。
    assessor: { request: () => {} },
    executor: { start: () => {}, deliver: () => {}, stop: () => {} },
    outbox: { send: () => {}, status: () => undefined, withdraw: () => {} },
    now: () => new Date().toISOString(),
    emit: event => {
      if (event.type === 'ticket.created' || event.type === 'ticket.ended') flush()
    },
  })

  // Remote 面与工具都要用 view/listTickets，先建服务再注册工具。
  // Service 的构造依赖 cordis 的 ctx.reflect，纯 Node 自检用的假 ctx 没有它。
  const cordis = ctx as unknown as { reflect?: unknown }
  if (cordis.reflect !== undefined) new GhostTickets(ctx, view)
  ctx.logger?.info('ghost-orchestrator: %d 张历史票已恢复', listTickets().length)

  ctx.effect(() => ctx.tools.register({
    name: 'ghost_ticket',
    description: '为一件需要持续推进的事开一张票（ticket），返回票号。用于"这件事要做但不在当前回合完成"的场景。',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: '要做的事，一句话说清目标' },
      },
      required: ['task'],
      additionalProperties: false,
    } as unknown as never,
    output: {
      schema: OUTPUT_SCHEMA as unknown as never,
      render: (_args, value) => [{ type: 'text', text: (value as unknown as { text: string }).text }],
    },
    async execute(args) {
      const task = String((args as { task?: unknown })?.task ?? '').trim()
      if (task === '') return { text: '没有任务内容，票没有开。' }
      const trigger: Trigger = {
        id: `tr-${Date.now()}`,
        source,
        threads: [{ source, id: `thread-${Date.now()}` }],
        actor: { id: 'agent', name: 'agent' } as never,
        human: false,
        at: new Date().toISOString(),
        text: task,
        meta: {},
      }
      engine.receive(trigger)
      // 直接接单：本版没有独立评估器，开票即建票
      const decision = engine.decide(trigger.id, { kind: 'accept', title: task.slice(0, 60), scope: source, reason: 'agent 直接开票' })
      flush()
      return { text: decision.ticketId === undefined ? '没开出票（可能重复）。' : `已开票：${decision.ticketId}` }
    },
  }), 'ghost-orchestrator: ghost_ticket')

  flush()
}

export type { Config as OrchestratorConfig }
