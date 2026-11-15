/**
 * C10-07：进化度量。
 *
 * 每次任务结束写一条 run 到 `runs.jsonl`（本地，不外传），
 * 用纯函数做 before/after 对比与汇总看板——「无度量不合并」。
 * encodeRun/parseRun/summarize/compareMetrics/dashboard 都是纯函数；
 * 只有 appendRun/readRuns 碰到文件，且文件能力可注入。
 */
import { type FileIo } from './io.ts';
/** 一条任务运行记录。 */
export interface RunRecord {
    ticketId: string;
    /** ISO 时间戳。 */
    at: string;
    /** 是否完成（完成率的分子）。 */
    completed: boolean;
    tokens: number;
    toolCalls: number;
    /** 返工次数。 */
    rework: number;
    /** 是否越权（可选，便于以后筛选）。 */
    violation?: boolean;
}
/** 一组 run 的汇总指标。 */
export interface MetricsSummary {
    runs: number;
    completionRate: number;
    avgTokens: number;
    avgToolCalls: number;
    totalRework: number;
    avgRework: number;
}
/** 一项指标的 before/after 对比。 */
export interface MetricComparison {
    metric: 'completionRate' | 'avgTokens' | 'avgToolCalls' | 'totalRework';
    before: number;
    after: number;
    delta: number;
    improved: boolean;
}
/** 汇总看板数据结构，直接序列化给 UI。 */
export interface Dashboard {
    before: MetricsSummary;
    after: MetricsSummary;
    comparison: MetricComparison[];
    runs: number;
}
/** 把一条 run 编成 JSONL 的一行。 */
export declare function encodeRun(record: RunRecord): string;
/** 解析一行 JSONL；脏行返回 undefined（跳过而不是让整批失败）。 */
export declare function parseRun(line: string): RunRecord | undefined;
/** 汇总一组 run（纯函数）。 */
export declare function summarize(runs: readonly RunRecord[]): MetricsSummary;
/** before/after 对比（纯函数）。完成率越高越好，其余越低越好。 */
export declare function compareMetrics(before: readonly RunRecord[], after: readonly RunRecord[]): MetricComparison[];
/** 汇总看板（纯函数）。 */
export declare function dashboard(before: readonly RunRecord[], after: readonly RunRecord[]): Dashboard;
/** 追加一条 run 到 runs.jsonl。 */
export declare function appendRun(path: string, record: RunRecord, io?: FileIo): Promise<void>;
/** 读出全部 run；文件不存在返回空数组。 */
export declare function readRuns(path: string, io?: FileIo): Promise<RunRecord[]>;
