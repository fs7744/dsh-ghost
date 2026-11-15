/**
 * 图模型：给 UI 用的布局视图。
 *
 * 铁律：**布局是缓存，不是数据**。
 *  - `toGraph` 只做确定性计算（同样的输入永远得到同样的坐标），所以不需要把坐标存进仓库；
 *  - `fromGraph` 只从节点顺序与边恢复语义，**坐标一律丢弃**；
 *  - 两者往返后语义必须不变（有测试守着）。
 */
import { type Flow, type FlowNode } from './parse.ts';
/** 一个可渲染的节点。 */
export interface GraphNode {
    id: string;
    name: string;
    kind: FlowNode['kind'];
    /**
     * 语义顺序（节点在 `.flow` 里的次序），**不是**布局位置。
     * 顺序边靠它恢复；坐标只决定画在哪。
     */
    order: number;
    /** 层级深度：从第一个节点出发的最长路径。 */
    depth: number;
    x: number;
    y: number;
    width: number;
    height: number;
    script?: string;
    call?: string;
}
/** 一条可渲染的边。 */
export interface GraphEdge {
    id: string;
    from: string;
    to: string;
    kind: 'sequence' | 'condition' | 'back' | 'call';
    on?: string;
    max?: number;
}
/** 一张可渲染的图。 */
export interface Graph {
    id: string;
    nodes: GraphNode[];
    edges: GraphEdge[];
    /** 画布尺寸，供 UI 设滚动区。 */
    bounds: {
        width: number;
        height: number;
    };
}
/**
 * 图模型 → 可渲染布局。
 * @param flow - 剧本
 */
export declare function toGraph(flow: Flow): Graph;
/**
 * 可渲染布局 → 图模型（UI 编辑后回写）。
 *
 * 坐标只用于**排序**，不进入结果——这是"布局是缓存"的实现。
 * @param flow - 原剧本（保留头信息）
 * @param graph - UI 侧编辑后的图
 */
export declare function fromGraph(flow: Flow, graph: Graph): Flow;
