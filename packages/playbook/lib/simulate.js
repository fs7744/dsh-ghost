/**
 * C9-08：单步试跑 —— 从某节点按条件边走到下一步的纯函数模拟器。
 *
 * 只推演、不启动任何真实进程：给定「当前节点走哪条条件边」的选择表，
 * 沿顺序边/条件边前进，直到终点、人闸、回退上限或环为止。
 * 输出走过的轨迹与停止原因，供界面把「这一步实际会走到哪」画出来。
 */
import { parseFlow, sequenceEdges } from './parse.js';
/** 从入口出发，沿顺序边与所有条件边，判断某节点是否可达。 */
function isReachable(flow, target) {
    if (flow.nodes.length === 0)
        return false;
    const next = sequenceEdges(flow);
    const byName = new Map(flow.nodes.map(node => [node.name, node]));
    const seen = new Set();
    const queue = [flow.nodes[0].name];
    while (queue.length > 0) {
        const name = queue.shift();
        if (seen.has(name))
            continue;
        seen.add(name);
        const successor = next.get(name);
        if (successor !== undefined)
            queue.push(successor);
        for (const edge of byName.get(name)?.edges ?? [])
            queue.push(edge.to);
    }
    return seen.has(target);
}
/**
 * 从 `options.from` 推演一次。
 * @param flow - 已解析的剧本
 * @param options - 起点、条件选择、上限
 */
export function tryRun(flow, options) {
    const maxSteps = options.maxSteps ?? 32;
    const maxBacktracks = options.maxBacktracks ?? 8;
    const picks = options.picks ?? {};
    const steps = [];
    const indexOf = new Map(flow.nodes.map((node, index) => [node.name, index]));
    const byName = new Map(flow.nodes.map(node => [node.name, node]));
    const next = sequenceEdges(flow);
    const edgeUse = new Map();
    let backtracks = 0;
    const stop = (reason, message) => ({ steps, reason, message, backtracks });
    if (!indexOf.has(options.from))
        return stop('no-start', `起点 "${options.from}" 不在剧本里`);
    if (!isReachable(flow, options.from))
        return stop('unreachable', `起点 "${options.from}" 从入口走不到`);
    let current = options.from;
    let via = 'start';
    let on;
    while (true) {
        if (steps.length >= maxSteps)
            return stop('max-steps', `步数达到上限 ${maxSteps}，疑似存在环`);
        steps.push({ node: current, via, ...(on === undefined ? {} : { on }), index: steps.length });
        const node = byName.get(current);
        if (node === undefined)
            return stop('dangling', `节点 "${current}" 不存在`);
        // 人闸：走到就停，等人确认（含起点就是人闸的情况）。
        if (node.kind === 'gate')
            return stop('gate', `撞上人闸 "${current}"，停下等人确认`);
        const pick = picks[current];
        const chosen = pick === undefined
            ? undefined
            : node.edges.find(edge => edge.on === pick);
        if (chosen !== undefined) {
            if (!indexOf.has(chosen.to))
                return stop('dangling', `条件 "${pick ?? ''}" 指向不存在的节点 "${chosen.to}"`);
            const key = `${current}|${chosen.on ?? ''}`;
            const used = (edgeUse.get(key) ?? 0) + 1;
            edgeUse.set(key, used);
            if (chosen.max !== undefined && used > chosen.max) {
                return stop('cycle', `回边 "${chosen.on ?? ''}" 已走 ${used} 次，超过声明上限 (max ${chosen.max})`);
            }
            const fromIndex = indexOf.get(current);
            const toIndex = indexOf.get(chosen.to);
            if (toIndex <= fromIndex) {
                backtracks += 1;
                if (backtracks > maxBacktracks)
                    return stop('back-limit', `回退累计 ${backtracks} 次，超过上限 ${maxBacktracks}`);
            }
            current = chosen.to;
            via = 'condition';
            on = chosen.on ?? pick;
            continue;
        }
        const successor = next.get(current);
        if (successor === undefined)
            return stop('end', `到达终点 "${current}"`);
        current = successor;
        via = 'sequence';
        on = undefined;
    }
}
/** 便捷封装：直接从 `.flow` 文本试跑。 */
export function tryRunText(text, options) {
    return tryRun(parseFlow(text).flow, options);
}
