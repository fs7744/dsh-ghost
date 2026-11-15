/**
 * 7 个面板视图的纯函数实现。
 *
 * 统一形状：buildXxxView(repo, extra?) -> { view, rows, summary, actions }。
 * 只读 Repositories 与可注入的 extra，不改任何状态；界面自行渲染 rows / actions。
 *
 * 一条关键领域规则（PLAN §9）：`ready` 报告在没有 follow 项（如 PR 未合并）时直接结束票。
 * 所以 Overview 只挑 ticketStage 为 person 的票；已结束的票（含 completed）一律不进「待人处理」。
 */
import type { Repositories } from '../../core/index.ts';
import type { CheckRow, DeployConfig, PanelView, SourceRow, ViewName } from './types.ts';
/** 除 repo 之外的可注入部分，缺省即空集合（空分支）。 */
export type ViewExtra = {
    sources?: readonly SourceRow[];
    settings?: Record<string, unknown>;
    deploy?: DeployConfig;
    checks?: readonly CheckRow[];
    now?: () => string;
};
/** B4-01 Overview：只显示需要人处理的票。 */
export declare function buildOverviewView(repo: Repositories): PanelView;
/** B4-02 Tickets：全部工作项列表与概要详情。 */
export declare function buildTicketsView(repo: Repositories): PanelView;
/** B4-03 Records：决策记录与派活报告，按时间排序。 */
export declare function buildRecordsView(repo: Repositories): PanelView;
/** B4-04 Threads：线程与订阅概况。 */
export declare function buildThreadsView(repo: Repositories): PanelView;
/** B4-05 Sources：触发源配置（默认关闭的源要显眼）。 */
export declare function buildSourcesView(repo: Repositories, extra?: ViewExtra): PanelView;
/** B4-06 Settings：策略 / 执行器 / 提示词配置块。 */
export declare function buildSettingsView(repo: Repositories, extra?: ViewExtra): PanelView;
/** B4-07 部署配置页：机器 + 账号 + 自检结果，缺项要显眼。 */
export declare function buildDeployView(repo: Repositories, extra?: ViewExtra): PanelView;
/** 7 个视图名，顺序即账本 §B4。 */
export declare const VIEW_NAMES: readonly ViewName[];
/** 视图名到 builder 的映射，装配层与 orchestrator_read 共用。 */
export declare const VIEW_BUILDERS: Record<ViewName, (repo: Repositories, extra?: ViewExtra) => PanelView>;
/** 把某个视图渲成人话文本，供 orchestrator_read / ViewReader 使用。 */
export declare function renderViewText(view: PanelView): string;
