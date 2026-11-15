/**
 * C11-03：压缩策略配置。
 *
 * 裁剪阈值、触发阈值、保留策略、`/compact` 焦点参数的**配置模型 + 校验 + 序列化**。
 * 配置以 `{ compaction: {...} }` 的形态写进 settings（与 `<root>/settings.json` 一致）。
 * 全部纯函数：校验不过就明确拒绝，绝不静默塞一个非法值进去。
 */
/** 压缩后内容的保留策略。 */
export type KeepPolicy = 'recent' | 'summary' | 'balanced';
/** 压缩策略配置模型。 */
export interface CompactionConfig {
    /** 工具结果裁剪正文阈值（字节）：超过才裁。 */
    pruneThresholdBytes: number;
    /** 裁剪时头部保留比例（0..1）。 */
    headKeepRatio: number;
    /** 裁剪时尾部保留比例（0..1）。 */
    tailKeepRatio: number;
    /** 上下文占用到多少时触发自动压缩（0..1）。 */
    triggerRatio: number;
    /** 压缩后保留策略。 */
    keepPolicy: KeepPolicy;
    /** 图片离位时保留最近几张。 */
    keepRecentImages: number;
    /** `/compact` 的焦点参数（可选）：告诉压缩器优先保住哪部分上下文。 */
    compactFocus?: string;
}
/** 默认配置：一个能直接用的、保守的取值。 */
export declare const DEFAULT_COMPACTION: CompactionConfig;
/** 校验结果。 */
export interface ValidationResult {
    ok: boolean;
    errors: string[];
}
/** 校验一份（可能不完整的）配置；缺失字段不报错，由 normalize 补默认值。 */
export declare function validateCompaction(input: unknown): ValidationResult;
/** 合并默认值并校验；非法值直接抛错（纯函数）。 */
export declare function normalizeCompaction(input: unknown): CompactionConfig;
/** 写进 settings 的形态。 */
export interface SettingsShape {
    compaction: CompactionConfig;
}
/** 序列化成 settings 对象（可再 JSON.stringify 落盘）。 */
export declare function serializeCompaction(config: CompactionConfig): SettingsShape;
/** 序列化成可直接写 settings.json 的文本。 */
export declare function toSettingsJson(config: CompactionConfig): string;
/** 从 settings 对象里读回配置（缺失即默认，非法即抛错）。 */
export declare function deserializeCompaction(settings: unknown): CompactionConfig;
/** `/compact` 的调用参数：把配置里的焦点带进命令。 */
export interface CompactInvocation {
    command: '/compact';
    focus?: string;
}
/** 由配置生成 `/compact` 调用参数（纯函数）。 */
export declare function compactInvocation(config: CompactionConfig): CompactInvocation;
