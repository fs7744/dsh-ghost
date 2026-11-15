/**
 * Git 视图的**纯逻辑**部分（零 IO、零 Node 依赖）。
 *
 * 解析 git 的输出：变更列表、增删行数、unified diff、冲突块与冲突解决。
 * 壳（Node，跑 git）与桌面端（渲染层，画 diff）共用这一份，避免两套口径。
 */
/** 一次 git 调用的结果。 */
export interface GitResult {
    ok: boolean;
    stdout: string;
    stderr: string;
}
/** 执行 git 的函数（测试可注入）。 */
export type GitRunner = (args: readonly string[], cwd: string) => Promise<GitResult>;
export type GitStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'conflicted' | 'unknown';
export interface ChangedFile {
    /** 仓库相对路径。 */
    path: string;
    /** 变更类型。 */
    status: GitStatus;
    /** 新增行数（未知为 0）。 */
    additions: number;
    /** 删除行数（未知为 0）。 */
    deletions: number;
}
/**
 * 解析 `git status --porcelain=v1` 的输出。
 * 每行格式：`XY 路径`（XY 是暂存区/工作区状态）。
 */
export declare function parseStatusPorcelain(stdout: string): ChangedFile[];
/**
 * 解析 `git diff --numstat` 的输出：`新增\t删除\t路径`。
 */
export declare function parseNumstat(stdout: string): Map<string, {
    additions: number;
    deletions: number;
}>;
export type DiffLineType = 'add' | 'del' | 'ctx' | 'hunk' | 'meta';
export interface DiffLine {
    type: DiffLineType;
    text: string;
    /** 旧文件行号（新增行没有）。 */
    oldNo?: number;
    /** 新文件行号（删除行没有）。 */
    newNo?: number;
}
/**
 * 解析 unified diff（`git diff` 的默认格式）为可渲染的行。
 * 只做展示，不做语义判断。
 */
export declare function parseUnifiedDiff(text: string): DiffLine[];
export interface ConflictBlock {
    /** 共同祖先（base）。 */
    base: string[];
    /** 我方（ours / HEAD）。 */
    ours: string[];
    /** 对方（theirs）。 */
    theirs: string[];
}
/**
 * 找出文件里的 git 冲突块。
 * 标记格式：`<<<<<<< HEAD` … `||||||| base` … `=======` … `>>>>>>> branch`。
 */
export declare function findConflicts(content: string): ConflictBlock[];
/**
 * 按选择解决冲突块：'ours'（用我方）/ 'theirs'（用对方）/ 'both'（两者都留）。
 */
export declare function resolveConflict(content: string, side: 'ours' | 'theirs' | 'both'): string;
