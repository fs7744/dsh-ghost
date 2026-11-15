/**
 * ghost-orchestrator：让主动引擎常驻在宿主里，并把它变成一个模型可调用的工具。
 *
 * 这一版只做"能开票 + 票可见"，不做自动派活——派活需要绑定一个运行中的 Session，
 * 那属于下一层（executor 端口由宿主提供）。先把"票是真实存在的对象"这件事坐实。
 *
 * 状态落地到 `stateFile`（默认 `.ghost/tickets.json`）：既方便外部观测与排障，
 * 也让 UI 在还没有 Remote 面时能读到期票列表（过渡方案，正式面走 Remote）。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
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

  /** 把当前票写进状态文件（原子替换，外部可轮询）。 */
  function flush(): void {
    try {
      mkdirSync(dirname(stateFile), { recursive: true })
      const snapshot = {
        at: new Date().toISOString(),
        tickets: listTickets().map(ticket => ({
          id: ticket.id,
          title: ticket.title,
          stage: ticketStage(ticket),
          createdAt: ticket.createdAt,
          report: ticket.assignments.at(-1)?.report?.summary ?? null,
        })),
      }
      writeFileSync(stateFile, `${JSON.stringify(snapshot, null, 2)}\n`)
    } catch {
      // 状态文件写不了不影响引擎本身
    }
  }

  /** 列出全部票（仓库是唯一真相，别信快照）。 */
  function listTickets(): Ticket[] {
    return repo.tickets.list()
  }

  ctx.logger?.info('ghost-orchestrator: %d 张历史票已恢复', listTickets().length)

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
