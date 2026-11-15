import type { Context } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { type EntryMeta, type JsonSchema, type MemoryWrite, type WriteOutcome } from '@dsh-ghost/memory';
/** 插件名，cordis 用它做去重与诊断。 */
export declare const name = "ghost-memory";
/** 依赖的工具注册表。 */
export declare const inject: string[];
/** 插件配置。 */
export interface Config {
    /** 记忆根目录：`indexed` 用 `<root>/MEMORY.md`，`block` 用 `<root>/user-memory.md`。 */
    root: string;
    /** 存储形态，默认 `indexed`（项目记忆）。 */
    mode?: 'indexed' | 'block';
    /** 常驻预算（字节），默认 2048。 */
    maxResidentBytes?: number;
}
/** 界面通过 Remote 能用到的记忆能力。 */
export interface MemoryApi {
    list(): Promise<EntryMeta[]>;
    read(name: string): Promise<string | undefined>;
    write(write: MemoryWrite): Promise<WriteOutcome>;
    remove(name: string): Promise<boolean>;
    status(): {
        enabled: boolean;
    };
    toggle(enabled: boolean): {
        enabled: boolean;
    };
}
/** 记忆管理的 Remote 面：界面只读/写这里，不碰文件。 */
export declare class GhostMemoryRemote extends TypertRemoteService {
    constructor(ctx: Context, api: MemoryApi);
    /** 列出全部条目（名字 / 标题 / 更新时间）。 */
    listEntries(): Promise<{
        items: EntryMeta[];
    }>;
    /** 读一条正文；条目不存在时不带 content。 */
    readEntry(input: {
        name: string;
    }): Promise<{
        name: string;
        content?: string;
    }>;
    /** 写一条（同样过 gate：缺来源、一次性措辞、非法名都会被拒）。 */
    writeEntry(input: MemoryWrite): Promise<{
        outcome: WriteOutcome;
    }>;
    /** 删除一条并同步索引。 */
    removeEntry(input: {
        name: string;
    }): Promise<{
        removed: boolean;
    }>;
    /** 总开关当前状态。 */
    status(): {
        enabled: boolean;
    };
    /** 打开 / 关闭写入（关闭后模型与界面都写不进去，已写的仍可读）。 */
    toggle(input: {
        enabled: boolean;
    }): {
        enabled: boolean;
    };
}
/**
 * 挂载插件。
 * @param ctx - cordis 上下文（必须已注入 `tools`）
 * @param config - 记忆根目录与形态
 */
export declare function apply(ctx: Context, config: Config): void;
export type { JsonSchema };
