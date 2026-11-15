/**
 * 7 个面板视图的统一数据形状。
 *
 * 视图是纯函数：给一份 Repositories（外加可注入的来源 / 设置 / 部署配置），
 * 产出 { view, rows, summary, actions }。渲染由自建界面消费，这里没有任何 DOM / harness 依赖。
 */
import type { Repositories } from '../../core/index.ts';
/** 7 个视图名，与 docs/FEATURES.md §B4 一致。 */
export type ViewName = 'overview' | 'tickets' | 'records' | 'threads' | 'sources' | 'settings' | 'deploy';
/** 一行数据：cells 是界面直接可渲染的标量，needsPerson 标出「要人动手」。 */
export interface PanelRow {
    id: string;
    cells: Record<string, string | number | boolean | null>;
    needsPerson: boolean;
}
/** 一个可执行动作：关联的工具名、目标 id、以及是否要过人闸。 */
export interface PanelAction {
    id: string;
    label: string;
    /** 关联的工具名；无对应工具时为空串。 */
    tool: string;
    /** 目标票 / 线程 / 来源 id；无目标时为空串。 */
    target: string;
    /** 需要人确认才执行的动作（人闸）。 */
    humanGate: boolean;
}
/** 汇总：固定三字段 + 各视图自定义字段，全部是可渲染标量。 */
export interface PanelSummary {
    total: number;
    needsPerson: number;
    text: string;
    [key: string]: string | number | boolean;
}
/** 视图的统一形状。 */
export interface PanelView {
    view: ViewName;
    rows: PanelRow[];
    summary: PanelSummary;
    actions: PanelAction[];
}
/** 来源摘要（结构化兼容 @dsh-ghost/source-hub 的 SourceSummary，不 import 它）。 */
export interface SourceRow {
    id: string;
    kind: string;
    description: string;
    auth: string;
    enabled?: boolean;
}
/** 配置完整性检查项（由 B7 selfcheck 注入，供部署配置页渲染）。 */
export interface CheckRow {
    id: string;
    ok: boolean;
    reason: string;
}
/** 部署配置（机器 + 账号 + 看护间隔），可注入。 */
export interface DeployConfig {
    service: string;
    stateDir: string;
    machine: Record<string, string>;
    accounts: readonly string[];
    watchIntervalMinutes: number;
}
/** 视图的可注入依赖。repo 必填，其余缺省时给空集合，保证空/满分支都能测。 */
export interface ViewDeps {
    repo: Repositories;
    sources?: readonly SourceRow[];
    settings?: Record<string, unknown>;
    deploy?: DeployConfig;
    checks?: readonly CheckRow[];
    now?: () => string;
}
