/**
 * 进化服务的编排层：把提案纯函数、度量纯函数与文件能力组装成一个小服务。
 *
 * 这是给宿主 Remote 用的唯一入口——Remote 只调用这里的方法，不碰纯函数细节。
 * 逻辑仍留在纯模块（proposals / metrics），本文件只做「累积返工计数 + 落盘 + 状态迁移」。
 *
 * 人闸铁律：propose 只产出提案；approve 才可能写 L2（且只限 memory 提案）；
 * reject 绝不调用应用逻辑；flow/script 提案一律只落盘为文件，不自动改仓库。
 */
import { join } from 'node:path';
import { nodeFileIo } from './io.js';
import { applyProposal, approve as approveProposal, createProposalStore, proposeFlowChange, proposeMemoryConstraint, proposeScriptPromotion, reject as rejectProposal, rollback as rollbackProposal, } from './proposals.js';
import { appendRun, dashboard, readRuns } from './metrics.js';
function slug(text) {
    return text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'constraint';
}
/** 组装一个进化服务。 */
export function createEvolutionService(deps) {
    const io = deps.io ?? nodeFileIo();
    const store = createProposalStore(deps.root, io);
    const runsPath = join(deps.root, 'runs.jsonl');
    const proposalDeps = {
        ...(deps.now === undefined ? {} : { now: deps.now }),
        ...(deps.makeId === undefined ? {} : { makeId: deps.makeId }),
    };
    const now = deps.now ?? (() => new Date());
    /** 内存里的返工累积（同一 key 计数到 3 才生成提案）。 */
    const counts = new Map();
    const requireProposal = async (id) => {
        const current = await store.get(id);
        if (current === undefined)
            throw new Error(`提案 ${id} 不存在`);
        return current;
    };
    return {
        async list() {
            return store.list();
        },
        async propose(input) {
            const kind = input.kind ?? 'memory';
            const stamp = now().toISOString();
            if (kind === 'memory') {
                const accumulated = counts.get(input.key) ?? [];
                const incoming = input.occurrences ?? [
                    { at: stamp, ...(input.reason === undefined ? {} : { note: input.reason }) },
                ];
                accumulated.push(...incoming);
                counts.set(input.key, accumulated);
                const constraint = input.constraint ?? {
                    name: slug(input.key),
                    title: `关于 ${input.key} 的约束`,
                    text: `针对重复出现的 "${input.key}"，按约定处理，避免再次返工。`,
                    source: 'evolution:propose',
                };
                const proposal = proposeMemoryConstraint({
                    key: input.key,
                    occurrences: accumulated,
                    constraint,
                    ...(input.title === undefined ? {} : { title: input.title }),
                    ...(input.reason === undefined ? {} : { reason: input.reason }),
                    ...proposalDeps,
                });
                if (proposal === undefined)
                    return { created: false, count: accumulated.length };
                // id 由 key 决定：已决策的提案不能被下一次返工重新打开成 pending，
                // 否则「批准过的约束」会被悄悄重置，人闸形同虚设。
                const existing = await store.get(proposal.id);
                if (existing !== undefined && existing.status !== 'pending') {
                    return { proposal: existing, created: false, count: accumulated.length };
                }
                await store.put(proposal);
                return { proposal, created: true, count: accumulated.length };
            }
            if (kind === 'flow') {
                if (input.flow === undefined)
                    return { created: false, count: 0 };
                const proposal = proposeFlowChange({
                    ...input.flow,
                    reworks: input.occurrences ?? [],
                    ...proposalDeps,
                });
                const existing = await store.get(proposal.id);
                if (existing !== undefined && existing.status !== 'pending') {
                    return { proposal: existing, created: false, count: (input.occurrences ?? []).length };
                }
                await store.put(proposal);
                return { proposal, created: true, count: (input.occurrences ?? []).length };
            }
            if (input.script === undefined)
                return { created: false, count: 0 };
            const proposal = proposeScriptPromotion({ ...input.script, ...proposalDeps });
            if (proposal === undefined)
                return { created: false, count: 0 };
            const existing = await store.get(proposal.id);
            if (existing !== undefined && existing.status !== 'pending') {
                return { proposal: existing, created: false, count: 2 };
            }
            await store.put(proposal);
            return { proposal, created: true, count: 2 };
        },
        async approve(input) {
            const current = await requireProposal(input.id);
            // 人闸只能走一次：已批准 / 已驳回 / 已回滚的提案不能再批准。
            if (current.status !== 'pending') {
                return { proposal: current, applied: false, reason: `提案状态是 ${current.status}，只有 pending 可批准` };
            }
            const next = approveProposal(current, input.by, proposalDeps);
            await store.put(next);
            const result = await applyProposal(next, {
                ...(deps.writeMemory === undefined ? {} : { writeMemory: deps.writeMemory }),
            });
            return { proposal: next, applied: result.applied, reason: result.reason };
        },
        async reject(input) {
            const current = await requireProposal(input.id);
            if (current.status !== 'pending') {
                return { proposal: current, applied: false, reason: `提案状态是 ${current.status}，只有 pending 可驳回` };
            }
            const next = rejectProposal(current, input.by, proposalDeps);
            await store.put(next);
            // 驳回分支：绝不调用 applyProposal，不写任何记忆/剧本文件。
            return { proposal: next, applied: false, reason: '提案已驳回，未写入任何记忆或剧本文件（人闸）' };
        },
        async rollback(input) {
            const current = await requireProposal(input.id);
            if (current.status !== 'approved')
                return { proposal: current };
            // 回滚要真的撤销效果，不能只改状态：memory 提案把写入的 L2 约束删掉。
            if (current.kind === 'memory' && current.constraint !== undefined && deps.removeMemory !== undefined) {
                await deps.removeMemory(current.constraint.name);
            }
            const next = rollbackProposal(current, input.by, proposalDeps);
            await store.put(next);
            return { proposal: next };
        },
        async metrics(input) {
            if (input.record !== undefined)
                await appendRun(runsPath, input.record, io);
            const all = await readRuns(runsPath, io);
            let before = input.before;
            let after = input.after;
            if (before === undefined || after === undefined) {
                const sorted = [...all].sort((left, right) => left.at.localeCompare(right.at));
                const middle = Math.floor(sorted.length / 2);
                before = sorted.slice(0, middle);
                after = sorted.slice(middle);
            }
            return { ...dashboard(before, after), recorded: all.length };
        },
    };
}
