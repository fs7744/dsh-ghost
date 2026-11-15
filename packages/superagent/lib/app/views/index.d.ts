/** 7 个面板视图入口：统一形状、7 个 builder、示例数据。 */
export { buildOverviewView, buildTicketsView, buildRecordsView, buildThreadsView, buildSourcesView, buildSettingsView, buildDeployView, VIEW_NAMES, VIEW_BUILDERS, renderViewText, } from './builders.ts';
export type { ViewExtra } from './builders.ts';
export { sampleRepo, sampleExtra, sampleViews } from './examples.ts';
export type { ViewName, PanelRow, PanelAction, PanelSummary, PanelView, SourceRow, CheckRow, DeployConfig, ViewDeps, } from './types.ts';
