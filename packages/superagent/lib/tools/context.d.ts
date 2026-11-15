/**
 * 工具层的可注入依赖的默认实现（纯内存、零 IO）。
 *
 * 宿主接真实存储 / 真实视图时只要实现 ConfigStore / ViewReader 接口替换即可，
 * 工具注册表本身一行都不用改。
 */
import type { ConfigStore, ViewReader } from './types.ts';
/** 允许的提示词分片名与必须保留的占位符；可由装配层用 prompts/manifest.json 覆盖。 */
export declare const DEFAULT_PROMPT_PARTS: readonly string[];
/** 提示词正文的字符预算：常驻体量之外的硬上限，防止把流程又塞回提示词。 */
export declare const PROMPT_CHAR_LIMIT = 4000;
/**
 * 纯内存配置仓。settings_save / policy_sync / prompts_save 三个工具共用它，
 * 拒绝一律抛 UserError，由 invokeTool 把原因原样返回给模型自愈。
 */
export declare class SettingsStore implements ConfigStore {
    private readonly data;
    private policyVersion;
    private readonly promptTexts;
    private readonly parts;
    private readonly placeholders;
    /** 保存历史，供测试与状态页核对「确实写进去了」。 */
    readonly writes: Array<{
        block: string;
        at: string;
    }>;
    constructor(options?: {
        policyVersion?: string;
        initial?: Record<string, Record<string, unknown>>;
        parts?: readonly string[];
        placeholders?: Record<string, readonly string[]>;
        now?: () => string;
    });
    private readonly stamp;
    blocks(): string[];
    read(block: string): Record<string, unknown> | undefined;
    save(block: string, value: Record<string, unknown>): void;
    syncPolicy(from?: string): {
        from: string;
        to: string;
    };
    savePrompt(id: string, text: string): void;
    prompts(): string[];
    promptParts(): string[];
    /**
     * 可序列化快照：宿主把配置存到磁盘后再 restore，重启不会丢 settings/policy/prompts。
     * 只有纯数据，不含函数与路径，便于直接 JSON.stringify。
     */
    snapshot(): {
        policyVersion: string;
        blocks: Record<string, Record<string, unknown>>;
        prompts: Record<string, string>;
    };
    /** 从快照恢复；非法形状整体忽略，保持内存版可用。 */
    restore(snapshot: unknown): void;
}
/**
 * 把一组面板视图绑成 ViewReader。装配层把 buildXxxView 的结果转成文本后传进来，
 * 工具层不需要认识视图的具体形状。
 */
export declare class StaticViewReader implements ViewReader {
    private readonly views;
    constructor(views: Record<string, string>);
    read(view: string): string | undefined;
}
