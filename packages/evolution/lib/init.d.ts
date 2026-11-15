import { type FileIo } from './io.ts';
/** 扫描结果：相对文件名 → 内容，加一级目录名与目标文件是否已存在。 */
export interface RepoScan {
    files: Readonly<Record<string, string>>;
    dirs: readonly string[];
    ghostExists: boolean;
}
/** 生成出的 GHOST.md 草案。 */
export interface GhostDraft {
    content: string;
    sources: string[];
    uncertainties: string[];
    /** 为 false 表示仓库已有 GHOST.md，不会写入。 */
    wouldWrite: boolean;
}
/** 写入结果。 */
export interface WriteDraftResult {
    created: boolean;
    path?: string;
    sources: string[];
    uncertainties: string[];
}
/** 扫描仓库（文件能力可注入）。 */
export declare function scanRepo(root: string, io?: FileIo): Promise<RepoScan>;
/**
 * 由扫描结果生成 GHOST.md 草案（纯函数）。
 * 每条结论标 `[来源: xxx]`，缺失信息进「待确认」。
 */
export declare function draftGhostMd(scan: RepoScan): GhostDraft;
/**
 * 生成并（在 GHOST.md 不存在时）写入草案。
 * 已存在时 `created: false` 且**不覆盖**。
 */
export declare function writeGhostDraft(root: string, io?: FileIo): Promise<WriteDraftResult>;
