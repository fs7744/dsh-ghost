/**
 * 剧本 × 定时：把宿主的持久化定时（cron/daily/weekly…）接到剧本上。
 *
 * 为什么要合并：剧本是「怎么做」，定时是「什么时候做」。宿主的 schedule 已经把
 * **持久化、时区、投递、投递历史、限流**都做好了（`schedule/*` 九个端点），
 * 我们不该再造一个调度器——只需要让剧本能声明计划，然后复用它。
 *
 * 剧本里这样写（文本仍是唯一真相源，git diff 友好）：
 *
 *   # @ticket-flow v2
 *   # schedule daily 09:00:00 Asia/Shanghai
 *   # schedule weekly 1,3,5 08:30:00 Asia/Shanghai
 *   # schedule cron 0 9 * * 1-5 Asia/Shanghai
 *
 * 定时到点时，宿主把一条 prompt 投递到目标会话；prompt 里带剧本 id 与流程路径，
 * 会话里的 agent 按剧本执行（剧本编译成 skill 包，模型按 skill 跑）。
 */
import type { Flow } from './parse.ts';
/** 计划种类（与宿主 timing 的 kind 对齐）。 */
export type ScheduleKind = 'daily' | 'weekly' | 'cron' | 'every' | 'at' | 'after';
/** 一条计划声明。 */
export interface FlowSchedule {
    kind: ScheduleKind;
    /** daily/weekly：时刻 `HH:mm:ss`。 */
    time?: string;
    /** weekly：星期几（1=周一 … 7=周日，逗号分隔）。 */
    days?: string;
    /** cron：5 段表达式。 */
    expression?: string;
    /** every：间隔秒数。 */
    seconds?: number;
    /** at：ISO 时间。 */
    at?: string;
    /** after：延后秒数。 */
    afterSeconds?: number;
    /** 时区（IANA 名，如 Asia/Shanghai）。 */
    timeZone?: string;
}
/** 把 `09:00` 规范成宿主要的 `HH:mm:ss`（宿主只收带秒的）。 */
export declare function normalizeTime(value: string): string | undefined;
/**
 * 解析一行计划声明：`daily 09:00 Asia/Shanghai`。
 * @returns 计划；格式不对返回 undefined
 */
export declare function parseScheduleLine(line: string): FlowSchedule | undefined;
/**
 * 计划 → 宿主的 timing 结构（`schedule/create` 的 timing 字段）。
 * @returns timing，或 undefined（声明不合法）
 */
export declare function buildTiming(schedule: FlowSchedule): Record<string, unknown> | undefined;
/** 剧本执行提示词（定时投递的内容）。 */
export declare function buildPrompt(flow: Pick<Flow, 'id'>, flowPath?: string): string;
/** 建计划请求（`schedule/create` 的 request）。 */
export declare function buildCreateRequest(options: {
    title: string;
    prompt: string;
    schedule: FlowSchedule;
    /** 目标会话；不给就是「每次新建会话」。 */
    sessionId?: string;
}): Record<string, unknown> | undefined;
/** 宿主 schedule 任务（一行）。 */
export interface ScheduleTaskRow {
    id: string;
    kind: string;
    title: string;
    /** 展示用的时间描述（daily 的时刻 / cron 表达式 / at 时间）。 */
    when: string;
    timeZone?: string;
    status: string;
    /** 目标会话（若是固定会话）。 */
    sessionId?: string;
    /** 下次触发时间（宿主给的）。 */
    scheduledAt?: string;
}
/** 归一化宿主 schedule 列表项。 */
export declare function normalizeScheduleTasks(raw: unknown): ScheduleTaskRow[];
