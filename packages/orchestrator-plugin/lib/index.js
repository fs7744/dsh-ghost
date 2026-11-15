var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
/**
 * ghost-orchestrator：让主动引擎常驻在宿主里，并把它变成一个模型可调用的工具。
 *
 * 三条对外出口：
 *  1. 工具 `ghost_ticket`：模型自己开票；
 *  2. Remote `ghostTickets/list`：客户端直接查票（不必读文件）；
 *  3. 状态文件：给排障与无 Remote 场景兜底。
 *
 * 这一版不做自动派活——派活需要绑定运行中的 Session，属于下一层。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { Engine, MemoryRepositories, persisting, ticketStage } from '@dsh-ghost/superagent';
/** 插件名。 */
export const name = 'ghost-orchestrator';
/** 依赖工具注册表。 */
export const inject = ['tools'];
/**
 * 票的 Remote 面：客户端不再需要读文件，直接 `ghostTickets/list`。
 *
 * 继承 `TypertRemoteService` 后由网关做 source-mode 发现——不需要预生成描述符，
 * 开发期即可用；稳定后再接 typert generator 生成严格描述符。
 */
// 网关调用 Remote 方法时 `this` 不一定是本实例（它会换 receiver 做权限/绑定校验），
// 私有字段 #view 在那种调用下会抛 "Cannot read private member"。所以取视图走模块级槽位：
// 每个宿主进程只挂一个 orchestrator，这足够安全，也不依赖 this。
let viewSlot;
let GhostTickets = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _listTickets_decorators;
    return class GhostTickets extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _listTickets_decorators = [Remote('list')];
            __esDecorate(this, null, _listTickets_decorators, { kind: "method", name: "listTickets", static: false, private: false, access: { has: obj => "listTickets" in obj, get: obj => obj.listTickets }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        constructor(ctx, view) {
            super(ctx, 'ghostTickets', { namespace: 'ghostTickets' });
            __runInitializers(this, _instanceExtraInitializers);
            viewSlot = view;
        }
        /**
         * 列出全部票。
         * @returns 票视图，新的在前
         */
        listTickets() {
            return { items: viewSlot?.() ?? [] };
        }
    };
})();
export { GhostTickets };
const OUTPUT_SCHEMA = {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
    additionalProperties: false,
};
/**
 * 挂载插件。
 * @param ctx - cordis 上下文（已注入 tools）
 * @param config - 状态文件与来源名
 */
export function apply(ctx, config = {}) {
    const stateFile = config.stateFile ?? join(process.cwd(), '.ghost', 'tickets.json');
    const source = config.source ?? 'local';
    // 引擎状态持久化到 `<stateFile>.snapshot.json`：宿主重启后票还在
    const repo = persisting(new MemoryRepositories(), `${stateFile}.snapshot.json`);
    /** 列出全部票（仓库是唯一真相，别信快照）。 */
    const listTickets = () => repo.tickets.list();
    /** 票的对外视图。 */
    const view = () => listTickets().map(ticket => ({
        id: ticket.id,
        title: ticket.title,
        stage: ticketStage(ticket),
        createdAt: ticket.createdAt,
        report: ticket.assignments.at(-1)?.report?.summary ?? null,
    }));
    /** 把当前票写进状态文件（原子替换，外部可轮询）。 */
    const flush = () => {
        try {
            mkdirSync(dirname(stateFile), { recursive: true });
            writeFileSync(stateFile, `${JSON.stringify({ at: new Date().toISOString(), tickets: view() }, null, 2)}\n`);
        }
        catch {
            // 状态文件写不了不影响引擎本身
        }
    };
    const engine = new Engine({
        repo,
        policy: () => ({
            version: 'v1',
            paused: false,
            gate: () => ({ admissible: true, strength: 'explicit', basis: { via: 'addressed', addressed: 'mention' } }),
            revalidate: () => true,
            admitsInferred: () => true,
            evalTimeoutMs: 5_000,
        }),
        scope: { scope: () => ({ listened: true, observed: false }) },
        // 常驻版不自动派活：没有人替它跑回合，评估器保持"不接单"，票由人来推进。
        assessor: { request: () => { } },
        executor: { start: () => { }, deliver: () => { }, stop: () => { } },
        outbox: { send: () => { }, status: () => undefined, withdraw: () => { } },
        now: () => new Date().toISOString(),
        emit: event => {
            if (event.type === 'ticket.created' || event.type === 'ticket.ended')
                flush();
        },
    });
    // Remote 面与工具都要用 view/listTickets，先建服务再注册工具。
    // Service 的构造依赖 cordis 的 ctx.reflect，纯 Node 自检用的假 ctx 没有它。
    const cordis = ctx;
    if (cordis.reflect !== undefined)
        new GhostTickets(ctx, view);
    ctx.logger?.info('ghost-orchestrator: %d 张历史票已恢复', listTickets().length);
    ctx.effect(() => ctx.tools.register({
        name: 'ghost_ticket',
        description: '为一件需要持续推进的事开一张票（ticket），返回票号。用于"这件事要做但不在当前回合完成"的场景。',
        parameters: {
            type: 'object',
            properties: {
                task: { type: 'string', description: '要做的事，一句话说清目标' },
            },
            required: ['task'],
            additionalProperties: false,
        },
        output: {
            schema: OUTPUT_SCHEMA,
            render: (_args, value) => [{ type: 'text', text: value.text }],
        },
        async execute(args) {
            const task = String(args?.task ?? '').trim();
            if (task === '')
                return { text: '没有任务内容，票没有开。' };
            const trigger = {
                id: `tr-${Date.now()}`,
                source,
                threads: [{ source, id: `thread-${Date.now()}` }],
                actor: { id: 'agent', name: 'agent' },
                human: false,
                at: new Date().toISOString(),
                text: task,
                meta: {},
            };
            engine.receive(trigger);
            // 直接接单：本版没有独立评估器，开票即建票
            const decision = engine.decide(trigger.id, { kind: 'accept', title: task.slice(0, 60), scope: source, reason: 'agent 直接开票' });
            flush();
            return { text: decision.ticketId === undefined ? '没开出票（可能重复）。' : `已开票：${decision.ticketId}` };
        },
    }), 'ghost-orchestrator: ghost_ticket');
    flush();
}
