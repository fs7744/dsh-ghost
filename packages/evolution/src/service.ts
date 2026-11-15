/**
 * 进化服务的编排层：把提案纯函数、度量纯函数与文件能力组装成一个小服务。
 *
 * 这是给宿主 Remote 用的唯一入口——Remote 只调用这里的方法，不碰纯函数细节。
 * 逻辑仍留在纯模块（proposals / metrics），本文件只做「累积返工计数 + 落盘 + 状态迁移」。
 *
 * 人闸铁律：propose 只产出提案；approve 才可能写 L2（且只限 memory 提案）；
 * reject 绝不调用应用逻辑；flow/script 提案一律只落盘为文件，不自动改仓库。
 */
import { join } from 'node:path'
import { nodeFileIo, type FileIo } from './io.ts'
import {
  applyProposal, approve as approveProposal, createProposalStore,
  proposeFlowChange, proposeMemoryConstraint, proposeScriptPromotion,
  reject as rejectProposal, rollback as rollbackProposal,
  type ConstraintDraft, type Occurrence, type Proposal, type ProposalDeps, type ProposalKind,
} from './proposals.ts'
import { appendRun, dashboard, readRuns, type Dashboard, type RunRecord } from './metrics.ts'

/** 构造服务的依赖，全部可注入（测试用内存 io）。 */
export interface EvolutionDeps {
  /** 提案与 runs.jsonl 的落盘目录。 */
  root: string
  /** 写 L2 项目记忆的写入器（memory 提案批准时调用）。 */
  writeMemory?: (constraint: ConstraintDraft) => Promise<void> | void
  now?: () => Date
  makeId?: () => string
  io?: FileIo
}

/** ghostEvolution/propose 的输入。 */
export interface ProposeInput {
  kind?: ProposalKind
  /** 错误/返工/节点的归一化标识，用于累积计数与生成 id。 */
  key: string
  /** 本次带来的证据；缺省自动生成一条。 */
  occurrences?: Occurrence[]
  /** memory 提案要升的约束。 */
  constraint?: ConstraintDraft
  title?: string
  reason?: string
  /** flow 提案的改动与度量。 */
  flow?: {
    nodeName: string
    before: string
    after: string
    beforeMetrics: Record<string, number>
    afterMetrics: Record<string, number>
  }
  /** script 提案的脚本与连跑记录。 */
  script?: {
    path: string
    content: string
    runs: Array<{ ok: boolean }>
  }
}

/** propose 结果。 */
export interface ProposeResult {
  proposal?: Proposal
  created: boolean
  /** 该 key 累计的返工次数。 */
  count: number
}

/** approve / reject 结果。 */
export interface DecideResult {
  proposal: Proposal
  applied: boolean
  reason: string
}

/** metrics 输入。 */
export interface MetricsInput {
  /** 要记录的一条 run（可选）。 */
  record?: RunRecord
  /** 显式给的 before/after；缺省按时间把历史对半分。 */
  before?: RunRecord[]
  after?: RunRecord[]
}

/** metrics 结果：看板 + 已记录条数。 */
export interface MetricsResult extends Dashboard {
  recorded: number
}

/** 决策输入。 */
export interface DecideInput {
  id: string
  by?: string
}

/** 进化服务的对外接口。 */
export interface EvolutionService {
  list(): Promise<Proposal[]>
  propose(input: ProposeInput): Promise<ProposeResult>
  approve(input: DecideInput): Promise<DecideResult>
  reject(input: DecideInput): Promise<DecideResult>
  rollback(input: DecideInput): Promise<{ proposal: Proposal }>
  metrics(input: MetricsInput): Promise<MetricsResult>
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'constraint'
}

/** 组装一个进化服务。 */
export function createEvolutionService(deps: EvolutionDeps): EvolutionService {
  const io = deps.io ?? nodeFileIo()
  const store = createProposalStore(deps.root, io)
  const runsPath = join(deps.root, 'runs.jsonl')
  const proposalDeps: ProposalDeps = {
    ...(deps.now === undefined ? {} : { now: deps.now }),
    ...(deps.makeId === undefined ? {} : { makeId: deps.makeId }),
  }
  const now = deps.now ?? (() => new Date())
  /** 内存里的返工累积（同一 key 计数到 3 才生成提案）。 */
  const counts = new Map<string, Occurrence[]>()

  const requireProposal = async (id: string): Promise<Proposal> => {
    const current = await store.get(id)
    if (current === undefined) throw new Error(`提案 ${id} 不存在`)
    return current
  }

  return {
    async list(): Promise<Proposal[]> {
      return store.list()
    },

    async propose(input: ProposeInput): Promise<ProposeResult> {
      const kind = input.kind ?? 'memory'
      const stamp = now().toISOString()

      if (kind === 'memory') {
        const accumulated = counts.get(input.key) ?? []
        const incoming = input.occurrences ?? [
          { at: stamp, ...(input.reason === undefined ? {} : { note: input.reason }) },
        ]
        accumulated.push(...incoming)
        counts.set(input.key, accumulated)

        const constraint = input.constraint ?? {
          name: slug(input.key),
          title: `关于 ${input.key} 的约束`,
          text: `针对重复出现的 "${input.key}"，按约定处理，避免再次返工。`,
          source: 'evolution:propose',
        }
        const proposal = proposeMemoryConstraint({
          key: input.key,
          occurrences: accumulated,
          constraint,
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.reason === undefined ? {} : { reason: input.reason }),
          ...proposalDeps,
        })
        if (proposal === undefined) return { created: false, count: accumulated.length }
        await store.put(proposal)
        return { proposal, created: true, count: accumulated.length }
      }

      if (kind === 'flow') {
        if (input.flow === undefined) return { created: false, count: 0 }
        const proposal = proposeFlowChange({
          ...input.flow,
          reworks: input.occurrences ?? [],
          ...proposalDeps,
        })
        await store.put(proposal)
        return { proposal, created: true, count: (input.occurrences ?? []).length }
      }

      if (input.script === undefined) return { created: false, count: 0 }
      const proposal = proposeScriptPromotion({ ...input.script, ...proposalDeps })
      if (proposal === undefined) return { created: false, count: 0 }
      await store.put(proposal)
      return { proposal, created: true, count: 2 }
    },

    async approve(input: DecideInput): Promise<DecideResult> {
      const current = await requireProposal(input.id)
      const next = approveProposal(current, input.by, proposalDeps)
      await store.put(next)
      const result = await applyProposal(next, {
        ...(deps.writeMemory === undefined ? {} : { writeMemory: deps.writeMemory }),
      })
      return { proposal: next, applied: result.applied, reason: result.reason }
    },

    async reject(input: DecideInput): Promise<DecideResult> {
      const current = await requireProposal(input.id)
      const next = rejectProposal(current, input.by, proposalDeps)
      await store.put(next)
      // 驳回分支：绝不调用 applyProposal，不写任何记忆/剧本文件。
      return { proposal: next, applied: false, reason: '提案已驳回，未写入任何记忆或剧本文件（人闸）' }
    },

    async rollback(input: DecideInput): Promise<{ proposal: Proposal }> {
      const current = await requireProposal(input.id)
      const next = rollbackProposal(current, input.by, proposalDeps)
      await store.put(next)
      return { proposal: next }
    },

    async metrics(input: MetricsInput): Promise<MetricsResult> {
      if (input.record !== undefined) await appendRun(runsPath, input.record, io)
      const all = await readRuns(runsPath, io)
      let before = input.before
      let after = input.after
      if (before === undefined || after === undefined) {
        const sorted = [...all].sort((left, right) => left.at.localeCompare(right.at))
        const middle = Math.floor(sorted.length / 2)
        before = sorted.slice(0, middle)
        after = sorted.slice(middle)
      }
      return { ...dashboard(before, after), recorded: all.length }
    },
  }
}
