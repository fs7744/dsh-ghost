/**
 * 剧本（Playbook）：`.flow` 紧凑文本 ↔ 图模型 ↔ 完整 skill 包。
 *
 * 两种表示，两个消费者：
 *  - 文本给人（git diff）与模型（token 最省）
 *  - 图给 UI（坐标只是缓存，永不进仓库、不进 prompt）
 */
export { parseFlow, sequenceEdges } from './parse.js';
export { compilePlaybook, estimateTokens, renderBody, renderSkill, validate } from './compile.js';
export { fromGraph, toGraph } from './graph.js';
export { NODE_NAME, applyEdit, applyEdits, editText, editTextAll, stringifyFlow } from './edit.js';
// C9-05 图 diff / C9-06 生成 / C9-07 局部重写 / C9-08 单步试跑
export { diffFlows, diffFlowTexts, formatDiff } from './diff.js';
export { generateFlow, rewriteFlow, templateGenerator, templateRewriter } from './ai.js';
export { tryRun, tryRunText } from './simulate.js';
