/**
 * ghost-orchestrator：让主动引擎常驻在宿主里，并把它变成一个模型可调用的工具。
 *
 * 五条对外出口：
 *  1. 工具 `ghost_ticket`：模型自己开票；
 *  2. Remote `ghostTickets/list`、`ghostTickets/get`：客户端查票（不必读文件）；
 *  3. Remote `ghostTickets/accept`：接收已归一化的事件；
 *  4. Remote `ghostSources/*`：可插拔信息源（内置 / 声明式 / 用户 mapper），原始投递在这里归一化；
 *  5. Outbox：票跑完把结果回写到来源会话；配置 `github` 时经 GitHub 评论出口投递。
 *
 * 执行器常驻：开票后自动把票标题 `followup` 进驱动会话，等 `turn/end`，
 * 把最后一条 assistant 文本作为报告交回 Engine，再用 `result` 把结果排队到 Outbox。
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { createGithubSink } from '@dsh-ghost/sink-github'
import { createRegistry, importMapper, type SourceSpec, type SourceSummary } from '@dsh-ghost/source-hub'
import { Engine, MemoryRepositories, persisting, ticketStage, type Ticket, type Trigger } from '@dsh-ghost/superagent'
import { SettingsStore, TOOL_DESCRIPTORS } from '@dsh-ghost/superagent/tools'
import {
  buildDeployView, buildOverviewView, buildRecordsView, buildSettingsView,
  buildSourcesView, buildThreadsView, buildTicketsView, renderViewText,
} from '@dsh-ghost/superagent/views'

/** 插件名。 */
export const name = 'ghost-orchestrator'

/**
 * 依赖：工具注册表必需；会话与 agent 是执行器要用的宿主服务。
 * 用 `inject` 声明（而不是可选依赖）是为了让 cordis 等它们就绪后再 apply，
 * 否则惰性 getter 会在开票那一刻才发现服务还没挂上，票就永远排队。
 */
export const inject = ['tools', 'sessions', 'agents']

/** GitHub 评论出口配置。缺省时不外发，票照常跑完。 */
export interface GithubOutboxConfig {
  /** 有 `repo` 权限的令牌。 */
  token: string
  /** 目标仓库，形如 `owner/name`。 */
  repo: string
  /** API 基址，默认公有云；自建/假服务器可覆盖。 */
  apiBase?: string
}

/** 插件配置。 */
export interface Config {
  /** 票状态落地文件；相对路径按进程 cwd 解析。 */
  stateFile?: string
  /** 本地触发源名，出现在票的来源里。 */
  source?: string
  /**
   * 用哪个会话跑票。缺省时取"最新创建的活动会话"——单用户桌面端的合理默认；
   * 多会话场景应显式配置。
   */
  driveSession?: string
  /** 等一个回合的最长时间（毫秒），默认 120s；真模型偶发变慢，别太短。 */
  turnTimeoutMs?: number
  /** 配置后才启用 GitHub 评论出口；不配则 Outbox 只排队不外发。 */
  github?: GithubOutboxConfig
  /** Outbox 兜底投递间隔（毫秒），默认 10s；报告完成时也会立即 flush。 */
  flushIntervalMs?: number
  /**
   * 信息源配置。缺省只挂一个 passthrough；用户可任意组合内置适配器、
   * 声明式映射或自己的 .mjs mapper，见 docs/SOURCES.md。
   */
  sources?: SourceSpec[]
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
let acceptSlot: ((input: AcceptInput) => { ticketId: string }) | undefined
let detailSlot: ((id: string) => TicketDetail | undefined) | undefined
let sourcesSlot: ReturnType<typeof createRegistry> | undefined

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

  /**
   * 收下一条外部事件并开票（来源适配器用：GitHub / IM / 脚本）。
   * @param input - 已校验并归一化的事件
   * @returns 新票的 id
   */
  @Remote('accept')
  acceptTicket(input: AcceptInput): { ticketId: string } {
    const accept = acceptSlot
    if (accept === undefined) throw new Error('orchestrator 未就绪')
    return accept(input)
  }

  /**
   * 取一张票的详情。
   * @param input - 票号
   * @returns 详情，找不到返回 undefined
   */
  @Remote('get')
  getTicket(input: { id: string }): { ticket?: TicketDetail } {
    return { ...(detailSlot?.(input.id) === undefined ? {} : { ticket: detailSlot?.(input.id) as TicketDetail }) }
  }
}

/** 票详情（含派活历史），给界面的详情页用。 */
export interface TicketDetail extends TicketView {
  inputs: number
  assignments: Array<{ id: string; state: string; report: { state: string; summary: string } | null }>
}

/** 来源会话地址；`address.number` 是 issue/PR 编号，出口据此决定评论发到哪。 */
export interface AcceptChannel {
  source: string
  thread: string
  address: Record<string, string>
}

/** 外部事件归一化后的输入。 */
export interface AcceptInput {
  /** 来源名，如 `github`。 */
  source: string
  /** 线程标识，如 `fs7744/dsh-ghost#12`；同线程事件会聚到一起。 */
  threadId: string
  /** 事件正文。 */
  text: string
  /** 是否人写的。 */
  human?: boolean
  /** 是否点名了 agent。 */
  addressed?: boolean
  /** 原始链接。 */
  url?: string
  /** 发起者。 */
  actor?: string
  /** 来源会话地址。带上它，票跑完才能把结果回写到同一条会话。 */
  channel?: AcceptChannel
}

/** 一次原始投递。`rawBody` 必须传原始字节字符串，HMAC 签名才校验得过。 */
export interface IngestInput {
  sourceId: string
  headers?: Record<string, string>
  rawBody?: string
  body?: unknown
  event?: string
}

/** 信息源的 Remote 面：列出来源、把原始投递归一化后开票。 */
export class GhostSources extends TypertRemoteService {
  constructor(ctx: Context, registry: ReturnType<typeof createRegistry>) {
    super(ctx, 'ghostSources', { namespace: 'ghostSources' })
    sourcesSlot = registry
  }

  /**
   * 列出当前启用的来源（不含任何密钥）。
   * @returns 来源摘要
   */
  @Remote('list')
  listSources(): { items: SourceSummary[] } {
    return { items: sourcesSlot?.list() ?? [] }
  }

  /**
   * 收下一次原始投递：校验签名 → 适配器归一化 → 逐条开票。
   * @param input - 来源 id 与原始请求材料
   * @returns 开出的票号；拒绝时带 reason
   */
  @Remote('ingest')
  async ingestSource(input: IngestInput): Promise<{ accepted: number; ticketIds: string[]; reason?: string }> {
    const registry = sourcesSlot
    if (registry === undefined) throw new Error('source hub 未就绪')
    const body = input.body ?? {}
    const result = await registry.normalize(input.sourceId, {
      headers: input.headers ?? {},
      rawBody: input.rawBody ?? JSON.stringify(body),
      body,
      ...(input.event === undefined ? {} : { event: input.event }),
    })
    if (!result.ok) return { accepted: 0, ticketIds: [], ...(result.reason === undefined ? {} : { reason: result.reason }) }
    const accept = acceptSlot
    if (accept === undefined) return { accepted: 0, ticketIds: [], reason: 'orchestrator 未就绪' }
    const ticketIds: string[] = []
    for (const event of result.events) ticketIds.push(accept(event).ticketId)
    return { accepted: ticketIds.length, ticketIds }
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
 * @param ctx - cordis 上下文（已注入 tools / sessions / agents）
 * @param config - 状态文件、来源名与可选的 GitHub 出口
 */
export function apply(ctx: Context, config: Config = {}): void {
  const stateFile = config.stateFile ?? join(process.cwd(), '.ghost', 'tickets.json')
  const source = config.source ?? 'local'
  // 引擎状态持久化到 `<stateFile>.snapshot.json`：宿主重启后票还在
  const repo = persisting(new MemoryRepositories(), `${stateFile}.snapshot.json`)

  /**
   * GitHub 出口只在显式配置、或本地测试用 GH_API_BASE 指向兼容端点时启用。
   * 未启用时 Engine 的 Outbox 仍然排队（幂等），只是不往网络发——避免误发到真实仓库。
   */
  const github: GithubOutboxConfig | undefined = config.github ?? (
    process.env.GH_API_BASE !== undefined
      ? {
          apiBase: process.env.GH_API_BASE,
          token: process.env.GH_TOKEN ?? '',
          repo: process.env.GH_REPO ?? 'local/local',
        }
      : undefined
  )
  const sink = github === undefined ? undefined : createGithubSink({
    token: github.token,
    repo: github.repo,
    ...(github.apiBase === undefined ? {} : { apiBase: github.apiBase }),
  })
  const outbox = sink ?? { send: () => {}, status: () => undefined, withdraw: () => {} }
  /** 出口排障：状态文件里能看到它是否启用、上一次回复排队是否成功。 */
  const outboxDiag: { enabled: boolean; lastError?: string; lastReplyId?: string } = { enabled: sink !== undefined }

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
      const replies = sink?.entries().map(entry => ({
        id: entry.message.id,
        kind: entry.message.kind,
        status: entry.status,
        target: entry.message.channel.address?.number ?? null,
        ...(entry.error === undefined ? {} : { error: entry.error }),
      })) ?? []
      mkdirSync(dirname(stateFile), { recursive: true })
      writeFileSync(stateFile, `${JSON.stringify({ at: new Date().toISOString(), tickets: view(), replies, outbox: outboxDiag }, null, 2)}\n`)
    } catch {
      // 状态文件写不了不影响引擎本身
    }
  }

  /** 宿主侧的会话服务（有它才能把票跑起来；没有就只排队）。 */
  interface SessionLike {
    readonly seq: number
    snapshotEvents(offset: number): Array<{ type: string; data?: { message?: { content?: Array<{ type: string; text?: string }> }; reason?: { kind?: string } } }>
  }
  /** 惰性取宿主服务：apply 阶段它们可能还没就绪，取不到就当没有。 */
  const host = {
    get sessions() {
      try { return (ctx as unknown as { sessions?: { get(id: string): SessionLike | undefined; list(): SessionLike[] } }).sessions } catch { return undefined }
    },
    get agents() {
      try { return (ctx as unknown as { agents?: { get(id: string): { followup(message: unknown): void } | undefined } }).agents } catch { return undefined }
    },
  }

  /**
   * 等驱动会话里出现新的 turn/end，并把最后的 assistant 文本取回来。
   * 与宿主自己的做法一致：从 fromSeq 读快照事件，不逐个猜 seq。
   * 兜底：模型已产出文本且日志 10s 不再增长时视为回合结束（有些回合不写 turn/end）。
   */
  const waitForTurn = async (sessionId: string, fromSeq: number, timeoutMs: number): Promise<{ text: string; reason: string; types: string[] }> => {
    const deadline = Date.now() + timeoutMs
    let lastSeq = fromSeq
    let stableSince = Date.now()
    let lastText = ''
    let lastTypes: string[] = []
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 500))
      const session = host.sessions?.get(sessionId)
      if (session === undefined) continue
      let text = ''
      let reason: string | undefined
      const types: string[] = []
      for (const event of session.snapshotEvents(fromSeq)) {
        types.push(event.type)
        if (event.type === 'assistant/message') {
          const joined = (event.data?.message?.content ?? []).filter(part => part.type === 'text').map(part => part.text ?? '').join('')
          if (joined !== '') text = joined
        }
        if (event.type === 'turn/end') reason = event.data?.reason?.kind ?? 'end'
      }
      lastText = text
      lastTypes = types
      if (reason !== undefined) return { text, reason, types }
      if (session.seq !== lastSeq) {
        lastSeq = session.seq
        stableSince = Date.now()
      } else if (text !== '' && Date.now() - stableSince > 10_000) {
        return { text, reason: 'idle', types }
      }
    }
    return { text: lastText, reason: 'timeout', types: lastTypes }
  }

  let engine: Engine
  let drive = config.driveSession

  /** 把票的结果排进 Outbox 并立即投递一次（幂等，重复 flush 不会刷屏）。 */
  const deliverResult = (ticketId: string, text: string): void => {
    if (sink === undefined) return
    try {
      const reply = engine.reply({ purpose: 'result', ticketId, text })
      outboxDiag.lastReplyId = reply.id
      delete outboxDiag.lastError
    } catch (error) {
      // 没有来源 channel、或票还没到可回复阶段时，领域会拒绝；票本身仍然有效。
      outboxDiag.lastError = String(error)
      ctx.logger?.warn('ghost-orchestrator: 结果回复未排队：%s', String(error))
    }
    void sink.flush().then(() => flush()).catch(() => {})
  }

  /** 执行器：把票变成一次真实回合，再把结果写回票、回写到来源会话。 */
  const startAssignment = (ticket: Ticket, assignment: { id: string }): void => {
    const target = driveSessionId()
    if (target === undefined) return
    const agent = host.agents?.get(target)
    const session = host.sessions?.get(target)
    if (agent === undefined || session === undefined) return
    const fromSeq = session.seq
    engine.assignmentStarted(ticket.id, assignment.id)
    try {
      // 形状对齐宿主的 createUserMessage：id 由我们生成，source 只带 kind。
      agent.followup({
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: ticket.title }],
        source: { kind: 'user' },
      })
    } catch (error) {
      engine.report(ticket.id, { state: 'failed', summary: `followup 失败：${String(error).slice(0, 100)}` })
      flush()
      return
    }
    void (async () => {
      const turn = await waitForTurn(target, fromSeq, config.turnTimeoutMs ?? 120_000)
      const now = host.sessions?.get(target)?.seq ?? -1
      if (turn.reason === 'timeout') {
        const tail = turn.types.slice(-14).join(',') || '(无事件)'
        engine.report(ticket.id, { state: 'failed', summary: `回合超时（${target.slice(-6)} seq ${fromSeq}→${now}）事件 ${tail}` })
        flush()
        return
      }
      const summary = turn.text.slice(0, 400) || `回合结束（${turn.reason}）`
      engine.report(ticket.id, { state: 'ready', summary })
      flush()
      deliverResult(ticket.id, summary)
    })()
  }

  /** 选驱动会话：显式配置优先，否则取最新创建的活动会话。 */
  const driveSessionId = (): string | undefined => {
    if (drive !== undefined && drive !== '') return drive
    const live = host.sessions?.list() ?? []
    const last = live.at(-1) as unknown as { id?: string } | undefined
    const candidate = last?.id
    if (candidate !== undefined) { drive = candidate; return candidate }
    return undefined
  }

  engine = new Engine({
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
    // 外部事件走 accept() 直接判定，不需要再花一次模型调用做"要不要接单"的评估。
    assessor: { request: () => {} },
    executor: {
      start: startAssignment,
      deliver: () => {},
      stop: () => {},
    },
    outbox,
    now: () => new Date().toISOString(),
    emit: event => {
      if (event.type === 'ticket.created' || event.type === 'ticket.ended') flush()
    },
  })

  // B3：把 19 个 orchestrator_* 会话工具真正注册给模型。
  // 描述符早就写好了，但如果不注册，它们在运行时等于不存在（模型永远调不到）。
  const toolConfig = new SettingsStore({ policyVersion: 'v1' })
  const toolContext = {
    repo,
    engine,
    config: toolConfig,
    views: {
      /** 视图要反映「当前」仓储状态，所以每次读都现算，不缓存快照。 */
      read: (view: string): string | undefined => {
        const builders: Record<string, () => ReturnType<typeof buildOverviewView>> = {
          overview: () => buildOverviewView(repo),
          tickets: () => buildTicketsView(repo),
          records: () => buildRecordsView(repo),
          threads: () => buildThreadsView(repo),
          sources: () => buildSourcesView(repo),
          settings: () => buildSettingsView(repo),
          deploy: () => buildDeployView(repo),
        }
        const build = builders[view]
        return build === undefined ? undefined : renderViewText(build())
      },
    },
  }
  for (const descriptor of TOOL_DESCRIPTORS) {
    ctx.effect(() => ctx.tools.register({
      name: descriptor.name,
      description: descriptor.description,
      parameters: descriptor.parameters as unknown as never,
      output: {
        schema: OUTPUT_SCHEMA as unknown as never,
        render: (_args, value) => [{ type: 'text', text: (value as unknown as { text: string }).text }],
      },
      async execute(args) {
        try {
          return { text: descriptor.handler((args ?? {}) as Record<string, unknown>, toolContext) }
        } catch (error) {
          // 领域拒绝（UserError）原样给人话，让模型据此改参数自愈。
          return { text: `未执行：${String(error)}` }
        }
      },
    }), `ghost-orchestrator: ${descriptor.name}`)
  }

  // Outbox 兜底投递：attention / acknowledgement 也能发出去，失败留 pending 等下一轮重试。
  if (sink !== undefined) {
    const intervalMs = config.flushIntervalMs ?? 10_000
    ctx.effect(() => {
      const timer = setInterval(() => { void sink.flush().catch(() => {}) }, intervalMs)
      timer.unref()
      return () => clearInterval(timer)
    }, 'ghost-orchestrator: outbox flush')
  }

  // Remote 面与工具都要用 view/listTickets，先建服务再注册工具。
  // Service 的构造依赖 cordis 的 ctx.reflect，纯 Node 自检用的假 ctx 没有它。
  const sources: SourceSpec[] = config.sources ?? [
    { id: 'passthrough', kind: 'passthrough', description: '归一化事件直投（默认）' },
  ]
  const registry = createRegistry(sources, { importMapper })
  const cordis = ctx as unknown as { reflect?: unknown }
  if (cordis.reflect !== undefined) {
    new GhostTickets(ctx, view)
    new GhostSources(ctx, registry)
  }
  ctx.logger?.info('ghost-orchestrator: %d 个信息源已注册', sources.length)

  /** 开票的共用实现：工具与 accept Remote 都走这里。 */
  const accept = (input: AcceptInput): { ticketId: string } => {
    const trigger: Trigger = {
      id: `tr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      source: input.source,
      threads: [{ source: input.source, id: input.threadId }],
      actor: { id: input.actor ?? input.source, name: input.actor ?? input.source } as never,
      human: input.human ?? false,
      ...(input.addressed === true ? { addressed: 'mention' as const } : {}),
      at: new Date().toISOString(),
      text: input.text,
      ...(input.url === undefined ? {} : { url: input.url }),
      ...(input.channel === undefined ? {} : { channel: input.channel as never }),
      meta: { via: 'remote-accept' },
    }
    engine.receive(trigger)
    // 同线程已有票时，新消息是那张票的输入（followup），不该再建票；
    // 此时 decide 会被领域拒绝（"its worker decides whether it belongs there"）。
    const fanout = repo.triggers.disposition(trigger.id)?.fanout ?? []
    if (fanout.length > 0) {
      flush()
      return { ticketId: fanout[0] as string }
    }
    const decision = engine.decide(trigger.id, { kind: 'accept', title: input.text.slice(0, 60), scope: input.source, reason: '外部事件' })
    flush()
    return { ticketId: decision.ticketId ?? '' }
  }
  acceptSlot = accept

  /** 票详情：派活历史与输入数。 */
  const detail = (id: string): TicketDetail | undefined => {
    const ticket = repo.tickets.get(id)
    if (ticket === undefined) return undefined
    return {
      id: ticket.id,
      title: ticket.title,
      stage: ticketStage(ticket),
      createdAt: ticket.createdAt,
      report: ticket.assignments.at(-1)?.report?.summary ?? null,
      inputs: ticket.inputs.length,
      assignments: ticket.assignments.map(assignment => ({
        id: assignment.id,
        state: assignment.state,
        report: assignment.report === undefined
          ? null
          : { state: assignment.report.state, summary: assignment.report.summary },
      })),
    }
  }
  detailSlot = detail
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
      const { ticketId } = accept({ source, threadId: `thread-${Date.now()}`, text: task })
      return { text: ticketId === '' ? '没开出票（可能重复）。' : `已开票：${ticketId}` }
    },
  }), 'ghost-orchestrator: ghost_ticket')

  flush()
}

export type { Config as OrchestratorConfig }
