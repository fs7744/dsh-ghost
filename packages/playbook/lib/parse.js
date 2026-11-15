/**
 * `.flow` 解析器：紧凑文本 → 图模型。
 *
 * 语法（设计目标：人可读、git diff 友好、模型省 token）：
 *
 *   # @ticket-flow v2                ← 剧本 id 与版本
 *   # when 触发条件（一行）
 *   # goal 验收目标（一行）
 *   # budget 可选配额（一行）
 *   # schedule 可选计划（一行，如 daily 09:00:00 Asia/Shanghai）
 *
 *   admit      : deny -> quiet       ← 条件跳转
 *   open-ticket                      ← 顺序步骤
 *   work       : blocked -> escalate (max 3)   ← 回退上限
 *   ?merge                           ← 人闸（需要人确认）
 *   call sub-flow                    ← 子剧本
 *   verify     @scripts/verify.mjs   ← 挂脚本
 *
 * 规则：顺序即边；一行一节点；名字即 id；`#` 开头是头/注释；空行忽略。
 */
const HEADER = /^#\s*@([A-Za-z0-9_-]+)(?:\s+v(\S+))?\s*$/;
const META = /^#\s*(when|goal|budget|schedule)\s+(.+)$/;
const SCRIPT = /\s+@(\S+)\s*$/;
const EDGE_LIST = /\s*:\s*(.+)$/;
const EDGE = /^(.+?)\s*->\s*([A-Za-z0-9_-]+)\s*(?:\(\s*max\s+(\d+)\s*\))?$/;
/**
 * 解析一段 `.flow` 文本。
 * @param text - 文件内容
 * @returns 图模型与错误清单（有错误时 flow 仍尽量返回，便于 UI 部分渲染）
 */
export function parseFlow(text) {
    const errors = [];
    const flow = { id: '', nodes: [] };
    const seen = new Set();
    const lines = text.split(/\r?\n/);
    lines.forEach((raw, index) => {
        const line = raw.trim();
        if (line === '')
            return;
        const lineNo = index + 1;
        if (line.startsWith('#')) {
            const header = HEADER.exec(line);
            if (header !== null) {
                if (flow.id !== '')
                    errors.push(`第 ${lineNo} 行：重复的剧本头 @${header[1]}`);
                flow.id = header[1] ?? '';
                if (header[2] !== undefined)
                    flow.version = header[2];
                return;
            }
            const meta = META.exec(line);
            if (meta !== null) {
                const key = meta[1];
                const value = meta[2]?.trim();
                if (value !== undefined && value !== '')
                    flow[key] = value;
                return;
            }
            return;
        }
        let rest = line;
        let script;
        const scriptMatch = SCRIPT.exec(rest);
        if (scriptMatch !== null) {
            script = scriptMatch[1];
            rest = rest.slice(0, scriptMatch.index).trimEnd();
        }
        // 先剥类型前缀，再统一解析「名称 : 条件边」——人闸与子剧本同样可以带出边。
        let kind = 'step';
        let call;
        let body = rest;
        if (body.startsWith('?')) {
            kind = 'gate';
            body = body.slice(1).trim();
        }
        else if (body.startsWith('call ')) {
            kind = 'call';
            call = body.slice(5).trim();
            body = call;
        }
        const colon = EDGE_LIST.exec(body);
        const nodeName = (colon === null ? body : body.slice(0, colon.index)).trim();
        const edges = [];
        if (colon !== null) {
            for (const part of colon[1].split('|')) {
                const edge = EDGE.exec(part.trim());
                if (edge === null) {
                    errors.push(`第 ${lineNo} 行：无法解析跳转 "${part.trim()}"（应为 条件 -> 目标 (max n)）`);
                    continue;
                }
                const parsed = { on: edge[1].trim(), to: edge[2] };
                if (edge[3] !== undefined)
                    parsed.max = Number(edge[3]);
                edges.push(parsed);
            }
        }
        if (nodeName === '') {
            errors.push(`第 ${lineNo} 行：节点名为空`);
            return;
        }
        if (seen.has(nodeName))
            errors.push(`第 ${lineNo} 行：节点重名 "${nodeName}"`);
        seen.add(nodeName);
        if (kind === 'call')
            call = nodeName;
        flow.nodes.push({
            name: nodeName,
            kind,
            edges,
            line: lineNo,
            ...(call === undefined ? {} : { call }),
            ...(script === undefined ? {} : { script }),
        });
    });
    if (flow.id === '')
        errors.push('缺少剧本头，例如 `# @ticket-flow v1`');
    return { flow, errors };
}
/** 顺序边：节点 i → 节点 i+1（最后一个是终点）。 */
export function sequenceEdges(flow) {
    const next = new Map();
    for (let i = 0; i < flow.nodes.length - 1; i += 1) {
        next.set(flow.nodes[i].name, flow.nodes[i + 1].name);
    }
    return next;
}
