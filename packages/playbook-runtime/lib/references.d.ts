/**
 * C9-12：references 分层加载。
 *
 * 对应 docs/PLAYBOOK.md §7.1 的 L3：索引常驻（只有名字 + 大小，极便宜），
 * 单文件按需读，单文件有硬上限且超限时**明确截断并给提示**，不静默丢内容。
 *
 * 纯逻辑：files 由调用方注入（内存或读盘后的内容），本模块不碰文件系统、不碰网络。
 */
/** 索引里的一条：常驻部分只有名字与字节数。 */
export interface ReferenceMeta {
    name: string;
    bytes: number;
}
/** 按需加载的结果。 */
export interface LoadedReference {
    name: string;
    content: string;
    /** 实际返回的字节数（截断后）。 */
    bytes: number;
    /** 原文总字节数。 */
    totalBytes: number;
    truncated: boolean;
    /** 截断提示，直接给人看。 */
    hint?: string;
}
/** 分层加载器配置。 */
export interface ReferencesOptions {
    /** 单文件字节上限，默认 16KB。 */
    maxFileBytes?: number;
}
/** 索引常驻 + 单文件按需的加载器。 */
export interface LayeredReferences {
    /** 常驻索引（按名字排序）。 */
    index(): ReferenceMeta[];
    /** 按需读单个文件；不存在返回 undefined。 */
    load(name: string): LoadedReference | undefined;
}
/**
 * 构造一个分层加载器。
 * @param files - 相对路径 → 文件内容（注入，便于测试）
 * @param options - 单文件上限
 */
export declare function createReferences(files: Readonly<Record<string, string>>, options?: ReferencesOptions): LayeredReferences;
