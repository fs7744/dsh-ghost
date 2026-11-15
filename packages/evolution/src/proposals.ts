/**
 * C10-05 / C10-06：记忆进化 与 剧本/技能进化。
 *
 * 三条防漂移规则（docs/MEMORY.md §4.1）：
 *  1. **禁止运行时静默改写自己**：这里只产出/更新「提案」数据，从不自动改 `.flow` 或提示词；
 *  2. 提案落盘为文件，走人闸 + git 可回滚；
 *  3. 可查看、可驳回、可回滚。
 *
 * 触发纯函数：同一错误 3 次 → 记忆约束提案；返工归因到节点 → `.flow` 修改提案（diff + before/after 度量）；
 * 脚本连续 2 次跑通 → 沉淀提案。approve/reject/rollback 是纯状态迁移。
 */
import { join } from 'node:path'
import { nodeFileIo, type FileIo } from './io.ts'

/** 提案类型。 */
export type ProposalKind = 'memory' | 'flow' | 'script'
/** 提案状态：人闸前 pending，人确认 approved，驳回 rejected，回滚 rolled-back。 */
export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'rolled-back'

/** 一次错误/返工记录。 */
export interface Occurrence {
  at: string
  note?: string
}

/** 要升为 L2 项目记忆的约束。 */
export interface ConstraintDraft {
  name: string
  title: string
  text: string
  source: string
}

/** 一次提案。全部是数据，落盘即 JSON 文件。 */
export interface Proposal {
  id: string
  kind: ProposalKind
  status: ProposalStatus
  title: string
  reason: string
  createdAt: string
  /** 触发证据（人话，逐条）。 */
  evidence: string[]
  decidedAt?: string
  decidedBy?: string
  /** kind=memory：要写入 L2 的约束。 */
  constraint?: ConstraintDraft
  /** kind=flow：.flow 的改动与度量。 */
  flowChange?: {
    nodeName: string
    before: string
    after: string
    diff: string[]
    beforeMetrics: Record<string, number>
    afterMetrics: Record<string, number>
  }
  /** kind=script：要沉淀的脚本。 */
  scriptChange?: {
    path: string
    content: string
    passCount: number
  }
}

/** 生成提案时的可注入依赖（时间源 / id 源），测试可固定。 */
export interface ProposalDeps {
  now?: () => Date
  makeId?: () => string
}

/** 名字 → 安全的 id 片段。 */
function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'item'
}

function timestamp(deps: ProposalDeps): string {
  return (deps.now ?? (() => new Date()))().toISOString()
}

function newId(prefix: string, key: string, deps: ProposalDeps): string {
  return (deps.makeId ?? (() => `${prefix}-${slug(key)}`))()
}

/**
 * 行级 LCS diff，输出统一 diff 风格的 `-/+/空` 行数组。
 * 零跨包依赖：本包不 import playbook，避免宿主运行时多一层解析。
 */
export function textDiff(before: string, after: string): string[] {
  const a = before.split(/\r?\n/)
  const b = after.split(/\r?\n/)
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0) as number[])
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }
  const lines: string[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      lines.push(` ${a[i]}`)
      i += 1
      j += 1
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      lines.push(`-${a[i]}`)
      i += 1
    } else {
      lines.push(`+${b[j]}`)
      j += 1
    }
  }
  while (i < n) {
    lines.push(`-${a[i]}`)
    i += 1
  }
  while (j < m) {
    lines.push(`+${b[j]}`)
    j += 1
  }
  return lines
}

/** C10-05：同一错误/返工出现 3 次才生成「升为约束」提案；不足 3 次返回 undefined。 */
export function proposeMemoryConstraint(input: {
  key: string
  occurrences: readonly Occurrence[]
  constraint: ConstraintDraft
  title?: string
  reason?: string
} & ProposalDeps): Proposal | undefined {
  if (input.occurrences.length < 3) return undefined
  return {
    id: newId('mem', input.key, input),
    kind: 'memory',
    status: 'pending',
    title: input.title ?? `把「${input.constraint.title}」升为约束`,
    reason: input.reason ?? `同一错误/返工出现 ${input.occurrences.length} 次，提议升为 L2 项目记忆约束`,
    createdAt: timestamp(input),
    evidence: input.occurrences.map((item, index) => `第 ${index + 1} 次（${item.at}）：${item.note ?? input.key}`),
    constraint: input.constraint,
  }
}

/** C10-06：返工归因到具体 `.flow` 节点 → 产出 `.flow` 修改提案（diff + before/after 度量）。 */
export function proposeFlowChange(input: {
  nodeName: string
  before: string
  after: string
  reworks: readonly Occurrence[]
  beforeMetrics: Record<string, number>
  afterMetrics: Record<string, number>
} & ProposalDeps): Proposal {
  return {
    id: newId('flow', input.nodeName, input),
    kind: 'flow',
    status: 'pending',
    title: `调整节点 ${input.nodeName} 的剧本`,
    reason: `返工归因到节点 "${input.nodeName}"（${input.reworks.length} 次），提议修改 .flow（走 diff + 人确认 + git）`,
    createdAt: timestamp(input),
    evidence: input.reworks.map((item, index) => `返工 ${index + 1}（${item.at}）：${item.note ?? input.nodeName}`),
    flowChange: {
      nodeName: input.nodeName,
      before: input.before,
      after: input.after,
      diff: textDiff(input.before, input.after),
      beforeMetrics: input.beforeMetrics,
      afterMetrics: input.afterMetrics,
    },
  }
}

/** C10-06：脚本**连续** 2 次跑通 → 产出沉淀进 scripts/ 的提案；否则 undefined。 */
export function proposeScriptPromotion(input: {
  path: string
  content: string
  runs: ReadonlyArray<{ ok: boolean }>
} & ProposalDeps): Proposal | undefined {
  let streak = 0
  for (let index = input.runs.length - 1; index >= 0; index -= 1) {
    if (input.runs[index]?.ok === true) streak += 1
    else break
  }
  if (streak < 2) return undefined
  return {
    id: newId('script', input.path, input),
    kind: 'script',
    status: 'pending',
    title: `沉淀脚本 ${input.path}`,
    reason: `该脚本连续 ${streak} 次跑通，提议沉淀进 skill 包的 scripts/（走 PR）`,
    createdAt: timestamp(input),
    evidence: input.runs.map((run, index) => `第 ${index + 1} 次运行：${run.ok ? '通过' : '失败'}`),
    scriptChange: { path: input.path, content: input.content, passCount: streak },
  }
}

/** 纯状态迁移：批准。 */
export function approve(proposal: Proposal, by?: string, deps: ProposalDeps = {}): Proposal {
  return {
    ...proposal,
    status: 'approved',
    decidedAt: timestamp(deps),
    ...(by === undefined ? {} : { decidedBy: by }),
  }
}

/** 纯状态迁移：驳回。 */
export function reject(proposal: Proposal, by?: string, deps: ProposalDeps = {}): Proposal {
  return {
    ...proposal,
    status: 'rejected',
    decidedAt: timestamp(deps),
    ...(by === undefined ? {} : { decidedBy: by }),
  }
}

/** 只有已批准的提案能回滚。 */
export function canRollback(proposal: Proposal): boolean {
  return proposal.status === 'approved'
}

/** 纯状态迁移：回滚（撤销一次已批准的进化）。 */
export function rollback(proposal: Proposal, by?: string, deps: ProposalDeps = {}): Proposal {
  if (!canRollback(proposal)) return proposal
  return {
    ...proposal,
    status: 'rolled-back',
    decidedAt: timestamp(deps),
    ...(by === undefined ? {} : { decidedBy: by }),
  }
}

/** 应用提案的注入口：只有外部显式提供写入器才会真的落盘。 */
export interface ApplySinks {
  /** 写 L2 项目记忆（memory 提案批准时调用）。 */
  writeMemory?: (constraint: ConstraintDraft) => Promise<void> | void
}

/**
 * 应用一份提案——**显式调用、绝不静默**。
 * 只有 memory 且已批准才写 L2；flow / script 提案一律只作为文件待人工合入（git/PR），
 * 运行时不自动改仓库里的 `.flow` 或 `scripts/`。
 */
export async function applyProposal(
  proposal: Proposal,
  sinks: ApplySinks = {},
): Promise<{ applied: boolean; reason: string }> {
  if (proposal.status !== 'approved') {
    return { applied: false, reason: '提案未获批准，人闸拒绝应用（不写记忆、不改文件）' }
  }
  if (proposal.kind === 'memory') {
    if (proposal.constraint === undefined || sinks.writeMemory === undefined) {
      return { applied: false, reason: '缺少约束内容或记忆写入器' }
    }
    await sinks.writeMemory(proposal.constraint)
    return { applied: true, reason: '已写入 L2 项目记忆' }
  }
  return {
    applied: false,
    reason: `${proposal.kind} 提案需走 git/PR 人工合入，运行时不自动应用（提案已落盘可查看/回滚）`,
  }
}

/** 判断一个反序列化对象是不是合法提案。 */
function isProposal(value: unknown): value is Proposal {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.id === 'string'
    && (record.kind === 'memory' || record.kind === 'flow' || record.kind === 'script')
    && (record.status === 'pending' || record.status === 'approved'
      || record.status === 'rejected' || record.status === 'rolled-back')
    && typeof record.createdAt === 'string'
    && Array.isArray(record.evidence)
}

/** 提案仓库：每个提案一个 JSON 文件，可查看、可评审、可 git 回滚。 */
export interface ProposalStore {
  list(): Promise<Proposal[]>
  get(id: string): Promise<Proposal | undefined>
  put(proposal: Proposal): Promise<void>
}

/** 提案 id 会直接进文件名：必须收口，否则 approve({id:'../../x'}) 能读到项目外 JSON。 */
const PROPOSAL_ID = /^[a-z0-9][a-z0-9-]{0,80}$/

/** 构造提案仓库；io 可注入（测试用内存实现）。 */
export function createProposalStore(root: string, io: FileIo = nodeFileIo()): ProposalStore {
  const dir = join(root, 'proposals')
  const fileOf = (id: string): string => join(dir, `${id}.json`)
  return {
    async list(): Promise<Proposal[]> {
      const names = await io.list(dir)
      const items: Proposal[] = []
      for (const name of names) {
        if (!name.endsWith('.json')) continue
        try {
          const parsed: unknown = JSON.parse(await io.read(join(dir, name)))
          if (isProposal(parsed)) items.push(parsed)
        } catch {
          // 单个坏文件不影响清单
        }
      }
      return items.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    },
    async get(id: string): Promise<Proposal | undefined> {
      if (!PROPOSAL_ID.test(id)) return undefined
      try {
        const parsed: unknown = JSON.parse(await io.read(fileOf(id)))
        return isProposal(parsed) ? parsed : undefined
      } catch {
        return undefined
      }
    },
    async put(proposal: Proposal): Promise<void> {
      if (!PROPOSAL_ID.test(proposal.id)) throw new Error(`提案 id 不合法：${proposal.id}`)
      await io.write(fileOf(proposal.id), `${JSON.stringify(proposal, null, 2)}\n`)
    },
  }
}
