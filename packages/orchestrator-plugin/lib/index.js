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
 * 五条对外出口：
 *  1. 工具 `ghost_ticket`：模型自己开票；
 *  2. Remote `ghostTickets/list`、`ghostTickets/get`：客户端查票（不必读文件）；
 *  3. Remote `ghostTickets/accept`：接收已归一化的事件；
 *  4. Remote `ghostSources/*`：可插拔信息源（内置 / 声明式 / 用户 mapper），原始投递在这里归一化；
 *  5. Outbox：票跑完把结果回写到来源会话；配置 `github` 时经 GitHub 评论出口投递。
 *
 * 执行器常驻：开票后自动把票标题 `followup` 进驱动会话，等 `turn/end`，
 * 把最后一条 assistant 文本作为报告交回 Engine，再用 `result` 把结果排队到 Outbox。
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { createGithubSink } from '@dsh-ghost/sink-github';
import { beginBoot, buildSessionBrief, DEFAULT_OPTIONAL_TOOLS, emptyLedger, estimateToolChars, pruneUnusedTools, recordToolCall, } from '@dsh-ghost/economizer';
import { createRegistry, importMapper, pullFromApi } from '@dsh-ghost/source-hub';
import { Engine, MemoryRepositories, persisting, ticketStage } from '@dsh-ghost/superagent';
import { SettingsStore, TOOL_DESCRIPTORS } from '@dsh-ghost/superagent/tools';
import { buildDeployView, buildOverviewView, buildRecordsView, buildSettingsView, buildSourcesView, buildThreadsView, buildTicketsView, renderViewText, } from '@dsh-ghost/superagent/views';
/** 插件名。 */
export const name = 'ghost-orchestrator';
/**
 * 依赖：工具注册表必需；会话与 agent 是执行器要用的宿主服务。
 * 用 `inject` 声明（而不是可选依赖）是为了让 cordis 等它们就绪后再 apply，
 * 否则惰性 getter 会在开票那一刻才发现服务还没挂上，票就永远排队。
 */
export const inject = ['tools', 'sessions', 'agents'];
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
let acceptSlot;
let detailSlot;
let sourcesSlot;
let GhostTickets = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _listTickets_decorators;
    let _acceptTicket_decorators;
    let _getTicket_decorators;
    return class GhostTickets extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _listTickets_decorators = [Remote('list')];
            _acceptTicket_decorators = [Remote('accept')];
            _getTicket_decorators = [Remote('get')];
            __esDecorate(this, null, _listTickets_decorators, { kind: "method", name: "listTickets", static: false, private: false, access: { has: obj => "listTickets" in obj, get: obj => obj.listTickets }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _acceptTicket_decorators, { kind: "method", name: "acceptTicket", static: false, private: false, access: { has: obj => "acceptTicket" in obj, get: obj => obj.acceptTicket }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _getTicket_decorators, { kind: "method", name: "getTicket", static: false, private: false, access: { has: obj => "getTicket" in obj, get: obj => obj.getTicket }, metadata: _metadata }, null, _instanceExtraInitializers);
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
        /**
         * 收下一条外部事件并开票（来源适配器用：GitHub / IM / 脚本）。
         * @param input - 已校验并归一化的事件
         * @returns 新票的 id
         */
        acceptTicket(input) {
            const accept = acceptSlot;
            if (accept === undefined)
                throw new Error('orchestrator 未就绪');
            return accept(input);
        }
        /**
         * 取一张票的详情。
         * @param input - 票号
         * @returns 详情，找不到返回 undefined
         */
        getTicket(input) {
            return { ...(detailSlot?.(input.id) === undefined ? {} : { ticket: detailSlot?.(input.id) }) };
        }
    };
})();
export { GhostTickets };
/** 信息源的 Remote 面：列出来源、把原始投递归一化后开票。 */
let GhostSources = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _listSources_decorators;
    let _ingestSource_decorators;
    return class GhostSources extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _listSources_decorators = [Remote('list')];
            _ingestSource_decorators = [Remote('ingest')];
            __esDecorate(this, null, _listSources_decorators, { kind: "method", name: "listSources", static: false, private: false, access: { has: obj => "listSources" in obj, get: obj => obj.listSources }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _ingestSource_decorators, { kind: "method", name: "ingestSource", static: false, private: false, access: { has: obj => "ingestSource" in obj, get: obj => obj.ingestSource }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        constructor(ctx, registry) {
            super(ctx, 'ghostSources', { namespace: 'ghostSources' });
            __runInitializers(this, _instanceExtraInitializers);
            sourcesSlot = registry;
        }
        /**
         * 列出当前启用的来源（不含任何密钥）。
         * @returns 来源摘要
         */
        listSources() {
            return { items: sourcesSlot?.list() ?? [] };
        }
        /**
         * 收下一次原始投递：校验签名 → 适配器归一化 → 逐条开票。
         * @param input - 来源 id 与原始请求材料
         * @returns 开出的票号；拒绝时带 reason
         */
        async ingestSource(input) {
            const registry = sourcesSlot;
            if (registry === undefined)
                throw new Error('source hub 未就绪');
            const body = input.body ?? {};
            const result = await registry.normalize(input.sourceId, {
                headers: input.headers ?? {},
                rawBody: input.rawBody ?? JSON.stringify(body),
                body,
                ...(input.event === undefined ? {} : { event: input.event }),
            });
            if (!result.ok)
                return { accepted: 0, ticketIds: [], ...(result.reason === undefined ? {} : { reason: result.reason }) };
            const accept = acceptSlot;
            if (accept === undefined)
                return { accepted: 0, ticketIds: [], reason: 'orchestrator 未就绪' };
            const ticketIds = [];
            for (const event of result.events)
                ticketIds.push(accept(event).ticketId);
            return { accepted: ticketIds.length, ticketIds };
        }
    };
})();
export { GhostSources };
const OUTPUT_SCHEMA = {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
    additionalProperties: false,
};
/**
 * 挂载插件。
 * @param ctx - cordis 上下文（已注入 tools / sessions / agents）
 * @param config - 状态文件、来源名与可选的 GitHub 出口
 */
export function apply(ctx, config = {}) {
    const stateFile = config.stateFile ?? join(process.cwd(), '.ghost', 'tickets.json');
    const settingsFile = config.settingsFile ?? join(dirname(stateFile), 'orchestrator-settings.json');
    const usageFile = join(dirname(stateFile), 'tool-usage.json');
    const briefFile = config.briefFile ?? join(dirname(stateFile), 'memory', 'MEMORY.md');
    /** 只有这些“锦上添花”的工具允许被自动剪；核心票据/报告/读取永不剪。 */
    const OPTIONAL_TOOLS = DEFAULT_OPTIONAL_TOOLS;
    const source = config.source ?? 'local';
    // 引擎状态持久化到 `<stateFile>.snapshot.json`：宿主重启后票还在
    const repo = persisting(new MemoryRepositories(), `${stateFile}.snapshot.json`);
    /**
     * GitHub 出口只在显式配置、或本地测试用 GH_API_BASE 指向兼容端点时启用。
     * 未启用时 Engine 的 Outbox 仍然排队（幂等），只是不往网络发——避免误发到真实仓库。
     */
    const github = config.github ?? (process.env.GH_API_BASE !== undefined
        ? {
            apiBase: process.env.GH_API_BASE,
            token: process.env.GH_TOKEN ?? '',
            repo: process.env.GH_REPO ?? 'local/local',
        }
        : undefined);
    const sink = github === undefined ? undefined : createGithubSink({
        token: github.token,
        repo: github.repo,
        ...(github.apiBase === undefined ? {} : { apiBase: github.apiBase }),
    });
    const outbox = sink ?? { send: () => { }, status: () => undefined, withdraw: () => { } };
    /** 出口排障：状态文件里能看到它是否启用、上一次回复排队是否成功。 */
    const outboxDiag = { enabled: sink !== undefined };
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
            const replies = sink?.entries().map(entry => ({
                id: entry.message.id,
                kind: entry.message.kind,
                status: entry.status,
                target: entry.message.channel.address?.number ?? null,
                ...(entry.error === undefined ? {} : { error: entry.error }),
            })) ?? [];
            mkdirSync(dirname(stateFile), { recursive: true });
            writeFileSync(stateFile, `${JSON.stringify({ at: new Date().toISOString(), tickets: view(), replies, outbox: outboxDiag }, null, 2)}\n`);
        }
        catch {
            // 状态文件写不了不影响引擎本身
        }
    };
    /** 惰性取宿主服务：apply 阶段它们可能还没就绪，取不到就当没有。 */
    const host = {
        get sessions() {
            try {
                return ctx.sessions;
            }
            catch {
                return undefined;
            }
        },
        get agents() {
            try {
                return ctx.agents;
            }
            catch {
                return undefined;
            }
        },
    };
    /**
     * 等驱动会话里出现新的 turn/end，并把最后的 assistant 文本取回来。
     * 与宿主自己的做法一致：从 fromSeq 读快照事件，不逐个猜 seq。
     * 兜底：模型已产出文本且日志 10s 不再增长时视为回合结束（有些回合不写 turn/end）。
     */
    const waitForTurn = async (sessionId, fromSeq, timeoutMs) => {
        const deadline = Date.now() + timeoutMs;
        let lastSeq = fromSeq;
        let stableSince = Date.now();
        let lastText = '';
        let lastTypes = [];
        while (Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 500));
            const session = host.sessions?.get(sessionId);
            if (session === undefined)
                continue;
            let text = '';
            let reason;
            const types = [];
            for (const event of session.snapshotEvents(fromSeq)) {
                types.push(event.type);
                if (event.type === 'assistant/message') {
                    const joined = (event.data?.message?.content ?? []).filter(part => part.type === 'text').map(part => part.text ?? '').join('');
                    if (joined !== '')
                        text = joined;
                }
                if (event.type === 'turn/end')
                    reason = event.data?.reason?.kind ?? 'end';
            }
            lastText = text;
            lastTypes = types;
            if (reason !== undefined)
                return { text, reason, types };
            if (session.seq !== lastSeq) {
                lastSeq = session.seq;
                stableSince = Date.now();
            }
            else if (text !== '' && Date.now() - stableSince > 10_000) {
                return { text, reason: 'idle', types };
            }
        }
        return { text: lastText, reason: 'timeout', types: lastTypes };
    };
    let engine;
    let drive = config.driveSession;
    /** 把票的结果排进 Outbox 并立即投递一次（幂等，重复 flush 不会刷屏）。 */
    const deliverResult = (ticketId, text) => {
        if (sink === undefined)
            return;
        try {
            const reply = engine.reply({ purpose: 'result', ticketId, text });
            outboxDiag.lastReplyId = reply.id;
            delete outboxDiag.lastError;
        }
        catch (error) {
            // 没有来源 channel、或票还没到可回复阶段时，领域会拒绝；票本身仍然有效。
            outboxDiag.lastError = String(error);
            ctx.logger?.warn('ghost-orchestrator: 结果回复未排队：%s', String(error));
        }
        void sink.flush().then(() => flush()).catch(() => { });
    };
    /** 执行器：把票变成一次真实回合，再把结果写回票、回写到来源会话。 */
    const startAssignment = (ticket, assignment) => {
        const target = driveSessionId();
        if (target === undefined)
            return;
        const agent = host.agents?.get(target);
        const session = host.sessions?.get(target);
        if (agent === undefined || session === undefined)
            return;
        const fromSeq = session.seq;
        engine.assignmentStarted(ticket.id, assignment.id);
        try {
            // 形状对齐宿主的 createUserMessage：id 由我们生成，source 只带 kind。
            agent.followup({
                id: randomUUID(),
                role: 'user',
                content: [{ type: 'text', text: sessionBrief(ticket.title) }],
                source: { kind: 'user' },
            });
        }
        catch (error) {
            engine.report(ticket.id, { state: 'failed', summary: `followup 失败：${String(error).slice(0, 100)}` });
            flush();
            return;
        }
        void (async () => {
            const turn = await waitForTurn(target, fromSeq, config.turnTimeoutMs ?? 120_000);
            const now = host.sessions?.get(target)?.seq ?? -1;
            if (turn.reason === 'timeout') {
                const tail = turn.types.slice(-14).join(',') || '(无事件)';
                engine.report(ticket.id, { state: 'failed', summary: `回合超时（${target.slice(-6)} seq ${fromSeq}→${now}）事件 ${tail}` });
                flush();
                return;
            }
            const summary = turn.text.slice(0, 400) || `回合结束（${turn.reason}）`;
            engine.report(ticket.id, { state: 'ready', summary });
            flush();
            deliverResult(ticket.id, summary);
        })();
    };
    /** 选驱动会话：显式配置优先，否则取最新创建的活动会话。 */
    const driveSessionId = () => {
        if (drive !== undefined && drive !== '')
            return drive;
        const live = host.sessions?.list() ?? [];
        const last = live.at(-1);
        const candidate = last?.id;
        if (candidate !== undefined) {
            drive = candidate;
            return candidate;
        }
        return undefined;
    };
    engine = new Engine({
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
        // 外部事件走 accept() 直接判定，不需要再花一次模型调用做"要不要接单"的评估。
        assessor: { request: () => { } },
        executor: {
            start: startAssignment,
            deliver: () => { },
            stop: () => { },
        },
        outbox,
        now: () => new Date().toISOString(),
        emit: event => {
            if (event.type === 'ticket.created' || event.type === 'ticket.ended')
                flush();
        },
    });
    // B3：把 19 个 orchestrator_* 会话工具真正注册给模型。
    // 描述符早就写好了，但如果不注册，它们在运行时等于不存在（模型永远调不到）。
    const toolConfig = new SettingsStore({ policyVersion: 'v1' });
    // 工具写过的 settings / policy / prompts 必须活过重启；之前只在内存里。
    if (existsSync(settingsFile)) {
        try {
            toolConfig.restore(JSON.parse(readFileSync(settingsFile, 'utf8')));
        }
        catch { /* 坏文件按默认配置起 */ }
    }
    const persistToolConfig = () => {
        try {
            mkdirSync(dirname(settingsFile), { recursive: true });
            const temporary = `${settingsFile}.tmp`;
            writeFileSync(temporary, `${JSON.stringify(toolConfig.snapshot(), null, 2)}\n`);
            renameSync(temporary, settingsFile);
        }
        catch { /* 配置落盘失败不该让工具调用失败 */ }
    };
    const toolContext = {
        repo,
        engine,
        config: toolConfig,
        views: {
            /** 视图要反映「当前」仓储状态，所以每次读都现算，不缓存快照。 */
            read: (view) => {
                const builders = {
                    overview: () => buildOverviewView(repo),
                    tickets: () => buildTicketsView(repo),
                    records: () => buildRecordsView(repo),
                    threads: () => buildThreadsView(repo),
                    sources: () => buildSourcesView(repo),
                    settings: () => buildSettingsView(repo),
                    deploy: () => buildDeployView(repo),
                };
                const build = builders[view];
                return build === undefined ? undefined : renderViewText(build());
            },
        },
    };
    // ——— TokenEconomizer 经验：工具剪枝 + 失败循环提示 + 结果截断 ———
    let usageLedger = emptyLedger();
    try {
        if (existsSync(usageFile)) {
            const parsed = JSON.parse(readFileSync(usageFile, 'utf8'));
            if (parsed.version === 1 && typeof parsed.boots === 'number' && typeof parsed.tools === 'object' && parsed.tools !== null) {
                usageLedger = parsed;
            }
        }
    }
    catch { /* 坏账本按空账本起，不影响工具可用 */ }
    usageLedger = beginBoot(usageLedger, TOOL_DESCRIPTORS.map(descriptor => descriptor.name));
    const persistUsage = () => {
        try {
            mkdirSync(dirname(usageFile), { recursive: true });
            const temporary = `${usageFile}.tmp`;
            writeFileSync(temporary, `${JSON.stringify(usageLedger, null, 2)}\n`);
            renameSync(temporary, usageFile);
        }
        catch { /* 账本写不了不影响工具调用 */ }
    };
    persistUsage();
    const computedPruned = config.toolPrune === false
        ? []
        : pruneUnusedTools(usageLedger, OPTIONAL_TOOLS, { minBoots: 5, ...(config.keepTools === undefined ? {} : { keep: config.keepTools }) });
    const pruned = [...new Set([...computedPruned, ...(usageLedger.disabled ?? [])])];
    if (pruned.length > 0) {
        const chars = estimateToolChars(TOOL_DESCRIPTORS, pruned);
        ctx.logger?.info('ghost-orchestrator: 剪掉 %d 个长期未用工具（省约 %d 字符定义）：%s', pruned.length, chars, pruned.join(', '));
    }
    const prunedSet = new Set(pruned);
    /** 开局带一小段记忆索引，省掉「先 list 再逐条 read」的重复发现。 */
    const sessionBrief = (title) => {
        try {
            return buildSessionBrief(title, readFileSync(briefFile, 'utf8'));
        }
        catch {
            return buildSessionBrief(title, '');
        }
    };
    for (const descriptor of TOOL_DESCRIPTORS) {
        if (prunedSet.has(descriptor.name))
            continue;
        ctx.effect(() => ctx.tools.register({
            name: descriptor.name,
            description: descriptor.description,
            parameters: descriptor.parameters,
            output: {
                schema: OUTPUT_SCHEMA,
                render: (_args, value) => [{ type: 'text', text: value.text }],
            },
            async execute(args) {
                try {
                    const text = descriptor.handler((args ?? {}), toolContext);
                    if (descriptor.name === 'orchestrator_settings_save'
                        || descriptor.name === 'orchestrator_policy_sync'
                        || descriptor.name === 'orchestrator_prompts_save')
                        persistToolConfig();
                    usageLedger = recordToolCall(usageLedger, descriptor.name, true);
                    persistUsage();
                    // 原样返回：超长结果由宿主 dsh-compaction-tool-result-pruner 裁剪。
                    return { text };
                }
                catch (error) {
                    // 领域拒绝（UserError）原样给人话，让模型据此改参数自愈。
                    usageLedger = recordToolCall(usageLedger, descriptor.name, false);
                    persistUsage();
                    return { text: `未执行：${String(error)}` };
                }
            },
        }), `ghost-orchestrator: ${descriptor.name}`);
    }
    // Outbox 兜底投递：attention / acknowledgement 也能发出去，失败留 pending 等下一轮重试。
    if (sink !== undefined) {
        const intervalMs = config.flushIntervalMs ?? 10_000;
        ctx.effect(() => {
            const timer = setInterval(() => { void sink.flush().catch(() => { }); }, intervalMs);
            timer.unref();
            return () => clearInterval(timer);
        }, 'ghost-orchestrator: outbox flush');
    }
    // Remote 面与工具都要用 view/listTickets，先建服务再注册工具。
    // Service 的构造依赖 cordis 的 ctx.reflect，纯 Node 自检用的假 ctx 没有它。
    const sources = config.sources ?? [
        { id: 'passthrough', kind: 'passthrough', description: '归一化事件直投（默认）' },
    ];
    const registry = createRegistry(sources, { importMapper });
    const cordis = ctx;
    if (cordis.reflect !== undefined) {
        new GhostTickets(ctx, view);
        new GhostSources(ctx, registry);
    }
    ctx.logger?.info('ghost-orchestrator: %d 个信息源已注册', sources.length);
    /** 开票的共用实现：工具与 accept Remote 都走这里。 */
    const accept = (input) => {
        const trigger = {
            id: `tr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            source: input.source,
            threads: [{ source: input.source, id: input.threadId }],
            actor: { id: input.actor ?? input.source, name: input.actor ?? input.source },
            human: input.human ?? false,
            ...(input.addressed === true ? { addressed: 'mention' } : {}),
            at: new Date().toISOString(),
            text: input.text,
            ...(input.url === undefined ? {} : { url: input.url }),
            ...(input.channel === undefined ? {} : { channel: input.channel }),
            meta: { via: 'remote-accept' },
        };
        engine.receive(trigger);
        // 同线程已有票时，新消息是那张票的输入（followup），不该再建票；
        // 此时 decide 会被领域拒绝（"its worker decides whether it belongs there"）。
        const fanout = repo.triggers.disposition(trigger.id)?.fanout ?? [];
        if (fanout.length > 0) {
            flush();
            return { ticketId: fanout[0] };
        }
        const decision = engine.decide(trigger.id, { kind: 'accept', title: input.text.slice(0, 60), scope: input.source, reason: '外部事件' });
        flush();
        return { ticketId: decision.ticketId ?? '' };
    };
    acceptSlot = accept;
    /** 票详情：派活历史与输入数。 */
    const detail = (id) => {
        const ticket = repo.tickets.get(id);
        if (ticket === undefined)
            return undefined;
        return {
            id: ticket.id,
            title: ticket.title,
            stage: ticketStage(ticket),
            createdAt: ticket.createdAt,
            report: ticket.assignments.at(-1)?.report?.summary ?? null,
            inputs: ticket.inputs.length,
            assignments: ticket.assignments.map(assignment => ({
                id: assignment.id,
                state: assignment.state,
                report: assignment.report === undefined
                    ? null
                    : { state: assignment.report.state, summary: assignment.report.summary },
            })),
        };
    };
    detailSlot = detail;
    ctx.logger?.info('ghost-orchestrator: %d 张历史票已恢复', listTickets().length);
    // 拉取型信息源：定时打 API，把响应喂回**同一条**归一化管线（映射与鉴权都复用）。
    for (const spec of sources) {
        const pull = spec.pull;
        if (pull === undefined)
            continue;
        const intervalMs = pull.intervalSeconds !== undefined
            ? Math.max(1, pull.intervalSeconds) * 1000
            : Math.max(1, pull.intervalMinutes ?? 5) * 60_000;
        const run = async () => {
            const result = await pullFromApi(pull);
            if (!result.ok) {
                ctx.logger?.warn('ghost-orchestrator: 拉取来源 %s 失败：%s', spec.id, result.reason ?? '未知原因');
                return;
            }
            for (const request of result.requests) {
                const normalized = await registry.normalize(spec.id, request);
                if (!normalized.ok)
                    continue;
                for (const event of normalized.events) {
                    try {
                        accept(event);
                    }
                    catch (error) {
                        ctx.logger?.warn('ghost-orchestrator: 拉取事件未能开票：%s', String(error).slice(0, 120));
                    }
                }
            }
        };
        ctx.effect(() => {
            const timer = setInterval(() => { void run(); }, intervalMs);
            timer.unref();
            return () => clearInterval(timer);
        }, `ghost-orchestrator: pull ${spec.id}`);
    }
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
            const { ticketId } = accept({ source, threadId: `thread-${Date.now()}`, text: task });
            return { text: ticketId === '' ? '没开出票（可能重复）。' : `已开票：${ticketId}` };
        },
    }), 'ghost-orchestrator: ghost_ticket');
    flush();
}
