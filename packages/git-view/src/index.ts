/**
 * Git 视图的**纯逻辑**部分（零 IO、零 Node 依赖）。
 *
 * 解析 git 的输出：变更列表、增删行数、unified diff、冲突块与冲突解决。
 * 壳（Node，跑 git）与桌面端（渲染层，画 diff）共用这一份，避免两套口径。
 */
/** 一次 git 调用的结果。 */
export interface GitResult {
  ok: boolean
  stdout: string
  stderr: string
}

/** 执行 git 的函数（测试可注入）。 */
export type GitRunner = (args: readonly string[], cwd: string) => Promise<GitResult>

export type GitStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'conflicted' | 'unknown'

export interface ChangedFile {
  /** 仓库相对路径。 */
  path: string
  /** 变更类型。 */
  status: GitStatus
  /** 新增行数（未知为 0）。 */
  additions: number
  /** 删除行数（未知为 0）。 */
  deletions: number
}

/** porcelain v1 的状态字母（X=暂存区，Y=工作区）。 */
const STATUS_MAP: Record<string, GitStatus> = {
  M: 'modified',
  A: 'added',
  D: 'deleted',
  R: 'renamed',
  C: 'added',
  U: 'conflicted',
  T: 'modified',
}

/**
 * 解析 `git status --porcelain=v1` 的输出。
 * 每行格式：`XY 路径`（XY 是暂存区/工作区状态）。
 */
export function parseStatusPorcelain(stdout: string): ChangedFile[] {
  const out: ChangedFile[] = []
  for (const raw of stdout.split('\n')) {
    const line = raw.trimEnd()
    if (line === '') continue
    const code = line.slice(0, 2)
    const rest = line.slice(3)
    if (rest === '') continue
    // 重命名会写成 `old -> new`；只看新路径。
    const path = rest.includes(' -> ') ? (rest.split(' -> ')[1] ?? rest) : rest
    const key = code.trim()
    // 任一列是 U（unmerged）即为冲突；否则看暂存区那一列。
    const status: GitStatus = key === '??'
      ? 'untracked'
      : key.includes('U')
        ? 'conflicted'
        : (STATUS_MAP[key.slice(0, 1)] ?? 'unknown')
    out.push({ path: path.replace(/^"|"$/g, ''), status, additions: 0, deletions: 0 })
  }
  return out
}

/**
 * 解析 `git diff --numstat` 的输出：`新增\t删除\t路径`。
 */
export function parseNumstat(stdout: string): Map<string, { additions: number; deletions: number }> {
  const out = new Map<string, { additions: number; deletions: number }>()
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') continue
    const [add, del, ...rest] = line.split('\t')
    const path = rest.join('\t').replace(/^"|"$/g, '')
    if (path === '') continue
    out.set(path, {
      additions: add === '-' ? 0 : Number.parseInt(add ?? '0', 10) || 0,
      deletions: del === '-' ? 0 : Number.parseInt(del ?? '0', 10) || 0,
    })
  }
  return out
}

export type DiffLineType = 'add' | 'del' | 'ctx' | 'hunk' | 'meta'

export interface DiffLine {
  type: DiffLineType
  text: string
  /** 旧文件行号（新增行没有）。 */
  oldNo?: number
  /** 新文件行号（删除行没有）。 */
  newNo?: number
}

/**
 * 解析 unified diff（`git diff` 的默认格式）为可渲染的行。
 * 只做展示，不做语义判断。
 */
export function parseUnifiedDiff(text: string): DiffLine[] {
  const out: DiffLine[] = []
  let oldNo = 0
  let newNo = 0
  for (const raw of text.split('\n')) {
    if (raw.startsWith('@@')) {
      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw)
      if (match !== null) {
        oldNo = Number.parseInt(match[1] ?? '0', 10)
        newNo = Number.parseInt(match[2] ?? '0', 10)
      }
      out.push({ type: 'hunk', text: raw })
      continue
    }
    if (raw.startsWith('+++') || raw.startsWith('---') || raw.startsWith('diff ') || raw.startsWith('index ')) {
      out.push({ type: 'meta', text: raw })
      continue
    }
    if (raw.startsWith('+')) {
      out.push({ type: 'add', text: raw.slice(1), newNo })
      newNo += 1
      continue
    }
    if (raw.startsWith('-')) {
      out.push({ type: 'del', text: raw.slice(1), oldNo })
      oldNo += 1
      continue
    }
    if (raw.startsWith('\\')) {
      out.push({ type: 'meta', text: raw })
      continue
    }
    out.push({ type: 'ctx', text: raw.slice(1), oldNo, newNo })
    oldNo += 1
    newNo += 1
  }
  return out
}

export interface ConflictBlock {
  /** 共同祖先（base）。 */
  base: string[]
  /** 我方（ours / HEAD）。 */
  ours: string[]
  /** 对方（theirs）。 */
  theirs: string[]
}

/**
 * 找出文件里的 git 冲突块。
 * 标记格式：`<<<<<<< HEAD` … `||||||| base` … `=======` … `>>>>>>> branch`。
 */
export function findConflicts(content: string): ConflictBlock[] {
  const lines = content.split('\n')
  const out: ConflictBlock[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    if (!line.startsWith('<<<<<<<')) {
      i += 1
      continue
    }
    const block: ConflictBlock = { base: [], ours: [], theirs: [] }
    let section: 'ours' | 'base' | 'theirs' | null = 'ours'
    i += 1
    while (i < lines.length) {
      const current = lines[i] ?? ''
      if (current.startsWith('|||||||')) { section = 'base'; i += 1; continue }
      if (current.startsWith('=======')) { section = 'theirs'; i += 1; continue }
      if (current.startsWith('>>>>>>>')) { i += 1; break }
      if (section !== null) block[section].push(current)
      i += 1
    }
    out.push(block)
  }
  return out
}

/**
 * 按选择解决冲突块：'ours'（用我方）/ 'theirs'（用对方）/ 'both'（两者都留）。
 */
export function resolveConflict(content: string, side: 'ours' | 'theirs' | 'both'): string {
  const lines = content.split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    if (!line.startsWith('<<<<<<<')) {
      out.push(line)
      i += 1
      continue
    }
    const ours: string[] = []
    const theirs: string[] = []
    let section: 'ours' | 'theirs' | null = 'ours'
    i += 1
    while (i < lines.length) {
      const current = lines[i] ?? ''
      if (current.startsWith('|||||||')) { i += 1; continue }
      if (current.startsWith('=======')) { section = 'theirs'; i += 1; continue }
      if (current.startsWith('>>>>>>>')) { i += 1; break }
      if (section === 'ours') ours.push(current)
      else theirs.push(current)
      i += 1
    }
    if (side === 'ours') out.push(...ours)
    else if (side === 'theirs') out.push(...theirs)
    else out.push(...ours, ...theirs)
  }
  return out.join('\n')
}

