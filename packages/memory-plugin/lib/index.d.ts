import type { Context } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { type EntryMeta, type JsonSchema, type MemoryWrite, type WriteOutcome } from '@dsh-ghost/memory';
import type { CompactionConfig, DecideInput, DecideResult, MetricsInput, MetricsResult, Proposal, ProposeInput, ProposeResult } from '@dsh-ghost/evolution';
import type { FlowDiff, GenerateRequest, RewriteRequest, TryRunOptions, TryRunResult } from '@dsh-ghost/playbook';
import type { RunOutcome } from '@dsh-ghost/playbook-runtime';
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
    /** 仓库根目录，供 `ghostInit/draft` 扫描生成 GHOST.md 草案；缺省取宿主 cwd。 */
    repoRoot?: string;
    /** 前置简报的字符预算，默认 1200。 */
    briefChars?: number;
    /** 少于这么多条记忆就不产出简报，默认 3。 */
    briefMinEntries?: number;
}
/** 界面通过 Remote 能用到的记忆能力。 */
export interface MemoryApi {
    list(): Promise<EntryMeta[]>;
    /** 给会话前置用的一小段记忆索引（条目不足时 text 为空）。 */
    brief(): Promise<{
        text: string;
        entries: number;
    }>;
    /** 给会话前置用的一小段记忆索引（条目不足时 text 为空）。 */
    brief(): Promise<{
        text: string;
        entries: number;
    }>;
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
/** C10-05/06/07：记忆与剧本进化提案 + 度量看板。 */
export declare class GhostEvolutionRemote extends TypertRemoteService {
    constructor(ctx: Context);
    /** 列出全部提案（可查看）。 */
    listProposals(): Promise<{
        items: Proposal[];
    }>;
    /** 记一次返工；同一 key 累计到 3 次才生成提案。 */
    propose(input: ProposeInput): Promise<ProposeResult>;
    /** 人闸批准：memory 提案写入 L2 项目记忆。 */
    approve(input: DecideInput): Promise<DecideResult>;
    /** 人闸驳回：绝不写任何记忆或剧本文件。 */
    reject(input: DecideInput): Promise<DecideResult>;
    /** 记录一条 run 并返回 before/after 看板。 */
    metrics(input: MetricsInput): Promise<MetricsResult>;
}
/** C9-05/06/07/08/10：剧本 AI 生成/重写、diff、试跑与脚本执行。 */
export declare class GhostPlaybookRemote extends TypertRemoteService {
    constructor(ctx: Context);
    /** 一句话生成合法 .flow（产物过同一道校验，非法返回 ok:false）。 */
    generate(input: GenerateRequest): Promise<{
        ok: boolean;
        text?: string;
        id?: string;
        error?: string;
    }>;
    /** 选中局部按一句指令重写，产物过同一道校验。 */
    rewrite(input: RewriteRequest): Promise<{
        ok: boolean;
        text?: string;
        error?: string;
    }>;
    /** 单步试跑：从某节点推演，返回轨迹与停止原因。 */
    tryRun(input: {
        text: string;
    } & TryRunOptions): Promise<{
        ok: boolean;
        result?: TryRunResult;
        error?: string;
    }>;
    /** 两版 .flow 的结构化 + 文本 diff。 */
    diff(input: {
        before: string;
        after: string;
    }): Promise<{
        ok: boolean;
        diff?: FlowDiff;
        error?: string;
    }>;
    /** 执行编译出的 scripts/*（白名单/超时/并发/幂等/输出上限）。 */
    runScript(input: {
        script: string;
        args?: string[];
        timeoutMs?: number;
        idempotencyKey?: string;
    }): Promise<{
        ok: boolean;
        outcome?: RunOutcome;
        error?: string;
    }>;
}
/** C11-07：扫描仓库生成 GHOST.md 草案（只返回草案，不覆盖既有文件）。 */
export declare class GhostInitRemote extends TypertRemoteService {
    constructor(ctx: Context);
    draft(input: {
        root?: string;
    }): Promise<{
        ok: boolean;
        content?: string;
        sources?: string[];
        uncertainties?: string[];
        wouldWrite?: boolean;
        error?: string;
    }>;
}
/** C11-03：压缩策略配置的校验与序列化（settings 形态）。 */
export declare class GhostCompactionRemote extends TypertRemoteService {
    constructor(ctx: Context);
    config(input: {
        config?: unknown;
    }): Promise<{
        ok: boolean;
        config?: CompactionConfig;
        settings?: string;
        errors?: string[];
    }>;
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
    /** 前置简报：把索引压成一小段，供桌面聊天/开票在模型看到上下文之前注入。 */
    brief(): Promise<{
        text: string;
        entries: number;
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
