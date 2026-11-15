import { type MemoryWrite } from './gate.ts';
/** 存储形态。 */
export type MemoryMode = 'indexed' | 'block';
/** 构造参数。 */
export interface MemoryStoreOptions {
    /** 根目录；`indexed` 用 `<root>/MEMORY.md`，`block` 用 `<root>/user-memory.md`。 */
    root: string;
    mode: MemoryMode;
    /** 常驻文本的字节预算，默认 2KB（对标 WorkBuddy 的极小常驻块）。 */
    maxResidentBytes?: number;
    /** 时间源，测试可注入。 */
    now?: () => Date;
}
/** 索引里的一行。 */
export interface EntryMeta {
    name: string;
    title: string;
    updated: string;
}
/** 写入结果。 */
export type WriteOutcome = {
    ok: true;
    path: string;
} | {
    ok: false;
    reasons: string[];
    oneShot?: boolean;
};
/** 条目名是否合法（供 Remote / UI 复用同一口径）。 */
export declare function isValidEntryName(name: string): boolean;
/** 文件式记忆库。 */
export declare class MemoryStore {
    #private;
    constructor(options: MemoryStoreOptions);
    /** 常驻文件路径。 */
    get residentPath(): string;
    /** 确保目录存在。 */
    init(): Promise<void>;
    /** 常驻文本（会进系统提示的那一段）。 */
    resident(): Promise<string>;
    /** 条目清单（`block` 形态下按 `## ` 分节推导）。 */
    list(): Promise<EntryMeta[]>;
    /** 读一条正文（按需调用的入口）。 */
    read(name: string): Promise<string | undefined>;
    /**
     * 写入一条记忆。
     * @param write - 请求（name / title / text / source）
     */
    write(write: MemoryWrite): Promise<WriteOutcome>;
    /** 删除一条记忆，并同步索引。 */
    remove(name: string): Promise<boolean>;
}
