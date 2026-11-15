/**
 * C9-08：单步试跑 —— 从某节点按条件边走到下一步的纯函数模拟器。
 *
 * 只推演、不启动任何真实进程：给定「当前节点走哪条条件边」的选择表，
 * 沿顺序边/条件边前进，直到终点、人闸、回退上限或环为止。
 * 输出走过的轨迹与停止原因，供界面把「这一步实际会走到哪」画出来。
 */
import { type Flow } from './parse.ts';
/** 停止原因。 */
export type StopReason = 'end' | 'gate' | 'max-steps' | 'back-limit' | 'cycle' | 'dangling' | 'unreachable' | 'no-start';
/** 轨迹里的一步。 */
export interface TraceStep {
    node: string;
    via: 'start' | 'sequence' | 'condition';
    on?: string;
    /** 第几步（0 起）。 */
    index: number;
}
/** 试跑结果。 */
export interface TryRunResult {
    steps: TraceStep[];
    reason: StopReason;
    /** 人话解释，UI 直接展示。 */
    message: string;
    /** 走过的回退（回边）次数。 */
    backtracks: number;
}
/** 试跑选项。 */
export interface TryRunOptions {
    /** 起始节点名。 */
    from: string;
    /** 每个节点选择哪条条件边：`节点名 -> 条件`；没配置就走顺序边。 */
    picks?: Readonly<Record<string, string>>;
    /** 总步数上限，默认 32。 */
    maxSteps?: number;
    /** 全局回退累计上限，默认 8（无 max 的回边靠它兜底，避免死循环）。 */
    maxBacktracks?: number;
}
/**
 * 从 `options.from` 推演一次。
 * @param flow - 已解析的剧本
 * @param options - 起点、条件选择、上限
 */
export declare function tryRun(flow: Flow, options: TryRunOptions): TryRunResult;
/** 便捷封装：直接从 `.flow` 文本试跑。 */
export declare function tryRunText(text: string, options: TryRunOptions): TryRunResult;
