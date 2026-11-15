/**
 * 19 个会话工具：描述符 + 处理器，统一注册、统一拒绝语义。
 *
 * 三条约定：
 *  1. 描述符的 description 是给模型看的说明书，每条不超过 120 字符；
 *  2. handler 只调 ctx 里可注入的 Repositories / Engine / ConfigStore / ViewReader，零 harness 依赖；
 *  3. 返回值一律是人话文本；领域拒绝（UserError）由 invokeTool 把原因原样返回，让模型据此自愈。
 *
 * 这里只产出描述符，不调用 harness 的 tools.register，也不改 contracts.ts。
 */

import { UserError, reasonText, threadKey, ticketStage } from '../core/index.ts'
import type { Outcome, ReplyRequest, ReportState, WorkerReport } from '../core/index.ts'
import type { ToolArgs, ToolContext, ToolDescriptor } from './types.ts'

/** 从外部参数里取一个非空字符串；缺失或类型不对返回 null，由 handler 回人话提示。 */
function text(args: ToolArgs, key: string): string | null {
  const value = args[key]
  return typeof value === 'string' && value !== '' ? value : null
}
/** 取一个可选字符串；缺失返回 undefined，便于 exactOptionalPropertyTypes 下条件展开。 */
function optionalText(args: ToolArgs, key: string): string | undefined {
  const value = args[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

const REPORT_STATES = ['progress', 'waiting', 'ready', 'blocked', 'failed', 'dropped'] as const
const REPLY_PURPOSES = ['acknowledgement', 'answer', 'result', 'attention'] as const
type ReplyPurpose = typeof REPLY_PURPOSES[number]

/** 把 state 参数收窄成 ReportState，非法值返回 null。 */
function reportState(args: ToolArgs): ReportState | null {
  const value = text(args, 'state')
  if (value === null) return null
  return (REPORT_STATES as readonly string[]).includes(value) ? (value as ReportState) : null
}

/** route 与 eval_decide 共用的 Outcome 构造；返回字符串表示参数不合法的人话提示。 */
function buildOutcome(args: ToolArgs): Outcome | string {
  const kind = text(args, 'kind')
  const reason = optionalText(args, 'reason') ?? '主会话判定'
  const evalId = optionalText(args, 'evalId')
  const withEval = evalId === undefined ? {} : { evalId }
  switch (kind) {
    case 'accept': {
      const title = text(args, 'title')
      const scope = text(args, 'scope')
      if (title === null || scope === null) return 'accept 需要 title 与 scope 两个文本参数。'
      const name = optionalText(args, 'name')
      const note = optionalText(args, 'note')
      return {
        kind: 'accept', title, scope, reason, ...withEval,
        ...(name === undefined ? {} : { name }),
        ...(note === undefined ? {} : { note }),
      }
    }
    case 'stop': {
      const ticketId = text(args, 'ticketId')
      if (ticketId === null) return 'stop 需要 ticketId（要叫停的票号）。'
      return { kind: 'stop', ticketId, reason, ...withEval }
    }
    case 'ignore':
      return { kind: 'ignore', reason, ...withEval }
    case 'unavailable':
      return { kind: 'unavailable', reason, ...withEval }
    default:
      return `未知的 kind：${kind ?? '(空)'}。可用 accept / stop / ignore / unavailable；把消息附到现有票请用 kind=route。`
  }
}

/** 19 个工具的完整注册表，顺序即账本 §B3 的顺序。 */
export const TOOL_DESCRIPTORS: readonly ToolDescriptor[] = [
  {
    name: 'orchestrator_ack',
    description: '确认收到某人的消息并接管：把确认排到该消息所在的会话。',
    parameters: {
      type: 'object',
      properties: {
        ticketId: { type: 'string', description: '票号' },
        triggerId: { type: 'string', description: '人写的触发消息 id' },
        text: { type: 'string', description: '确认文案' },
      },
      required: ['ticketId', 'triggerId', 'text'],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const ticketId = text(args, 'ticketId')
      const triggerId = text(args, 'triggerId')
      const body = text(args, 'text')
      if (ticketId === null || triggerId === null || body === null) return '缺少 ticketId / triggerId / text，请补齐后再调用。'
      const reply = ctx.engine.reply({ purpose: 'acknowledgement', ticketId, triggerId, text: body })
      return `已确认接管（${reply.id}，状态 ${reply.status}${reply.reused ? '，此前已排过一次' : ''}）。`
    },
  },
  {
    name: 'orchestrator_thread_unrelated',
    description: '把某线程标为与票无关：只退掉该票对这个线程的订阅。',
    parameters: {
      type: 'object',
      properties: {
        ticketId: { type: 'string', description: '票号' },
        thread: { type: 'string', description: '线程键' },
        reason: { type: 'string', description: '为什么无关' },
      },
      required: ['ticketId', 'thread', 'reason'],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const ticketId = text(args, 'ticketId')
      const thread = text(args, 'thread')
      const reason = text(args, 'reason')
      if (ticketId === null || thread === null || reason === null) return '缺少 ticketId / thread / reason，请补齐后再调用。'
      ctx.engine.markUnrelated(ticketId, thread, reason)
      return `已把线程 ${thread} 标为与票 ${ticketId} 无关，该票不再订阅它。`
    },
  },
  {
    name: 'orchestrator_thread_follow',
    description: '让票把某线程当只读上下文订阅，便于 worker 读到相关讨论。',
    parameters: {
      type: 'object',
      properties: {
        ticketId: { type: 'string', description: '票号' },
        source: { type: 'string', description: '线程所属来源' },
        threadId: { type: 'string', description: '来源内的线程 id' },
      },
      required: ['ticketId', 'source', 'threadId'],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const ticketId = text(args, 'ticketId')
      const source = text(args, 'source')
      const threadId = text(args, 'threadId')
      if (ticketId === null || source === null || threadId === null) return '缺少 ticketId / source / threadId，请补齐后再调用。'
      const added = ctx.engine.followForContext(ticketId, { source, id: threadId })
      return added
        ? `票 ${ticketId} 已把线程 ${source}:${threadId} 当只读上下文订阅。`
        : `票 ${ticketId} 已经订阅了该线程，无需重复。`
    },
  },
  {
    name: 'orchestrator_trigger_handback',
    description: 'worker 把超出本票范围的消息交回主会话，必要时重新排队评估。',
    parameters: {
      type: 'object',
      properties: {
        ticketId: { type: 'string', description: '票号' },
        triggerId: { type: 'string', description: '要交回的消息 id' },
        reason: { type: 'string', description: '为什么超出本票' },
      },
      required: ['ticketId', 'triggerId', 'reason'],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const ticketId = text(args, 'ticketId')
      const triggerId = text(args, 'triggerId')
      const reason = text(args, 'reason')
      if (ticketId === null || triggerId === null || reason === null) return '缺少 ticketId / triggerId / reason，请补齐后再调用。'
      const queued = ctx.engine.handback(ticketId, triggerId, reason)
      return queued
        ? `已把消息 ${triggerId} 交回主会话，并排入新的评估。`
        : `已记下交回，但仍有其它票负责该消息，暂不重新评估。`
    },
  },
  {
    name: 'orchestrator_report',
    description: '执行器汇报一张票的进展：状态、摘要，可带向人提问或答复。',
    parameters: {
      type: 'object',
      properties: {
        ticketId: { type: 'string', description: '票号' },
        state: { type: 'string', enum: [...REPORT_STATES], description: '进展状态' },
        summary: { type: 'string', description: '一句话摘要' },
        question: { type: 'string', description: '要问人的问题；传 null 清除已有问题' },
        askedBy: { type: 'string', description: '提出问题的人的消息 id' },
        answers: { type: 'string', description: '本票回答的人的问题消息 id' },
      },
      required: ['ticketId', 'state', 'summary'],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const ticketId = text(args, 'ticketId')
      const state = reportState(args)
      const summary = text(args, 'summary')
      if (ticketId === null) return '缺少 ticketId。'
      if (state === null) return `state 必须是 ${REPORT_STATES.join(' / ')} 之一。`
      if (summary === null) return '缺少 summary。'
      const rawQuestion = args['question']
      const question: string | null | undefined = rawQuestion === null ? null
        : typeof rawQuestion === 'string' && rawQuestion !== '' ? rawQuestion : undefined
      const askedBy = optionalText(args, 'askedBy')
      const answers = optionalText(args, 'answers')
      const report: WorkerReport = {
        state, summary,
        ...(question === undefined ? {} : { question }),
        ...(askedBy === undefined ? {} : { askedBy }),
        ...(answers === undefined ? {} : { answers }),
      }
      const ticket = ctx.engine.report(ticketId, report)
      const stage = ticketStage(ticket)
      const detail = 'action' in stage && stage.action !== undefined ? `/${stage.action}` : ''
      return `已记录报告（${state}）：${summary}。票当前阶段 ${stage.stage}${detail}。`
    },
  },
  {
    name: 'orchestrator_route',
    description: '主会话路由一条显式请求：接受开票、叫停、忽略，或附到现有票。',
    parameters: {
      type: 'object',
      properties: {
        triggerId: { type: 'string', description: '触发消息 id' },
        kind: { type: 'string', enum: ['accept', 'stop', 'route', 'ignore', 'unavailable'], description: '路由决定' },
        ticketId: { type: 'string', description: 'route / stop 时的票号' },
        title: { type: 'string', description: 'accept 时的短标题' },
        scope: { type: 'string', description: 'accept 时的范围' },
        reason: { type: 'string', description: '判定理由' },
        note: { type: 'string', description: 'route 时给 worker 的附言' },
        name: { type: 'string', description: 'accept 时票的短名' },
        evalId: { type: 'string', description: '判定所针对的评估 id' },
      },
      required: ['triggerId', 'kind'],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const triggerId = text(args, 'triggerId')
      const kind = text(args, 'kind')
      if (triggerId === null) return '缺少 triggerId。'
      if (kind === 'route') {
        const ticketId = text(args, 'ticketId')
        if (ticketId === null) return 'kind=route 需要 ticketId（要附到的票号）。'
        const ticket = ctx.engine.attach(ticketId, triggerId, optionalText(args, 'note'))
        return `已把消息 ${triggerId} 附到票 ${ticketId}（${ticket.title}）。`
      }
      const outcome = buildOutcome(args)
      if (typeof outcome === 'string') return outcome
      const decision = ctx.engine.decide(triggerId, outcome)
      return `已记录决策 ${decision.id}（${decision.kind}${decision.ticketId === undefined ? '' : '，票 ' + decision.ticketId}）。`
    },
  },
  {
    name: 'orchestrator_ticket_retry',
    description: '重试一张卡住的票：结束旧派活，在同一授权下起一个新派活。',
    parameters: {
      type: 'object',
      properties: { ticketId: { type: 'string', description: '票号' } },
      required: ['ticketId'],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const ticketId = text(args, 'ticketId')
      if (ticketId === null) return '缺少 ticketId。'
      ctx.engine.retryTicket(ticketId)
      return `已重试票 ${ticketId}：旧派活结束，新派活已启动。`
    },
  },
  {
    name: 'orchestrator_ticket_request_status',
    description: '请正在等待输入的 worker 报一次状态；其它状态的 worker 不打扰。',
    parameters: {
      type: 'object',
      properties: { ticketId: { type: 'string', description: '票号' } },
      required: ['ticketId'],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const ticketId = text(args, 'ticketId')
      if (ticketId === null) return '缺少 ticketId。'
      const asked = ctx.engine.requestStatus(ticketId)
      return asked
        ? `已向票 ${ticketId} 的 worker 请求状态（它正等待输入）。`
        : `票 ${ticketId} 的 worker 不在等待状态，未打扰它。`
    },
  },
  {
    name: 'orchestrator_ticket_note',
    description: '给一张未结束的票追加一条事实注记：只作上下文，不派活、不授权。',
    parameters: {
      type: 'object',
      properties: {
        ticketId: { type: 'string', description: '票号' },
        text: { type: 'string', description: '注记正文' },
      },
      required: ['ticketId', 'text'],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const ticketId = text(args, 'ticketId')
      const body = text(args, 'text')
      if (ticketId === null || body === null) return '缺少 ticketId / text，请补齐后再调用。'
      const ticket = ctx.engine.note(ticketId, body)
      return `已给票 ${ticketId} 追加一条事实注记（当前输入 ${ticket.inputs.length} 条）。`
    },
  },
  {
    name: 'orchestrator_trigger_requeue',
    description: '把一条已存触发重新排队做评估；正被评估持有的不会重复排。',
    parameters: {
      type: 'object',
      properties: { triggerId: { type: 'string', description: '触发消息 id' } },
      required: ['triggerId'],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const triggerId = text(args, 'triggerId')
      if (triggerId === null) return '缺少 triggerId。'
      const queued = ctx.engine.reevaluate(triggerId)
      return queued
        ? `已把触发 ${triggerId} 重新排队做评估。`
        : `触发 ${triggerId} 正被某个评估持有，暂不重复排队。`
    },
  },
  {
    name: 'orchestrator_eval',
    description: '取某触发当前等待评估的候选，交给评估者判断值不值得做。',
    parameters: {
      type: 'object',
      properties: {
        triggerId: { type: 'string', description: '触发消息 id' },
        evalId: { type: 'string', description: '候选送达评估会话时登记该评估 id' },
      },
      required: ['triggerId'],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const triggerId = text(args, 'triggerId')
      if (triggerId === null) return '缺少 triggerId。'
      const candidate = ctx.engine.candidate(triggerId)
      if (candidate === undefined) return `触发 ${triggerId} 当前没有正在等待的评估候选。`
      const evalId = optionalText(args, 'evalId')
      if (evalId !== undefined) ctx.engine.candidateDelivered(evalId)
      return `候选 ${candidate.evalId}：线程 ${candidate.thread.key}，强度 ${candidate.strength}，含 ${candidate.triggers.length} 条触发，策略 ${candidate.policyVersion}。判断后请调用 orchestrator_eval_decide。`
    },
  },
  {
    name: 'orchestrator_eval_read',
    description: '读某线程的决策记录（接受/忽略/叫停/不可用及理由）。',
    parameters: {
      type: 'object',
      properties: {
        thread: { type: 'string', description: '线程键' },
        triggerId: { type: 'string', description: '不填 thread 时用它反查所属线程' },
      },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      let thread = text(args, 'thread')
      const triggerId = optionalText(args, 'triggerId')
      if (thread === null && triggerId !== undefined) {
        const ref = ctx.repo.triggers.get(triggerId)?.threads[0]
        if (ref !== undefined) thread = threadKey(ref)
      }
      if (thread === null) return '需要 thread（线程键）或 triggerId 其中一项。'
      const decisions = ctx.repo.decisions.byThread(thread)
      if (decisions.length === 0) return `线程 ${thread} 还没有决策记录。`
      const lines = decisions.map(item => `  - ${item.id} ${item.kind} ${reasonText(item.reason)}${item.ticketId === undefined ? '' : ' → ' + item.ticketId}`)
      return `线程 ${thread} 共 ${decisions.length} 条决策：\n${lines.join('\n')}`
    },
  },
  {
    name: 'orchestrator_eval_decide',
    description: '把一次评估的结论记成决策：接受、忽略、叫停或标记不可用。',
    parameters: {
      type: 'object',
      properties: {
        triggerId: { type: 'string', description: '触发消息 id' },
        kind: { type: 'string', enum: ['accept', 'stop', 'ignore', 'unavailable'], description: '评估结论' },
        title: { type: 'string', description: 'accept 时的短标题' },
        scope: { type: 'string', description: 'accept 时的范围' },
        reason: { type: 'string', description: '判定理由' },
        ticketId: { type: 'string', description: 'stop 时的票号' },
        evalId: { type: 'string', description: '结论所针对的评估 id' },
        name: { type: 'string', description: 'accept 时票的短名' },
        note: { type: 'string', description: 'accept 时给 worker 的附言' },
      },
      required: ['triggerId', 'kind'],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const triggerId = text(args, 'triggerId')
      if (triggerId === null) return '缺少 triggerId。'
      const outcome = buildOutcome(args)
      if (typeof outcome === 'string') return outcome
      const decision = ctx.engine.decide(triggerId, outcome)
      return `已记录决策 ${decision.id}（${decision.kind}${decision.ticketId === undefined ? '' : '，票 ' + decision.ticketId}）：${reasonText(decision.reason)}。`
    },
  },
  {
    name: 'orchestrator_reply',
    description: '按用途排队一条回复：确认、答复人的问题、结果或向人提问。',
    parameters: {
      type: 'object',
      properties: {
        purpose: { type: 'string', enum: [...REPLY_PURPOSES], description: '回复用途' },
        text: { type: 'string', description: '回复正文' },
        ticketId: { type: 'string', description: '票号' },
        triggerId: { type: 'string', description: '相关的人的消息 id' },
        question: { type: 'string', description: 'attention 时票当前的提问原文' },
      },
      required: ['purpose', 'text'],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const purpose = text(args, 'purpose')
      const body = text(args, 'text')
      if (purpose === null || !(REPLY_PURPOSES as readonly string[]).includes(purpose)) return `purpose 必须是 ${REPLY_PURPOSES.join(' / ')} 之一。`
      if (body === null) return '缺少 text（回复正文）。'
      let request: ReplyRequest
      const p = purpose as ReplyPurpose
      if (p === 'acknowledgement') {
        const ticketId = text(args, 'ticketId')
        const triggerId = text(args, 'triggerId')
        if (ticketId === null || triggerId === null) return 'acknowledgement 需要 ticketId 与 triggerId。'
        request = { purpose: 'acknowledgement', ticketId, triggerId, text: body }
      } else {
        const ticketId = optionalText(args, 'ticketId')
        const triggerId = optionalText(args, 'triggerId')
        const question = optionalText(args, 'question')
        request = {
          purpose: p, text: body,
          ...(ticketId === undefined ? {} : { ticketId }),
          ...(triggerId === undefined ? {} : { triggerId }),
          ...(question === undefined ? {} : { question }),
        }
      }
      const reply = ctx.engine.reply(request)
      return `已排队回复（${reply.id}，状态 ${reply.status}${reply.reused ? '，此前已排过一次' : ''}）。`
    },
  },
  {
    name: 'orchestrator_thread_unsubscribe',
    description: '人取消所有票对某线程的订阅，直到新的决策再次订阅。',
    parameters: {
      type: 'object',
      properties: { thread: { type: 'string', description: '线程键' } },
      required: ['thread'],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const thread = text(args, 'thread')
      if (thread === null) return '缺少 thread（线程键）。'
      const dropped = ctx.engine.unsubscribe(thread)
      return dropped ? `已取消所有票对线程 ${thread} 的订阅。` : `线程 ${thread} 上没有可取消的订阅。`
    },
  },
  {
    name: 'orchestrator_settings_save',
    description: '保存一个配置块（策略/执行器/提示词/来源/账号/模型）。',
    parameters: {
      type: 'object',
      properties: {
        block: { type: 'string', description: '配置块名' },
        values: { type: 'object', description: '该块的字段' },
      },
      required: ['block', 'values'],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const block = text(args, 'block')
      const raw = args['values']
      if (block === null) return '缺少 block（配置块名）。'
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return 'values 必须是一个对象。'
      ctx.config.save(block, raw as Record<string, unknown>)
      return `已保存配置块 ${block}（${Object.keys(raw as Record<string, unknown>).length} 个字段）。`
    },
  },
  {
    name: 'orchestrator_policy_sync',
    description: '把策略推进到新版本，并通知引擎给受影响的活动票记变更。',
    parameters: {
      type: 'object',
      properties: { from: { type: 'string', description: '显式指定旧版本号；省略用当前版本' } },
      additionalProperties: false,
    },
    handler: (_args, ctx) => {
      const { from, to } = ctx.config.syncPolicy(optionalText(_args, 'from'))
      ctx.engine.policyChanged(from, to)
      return `策略已从 ${from} 同步到 ${to}；受影响的活动票已记下 policy-changed 输入，进行中的评估按新版本重跑。`
    },
  },
  {
    name: 'orchestrator_prompts_save',
    description: '保存一段提示词分片：校验非空、预算与必须保留的占位符。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '分片名，如 handoff-worker' },
        text: { type: 'string', description: '分片正文' },
      },
      required: ['id', 'text'],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const id = text(args, 'id')
      const body = text(args, 'text')
      if (id === null || body === null) return '缺少 id / text，请补齐后再调用。'
      ctx.config.savePrompt(id, body)
      return `已保存提示词分片 ${id}（${body.length} 字符）。`
    },
  },
  {
    name: 'orchestrator_read',
    description: '读一个面板视图的当前数据（概览/票/记录/线程/来源/设置/部署）。',
    parameters: {
      type: 'object',
      properties: {
        view: { type: 'string', enum: ['overview', 'tickets', 'records', 'threads', 'sources', 'settings', 'deploy'], description: '面板名' },
      },
      required: ['view'],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const view = text(args, 'view')
      if (view === null) return '缺少 view（面板名）。'
      const content = ctx.views.read(view)
      if (content === undefined) return `没有名为 ${view} 的视图；可用 overview / tickets / records / threads / sources / settings / deploy。`
      return content
    },
  },
]

/** 19 个工具名，与 docs/FEATURES.md §B3 账本一一对应。 */
export const TOOL_NAMES: readonly string[] = TOOL_DESCRIPTORS.map(item => item.name)

/** 按名字取一个工具描述符。 */
export function getTool(name: string): ToolDescriptor | undefined {
  return TOOL_DESCRIPTORS.find(item => item.name === name)
}

/**
 * 统一调用入口：找不到工具回人话；领域拒绝（UserError）把原因原样返回让模型自愈；
 * 其它异常也不吞，转成一行人话。
 */
export function invokeTool(name: string, args: ToolArgs, ctx: ToolContext): string {
  const tool = getTool(name)
  if (tool === undefined) return `没有名为 ${name} 的工具，请从工具清单里选一个。`
  try {
    return tool.handler(args, ctx)
  } catch (error) {
    if (error instanceof UserError) return error.message
    return `工具 ${name} 执行失败：${String(error)}`
  }
}
