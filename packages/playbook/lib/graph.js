/**
 * 图模型：给 UI 用的布局视图。
 *
 * 铁律：**布局是缓存，不是数据**。
 *  - `toGraph` 只做确定性计算（同样的输入永远得到同样的坐标），所以不需要把坐标存进仓库；
 *  - `fromGraph` 只从节点顺序与边恢复语义，**坐标一律丢弃**；
 *  - 两者往返后语义必须不变（有测试守着）。
 */
import { sequenceEdges } from './parse.js';
const NODE_W = 180;
const NODE_H = 56;
const GAP_X = 40;
const GAP_Y = 56;
const PAD_X = 40;
const PAD_Y = 32;
/**
 * 计算每个节点所在层（最长路径；有环时按已访问截断，不会死循环）。
 * @param flow - 剧本
 * @returns 节点名 → 层号
 */
function computeDepths(flow) {
    const next = sequenceEdges(flow);
    const depth = new Map();
    const visiting = new Set();
    const resolve = (name) => {
        const cached = depth.get(name);
        if (cached !== undefined)
            return cached;
        if (visiting.has(name))
            return 0;
        visiting.add(name);
        let best = 0;
        const predecessors = flow.nodes.filter(candidate => {
            const successor = next.get(candidate.name);
            return successor === name || candidate.edges.some(edge => edge.to === name);
        });
        for (const predecessor of predecessors) {
            if (predecessor.name === name)
                continue;
            best = Math.max(best, resolve(predecessor.name) + 1);
        }
        visiting.delete(name);
        depth.set(name, best);
        return best;
    };
    for (const node of flow.nodes)
        resolve(node.name);
    return depth;
}
/**
 * 图模型 → 可渲染布局。
 * @param flow - 剧本
 */
export function toGraph(flow) {
    const depth = computeDepths(flow);
    const perDepth = new Map();
    const nodes = flow.nodes.map((node, order) => {
        const level = depth.get(node.name) ?? 0;
        const index = perDepth.get(level) ?? 0;
        perDepth.set(level, index + 1);
        return {
            id: `n:${node.name}`,
            name: node.name,
            kind: node.kind,
            order,
            depth: level,
            x: PAD_X + index * (NODE_W + GAP_X),
            y: PAD_Y + level * (NODE_H + GAP_Y),
            width: NODE_W,
            height: NODE_H,
            ...(node.script === undefined ? {} : { script: node.script }),
            ...(node.call === undefined ? {} : { call: node.call }),
        };
    });
    const next = sequenceEdges(flow);
    const edges = [];
    for (const node of flow.nodes) {
        const successor = next.get(node.name);
        if (successor !== undefined) {
            edges.push({ id: `e:${node.name}->${successor}:seq`, from: `n:${node.name}`, to: `n:${successor}`, kind: 'sequence' });
        }
        for (const [index, edge] of node.edges.entries()) {
            const fromDepth = depth.get(node.name) ?? 0;
            const toDepth = depth.get(edge.to) ?? 0;
            const kind = node.kind === 'call'
                ? 'call'
                : toDepth <= fromDepth ? 'back' : 'condition';
            const rendered = { id: `e:${node.name}->${edge.to}:${index}`, from: `n:${node.name}`, to: `n:${edge.to}`, kind };
            if (edge.on !== undefined)
                rendered.on = edge.on;
            if (edge.max !== undefined)
                rendered.max = edge.max;
            edges.push(rendered);
        }
    }
    const width = nodes.reduce((max, node) => Math.max(max, node.x + node.width), 0) + PAD_X;
    const height = nodes.reduce((max, node) => Math.max(max, node.y + node.height), 0) + PAD_Y;
    return { id: flow.id, nodes, edges, bounds: { width, height } };
}
/**
 * 可渲染布局 → 图模型（UI 编辑后回写）。
 *
 * 坐标只用于**排序**，不进入结果——这是"布局是缓存"的实现。
 * @param flow - 原剧本（保留头信息）
 * @param graph - UI 侧编辑后的图
 */
export function fromGraph(flow, graph) {
    // 用语义顺序恢复序列，绝不用坐标——否则条件边制造的层级差会打乱顺序边。
    const ordered = [...graph.nodes].sort((left, right) => left.order - right.order || left.y - right.y || left.x - right.x);
    const nodes = ordered.map((node, index) => {
        const edges = graph.edges
            .filter(edge => edge.from === node.id && edge.kind !== 'sequence')
            .filter(edge => edge.on !== undefined)
            .map(edge => {
            const parsed = { on: edge.on ?? '', to: nameOf(graph, edge.to) };
            if (edge.max !== undefined)
                parsed.max = edge.max;
            return parsed;
        });
        return {
            name: node.name,
            kind: node.kind,
            edges,
            line: index + 1,
            ...(node.script === undefined ? {} : { script: node.script }),
            ...(node.call === undefined ? {} : { call: node.call }),
        };
    });
    return { ...flow, nodes };
}
/** 由渲染 id 取节点名。 */
function nameOf(graph, id) {
    return graph.nodes.find(node => node.id === id)?.name ?? id;
}
