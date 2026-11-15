/**
 * 剧本（Playbook）：`.flow` 紧凑文本 ↔ 图模型 ↔ 完整 skill 包。
 *
 * 两种表示，两个消费者：
 *  - 文本给人（git diff）与模型（token 最省）
 *  - 图给 UI（坐标只是缓存，永不进仓库、不进 prompt）
 */
export { parseFlow, sequenceEdges } from './parse.ts';
export type { Flow, FlowEdge, FlowNode, ParseResult } from './parse.ts';
export { compilePlaybook, estimateTokens, renderBody, renderSkill, validate } from './compile.ts';
export { fromGraph, toGraph } from './graph.ts';
export type { Graph, GraphEdge, GraphNode } from './graph.ts';
export { NODE_NAME, applyEdit, applyEdits, editText, editTextAll, stringifyFlow } from './edit.ts';
export type { EditResult, FlowEdit, TextEditResult } from './edit.ts';
export type { CompileOptions, CompiledPlaybook } from './compile.ts';
export { diffFlows, diffFlowTexts, formatDiff } from './diff.ts';
export type { DiffChange, DiffEntry, DiffLine, FlowDiff } from './diff.ts';
export { generateFlow, rewriteFlow, templateGenerator, templateRewriter } from './ai.ts';
export type { FlowGenerator, FlowRewriter, GenerateRequest, Generated, RewriteRequest, RewriteSelection } from './ai.ts';
export { tryRun, tryRunText } from './simulate.ts';
export type { StopReason, TraceStep, TryRunOptions, TryRunResult } from './simulate.ts';
/** 剧本 × 定时：计划声明的解析、宿主 timing 构造、任务列表归一化。 */
export { buildCreateRequest, buildPrompt, buildTiming, normalizeScheduleTasks, normalizeTime, parseScheduleLine, type FlowSchedule, type ScheduleKind, type ScheduleTaskRow, } from './schedule.ts';
