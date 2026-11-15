/** 默认执行器：execFile，无 shell。 */
export const execGit: GitRunner = (args, cwd) => new Promise((resolve) => {
  execFile('git', [...args], { cwd, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
    if (error === null) resolve({ ok: true, stdout, stderr })
    else resolve({ ok: false, stdout, stderr: stderr || String(error) })
  })
})

/**
 * Git 视图的**执行部分**（壳侧，Node 才能跑 git）。
 *
 * 为什么在壳侧：宿主有 `workspaceFiles/changes`，但它是 **stream 方法**
 * （渲染层通过 transport.call 调会被 gateway 拒：signature-invalid）。
 * 差异与合并需要真正的 git，就在这里做，渲染层通过 IPC 调用。
 *
 * 安全：只用 `execFile('git', [参数数组])`，**不经过 shell**，路径作为独立参数传入，
 * 没有命令拼接 → 没有注入面。也不接受任意子命令，只暴露下面这几种操作。
 *
 * 纯解析在 `@dsh-ghost/git-view`（壳与桌面端共用同一份口径）。
 */
import { execFile } from 'node:child_process'
import {
  parseNumstat, parseStatusPorcelain,
  type ChangedFile, type GitResult, type GitRunner,
} from '@dsh-ghost/git-view'

/** 变更列表 + 增删行数。 */
export async function listChanges(runner: GitRunner, cwd: string): Promise<ChangedFile[]> {
  const [status, numstat] = await Promise.all([
    runner(['status', '--porcelain=v1', '--untracked-files=all'], cwd),
    runner(['diff', '--numstat', 'HEAD'], cwd),
  ])
  const counts = parseNumstat(numstat.stdout)
  const files = parseStatusPorcelain(status.stdout)
  return files.map(file => {
    const count = counts.get(file.path)
    return count === undefined ? file : { ...file, additions: count.additions, deletions: count.deletions }
  })
}

/** 单个文件的差异（unified diff）。 */
export async function fileDiff(runner: GitRunner, cwd: string, path: string): Promise<string> {
  const result = await runner(['diff', '--unified=3', '--', path], cwd)
  return result.stdout
}

/** 冲突文件列表。 */
export async function listConflicts(runner: GitRunner, cwd: string): Promise<string[]> {
  const result = await runner(['diff', '--name-only', '--diff-filter=U'], cwd)
  return result.stdout.split('\n').map(line => line.trim()).filter(line => line !== '')
}

/**
 * 解决冲突：把选中的一侧写回工作区，并 `git add` 标记为已解决。
 * 只允许操作 git 自己报告的冲突文件。
 */
export async function resolveConflictFile(
  runner: GitRunner,
  cwd: string,
  path: string,
  side: 'ours' | 'theirs',
): Promise<{ ok: boolean; error?: string }> {
  const conflicts = await listConflicts(runner, cwd)
  if (!conflicts.includes(path)) return { ok: false, error: '这不是一个冲突文件' }
  const show = await runner(['show', `:${side === 'ours' ? '2' : '3'}:${path}`], cwd)
  if (!show.ok) return { ok: false, error: show.stderr || '取不到冲突内容' }
  const write = await runner(['checkout', `--${side}`, '--', path], cwd)
  if (!write.ok) return { ok: false, error: write.stderr || '写回失败' }
  await runner(['add', '--', path], cwd)
  return { ok: true }
}
