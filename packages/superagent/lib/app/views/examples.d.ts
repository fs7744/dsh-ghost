/**
 * 7 个视图的示例数据：用一份内存仓储造出空/满/人闸三种状态的票，
 * 再跑一遍全部 builder。生成的 JSON 落在 examples/superagent-views.json，
 * 供自建界面联调时对照数据形状；测试也可直接用 sampleViews()。
 */
import { MemoryRepositories } from '../../core/index.ts';
import type { PanelView, ViewName } from './types.ts';
import type { ViewExtra } from './builders.ts';
/** 一份含「工作中 / 待人答复 / 已结束」三类票的示例仓储。 */
export declare function sampleRepo(): MemoryRepositories;
/** 示例用的注入配置：两个来源（飞书默认关闭）、设置块、部署配置与自检结果。 */
export declare function sampleExtra(): ViewExtra;
/** 一次产出 7 个视图，供示例 JSON 与测试使用。 */
export declare function sampleViews(): Record<ViewName, PanelView>;
