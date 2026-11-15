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
 * ghost-memory：把记忆工具与记忆管理 Remote 挂进 harness 宿主。
 *
 * 工具（`memory_list/read/write`）给模型用；`ghostMemory/*` Remote 给自建界面用，
 * 两边共用同一个 MemoryStore 与写入门槛，不会出现「模型记了、界面看不到」。
 * 总开关落盘到 `<root>/settings.json`，关闭后模型与界面都不能再写入（已写的仍可读）。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { MemoryStore, memoryTools } from '@dsh-ghost/memory';
import { buildMemoryBlock, countMemoryEntries } from '@dsh-ghost/economizer';
/** 插件名，cordis 用它做去重与诊断。 */
export const name = 'ghost-memory';
/** 依赖的工具注册表。 */
export const inject = ['tools'];
// 网关调用 Remote 方法时不保证 this 是本实例，走模块级槽位（与 orchestrator 一致）。
let memorySlot;
const requireApi = () => {
    if (memorySlot === undefined)
        throw new Error('ghost-memory 未就绪');
    return memorySlot;
};
let evolutionModule;
let playbookModule;
let runtimeModule;
const loadEvolution = async () => {
    if (evolutionModule === undefined)
        evolutionModule = await import('@dsh-ghost/evolution');
    return evolutionModule;
};
const loadPlaybook = async () => {
    if (playbookModule === undefined)
        playbookModule = await import('@dsh-ghost/playbook');
    return playbookModule;
};
const loadRuntime = async () => {
    if (runtimeModule === undefined)
        runtimeModule = await import('@dsh-ghost/playbook-runtime');
    return runtimeModule;
};
// apply() 里写入的槽位：记忆 api、提案/脚本根、仓库根。
let evolutionApiSlot;
let evolutionRootSlot;
let runtimeRootSlot;
let repoRootSlot;
let evolutionServicePromise;
/**
 * 脚本运行时必须复用同一个实例：并发上限与幂等键都活在实例里。
 * 之前每次 Remote 调 runScript() 都新建一个，幂等键等于没用。
 */
let runtimeInstance;
/** 惰性构造进化服务：纯模块第一次被用到时才加载。 */
const getEvolutionService = () => {
    if (evolutionServicePromise === undefined) {
        evolutionServicePromise = (async () => {
            const evo = await loadEvolution();
            const api = evolutionApiSlot;
            const removeMemory = api === undefined
                ? undefined
                : async (name) => { await api.remove(name); };
            const writeMemory = api === undefined
                ? undefined
                : async (constraint) => {
                    // L2 项目记忆走同一个 MemoryStore + gate；名字规整成 kebab-case，来源必填。
                    const name = constraint.name.toLowerCase()
                        .replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63) || 'constraint';
                    const outcome = await api.write({
                        name,
                        ...(constraint.title === '' ? {} : { title: constraint.title }),
                        text: constraint.text,
                        source: constraint.source === '' ? 'evolution' : constraint.source,
                    });
                    if (!outcome.ok)
                        throw new Error(`写入 L2 项目记忆失败：${outcome.reasons.join('；')}`);
                };
            return evo.createEvolutionService({
                root: evolutionRootSlot ?? join(process.cwd(), '.ghost', 'memory', 'evolution'),
                ...(writeMemory === undefined ? {} : { writeMemory }),
                ...(removeMemory === undefined ? {} : { removeMemory }),
            });
        })();
    }
    return evolutionServicePromise;
};
/** C10-05/06/07：记忆与剧本进化提案 + 度量看板。 */
let GhostEvolutionRemote = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _listProposals_decorators;
    let _propose_decorators;
    let _approve_decorators;
    let _reject_decorators;
    let _metrics_decorators;
    return class GhostEvolutionRemote extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _listProposals_decorators = [Remote('list')];
            _propose_decorators = [Remote('propose')];
            _approve_decorators = [Remote('approve')];
            _reject_decorators = [Remote('reject')];
            _metrics_decorators = [Remote('metrics')];
            __esDecorate(this, null, _listProposals_decorators, { kind: "method", name: "listProposals", static: false, private: false, access: { has: obj => "listProposals" in obj, get: obj => obj.listProposals }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _propose_decorators, { kind: "method", name: "propose", static: false, private: false, access: { has: obj => "propose" in obj, get: obj => obj.propose }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _approve_decorators, { kind: "method", name: "approve", static: false, private: false, access: { has: obj => "approve" in obj, get: obj => obj.approve }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _reject_decorators, { kind: "method", name: "reject", static: false, private: false, access: { has: obj => "reject" in obj, get: obj => obj.reject }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _metrics_decorators, { kind: "method", name: "metrics", static: false, private: false, access: { has: obj => "metrics" in obj, get: obj => obj.metrics }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        constructor(ctx) {
            super(ctx, 'ghostEvolution', { namespace: 'ghostEvolution' });
            __runInitializers(this, _instanceExtraInitializers);
        }
        /** 列出全部提案（可查看）。 */
        async listProposals() {
            return { items: await (await getEvolutionService()).list() };
        }
        /** 记一次返工；同一 key 累计到 3 次才生成提案。 */
        async propose(input) {
            // typert 网关要求 Remote 参数是简单标识符、不能有默认值；缺省在这里兜。
            return (await getEvolutionService()).propose(input ?? { key: 'unnamed' });
        }
        /** 人闸批准：memory 提案写入 L2 项目记忆。 */
        async approve(input) {
            return (await getEvolutionService()).approve(input);
        }
        /** 人闸驳回：绝不写任何记忆或剧本文件。 */
        async reject(input) {
            return (await getEvolutionService()).reject(input);
        }
        /** 记录一条 run 并返回 before/after 看板。 */
        async metrics(input) {
            return (await getEvolutionService()).metrics(input ?? {});
        }
    };
})();
export { GhostEvolutionRemote };
/** C9-05/06/07/08/10：剧本 AI 生成/重写、diff、试跑与脚本执行。 */
let GhostPlaybookRemote = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _generate_decorators;
    let _rewrite_decorators;
    let _tryRun_decorators;
    let _diff_decorators;
    let _runScript_decorators;
    return class GhostPlaybookRemote extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _generate_decorators = [Remote('generate')];
            _rewrite_decorators = [Remote('rewrite')];
            _tryRun_decorators = [Remote('tryRun')];
            _diff_decorators = [Remote('diff')];
            _runScript_decorators = [Remote('runScript')];
            __esDecorate(this, null, _generate_decorators, { kind: "method", name: "generate", static: false, private: false, access: { has: obj => "generate" in obj, get: obj => obj.generate }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _rewrite_decorators, { kind: "method", name: "rewrite", static: false, private: false, access: { has: obj => "rewrite" in obj, get: obj => obj.rewrite }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _tryRun_decorators, { kind: "method", name: "tryRun", static: false, private: false, access: { has: obj => "tryRun" in obj, get: obj => obj.tryRun }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _diff_decorators, { kind: "method", name: "diff", static: false, private: false, access: { has: obj => "diff" in obj, get: obj => obj.diff }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _runScript_decorators, { kind: "method", name: "runScript", static: false, private: false, access: { has: obj => "runScript" in obj, get: obj => obj.runScript }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        constructor(ctx) {
            super(ctx, 'ghostPlaybook', { namespace: 'ghostPlaybook' });
            __runInitializers(this, _instanceExtraInitializers);
        }
        /** 一句话生成合法 .flow（产物过同一道校验，非法返回 ok:false）。 */
        async generate(input) {
            try {
                const pb = await loadPlaybook();
                const result = pb.generateFlow(input ?? { prompt: '' });
                return { ok: true, text: result.text, id: result.flow.id };
            }
            catch (error) {
                return { ok: false, error: String(error) };
            }
        }
        /** 选中局部按一句指令重写，产物过同一道校验。 */
        async rewrite(input) {
            try {
                const pb = await loadPlaybook();
                const result = pb.rewriteFlow(input);
                return { ok: true, text: result.text };
            }
            catch (error) {
                return { ok: false, error: String(error) };
            }
        }
        /** 单步试跑：从某节点推演，返回轨迹与停止原因。 */
        async tryRun(input) {
            try {
                const pb = await loadPlaybook();
                return { ok: true, result: pb.tryRunText(input.text, input) };
            }
            catch (error) {
                return { ok: false, error: String(error) };
            }
        }
        /** 两版 .flow 的结构化 + 文本 diff。 */
        async diff(input) {
            try {
                const pb = await loadPlaybook();
                return { ok: true, diff: pb.diffFlows(input.before, input.after) };
            }
            catch (error) {
                return { ok: false, error: String(error) };
            }
        }
        /** 执行编译出的 scripts/*（白名单/超时/并发/幂等/输出上限）。 */
        async runScript(input) {
            try {
                const rt = await loadRuntime();
                const root = runtimeRootSlot ?? process.cwd();
                if (runtimeInstance === undefined || runtimeInstance.root !== root) {
                    runtimeInstance = { root, runtime: rt.createRuntime({ packageRoot: root }) };
                }
                const outcome = await runtimeInstance.runtime.run({
                    script: input.script,
                    ...(input.args === undefined ? {} : { args: input.args }),
                    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
                    ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
                });
                return { ok: true, outcome };
            }
            catch (error) {
                return { ok: false, error: String(error) };
            }
        }
    };
})();
export { GhostPlaybookRemote };
/** C11-07：扫描仓库生成 GHOST.md 草案（只返回草案，不覆盖既有文件）。 */
let GhostInitRemote = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _draft_decorators;
    return class GhostInitRemote extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _draft_decorators = [Remote('draft')];
            __esDecorate(this, null, _draft_decorators, { kind: "method", name: "draft", static: false, private: false, access: { has: obj => "draft" in obj, get: obj => obj.draft }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        constructor(ctx) {
            super(ctx, 'ghostInit', { namespace: 'ghostInit' });
            __runInitializers(this, _instanceExtraInitializers);
        }
        async draft(input) {
            try {
                const evo = await loadEvolution();
                // `/init` 只该扫当前仓库；Remote 调用方传任意 root 会把扫描面扩到整台机器。
                const base = resolve(repoRootSlot ?? process.cwd());
                const requested = resolve(input?.root ?? base);
                const rel = relative(base, requested);
                if (rel.startsWith('..') || isAbsolute(rel)) {
                    return { ok: false, error: `只允许扫描仓库内目录：${requested}` };
                }
                const scan = await evo.scanRepo(requested);
                const result = evo.draftGhostMd(scan);
                return {
                    ok: true,
                    content: result.content,
                    sources: result.sources,
                    uncertainties: result.uncertainties,
                    wouldWrite: result.wouldWrite,
                };
            }
            catch (error) {
                return { ok: false, error: String(error) };
            }
        }
    };
})();
export { GhostInitRemote };
/** C11-03：压缩策略配置的校验与序列化（settings 形态）。 */
let GhostCompactionRemote = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _config_decorators;
    return class GhostCompactionRemote extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _config_decorators = [Remote('config')];
            __esDecorate(this, null, _config_decorators, { kind: "method", name: "config", static: false, private: false, access: { has: obj => "config" in obj, get: obj => obj.config }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        constructor(ctx) {
            super(ctx, 'ghostCompaction', { namespace: 'ghostCompaction' });
            __runInitializers(this, _instanceExtraInitializers);
        }
        async config(input) {
            try {
                const evo = await loadEvolution();
                if (input?.config === undefined) {
                    const defaults = evo.DEFAULT_COMPACTION;
                    return { ok: true, config: defaults, settings: evo.toSettingsJson(defaults) };
                }
                const verdict = evo.validateCompaction(input.config);
                if (!verdict.ok)
                    return { ok: false, errors: verdict.errors };
                const config = evo.normalizeCompaction(input.config);
                return { ok: true, config, settings: evo.toSettingsJson(config) };
            }
            catch (error) {
                return { ok: false, errors: [String(error)] };
            }
        }
    };
})();
export { GhostCompactionRemote };
/** 记忆管理的 Remote 面：界面只读/写这里，不碰文件。 */
let GhostMemoryRemote = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _listEntries_decorators;
    let _readEntry_decorators;
    let _writeEntry_decorators;
    let _removeEntry_decorators;
    let _brief_decorators;
    let _status_decorators;
    let _toggle_decorators;
    return class GhostMemoryRemote extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _listEntries_decorators = [Remote('list')];
            _readEntry_decorators = [Remote('read')];
            _writeEntry_decorators = [Remote('write')];
            _removeEntry_decorators = [Remote('remove')];
            _brief_decorators = [Remote('brief')];
            _status_decorators = [Remote('status')];
            _toggle_decorators = [Remote('toggle')];
            __esDecorate(this, null, _listEntries_decorators, { kind: "method", name: "listEntries", static: false, private: false, access: { has: obj => "listEntries" in obj, get: obj => obj.listEntries }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _readEntry_decorators, { kind: "method", name: "readEntry", static: false, private: false, access: { has: obj => "readEntry" in obj, get: obj => obj.readEntry }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _writeEntry_decorators, { kind: "method", name: "writeEntry", static: false, private: false, access: { has: obj => "writeEntry" in obj, get: obj => obj.writeEntry }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _removeEntry_decorators, { kind: "method", name: "removeEntry", static: false, private: false, access: { has: obj => "removeEntry" in obj, get: obj => obj.removeEntry }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _brief_decorators, { kind: "method", name: "brief", static: false, private: false, access: { has: obj => "brief" in obj, get: obj => obj.brief }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _status_decorators, { kind: "method", name: "status", static: false, private: false, access: { has: obj => "status" in obj, get: obj => obj.status }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _toggle_decorators, { kind: "method", name: "toggle", static: false, private: false, access: { has: obj => "toggle" in obj, get: obj => obj.toggle }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        constructor(ctx, api) {
            super(ctx, 'ghostMemory', { namespace: 'ghostMemory' });
            __runInitializers(this, _instanceExtraInitializers);
            memorySlot = api;
        }
        /** 列出全部条目（名字 / 标题 / 更新时间）。 */
        async listEntries() {
            return { items: await requireApi().list() };
        }
        /** 读一条正文；条目不存在时不带 content。 */
        async readEntry(input) {
            const content = await requireApi().read(input.name);
            return { name: input.name, ...(content === undefined ? {} : { content }) };
        }
        /** 写一条（同样过 gate：缺来源、一次性措辞、非法名都会被拒）。 */
        async writeEntry(input) {
            return { outcome: await requireApi().write(input) };
        }
        /** 删除一条并同步索引。 */
        async removeEntry(input) {
            return { removed: await requireApi().remove(input.name) };
        }
        /** 前置简报：把索引压成一小段，供桌面聊天/开票在模型看到上下文之前注入。 */
        async brief() {
            return requireApi().brief();
        }
        /** 总开关当前状态。 */
        status() {
            return requireApi().status();
        }
        /** 打开 / 关闭写入（关闭后模型与界面都写不进去，已写的仍可读）。 */
        toggle(input) {
            return requireApi().toggle(input.enabled);
        }
    };
})();
export { GhostMemoryRemote };
const OUTPUT_SCHEMA = {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
    additionalProperties: false,
};
/**
 * 挂载插件。
 * @param ctx - cordis 上下文（必须已注入 `tools`）
 * @param config - 记忆根目录与形态
 */
export function apply(ctx, config) {
    const store = new MemoryStore({
        root: config.root,
        mode: config.mode ?? 'indexed',
        ...(config.maxResidentBytes === undefined ? {} : { maxResidentBytes: config.maxResidentBytes }),
    });
    // 总开关：落盘到 <root>/settings.json，宿主重启后仍然生效。
    const settingsPath = join(config.root, 'settings.json');
    const loadEnabled = () => {
        try {
            return JSON.parse(readFileSync(settingsPath, 'utf8')).enabled !== false;
        }
        catch {
            return true;
        }
    };
    const saveEnabled = (value) => {
        try {
            mkdirSync(config.root, { recursive: true });
            writeFileSync(settingsPath, `${JSON.stringify({ enabled: value, at: new Date().toISOString() }, null, 2)}\n`);
        }
        catch { /* 写不了不影响本次会话的开关状态 */ }
    };
    let enabled = loadEnabled();
    for (const tool of memoryTools(store)) {
        ctx.effect(() => ctx.tools.register({
            name: tool.name,
            description: tool.description,
            // 我们的描述符用极简 JSON Schema；harness 的类型更宽，这里断言即可。
            parameters: tool.parameters,
            output: {
                schema: OUTPUT_SCHEMA,
                render: (_args, value) => [{ type: 'text', text: value.text }],
            },
            async execute(args) {
                if (tool.name === 'memory_write' && !enabled)
                    return { text: '未写入：记忆写入已关闭（可在「记忆」页打开总开关）。' };
                return { text: await tool.execute((args ?? {})) };
            },
        }), `ghost-memory: ${tool.name}`);
    }
    const api = {
        list: async () => { await store.init(); return store.list(); },
        brief: async () => {
            await store.init();
            const index = await store.resident();
            const text = buildMemoryBlock(index, {
                maxChars: config.briefChars ?? 1200,
                minEntries: config.briefMinEntries ?? 3,
            });
            return { text, entries: countMemoryEntries(index) };
        },
        read: async (name) => { await store.init(); return store.read(name); },
        write: async (write) => {
            if (!enabled)
                return { ok: false, reasons: ['记忆写入已关闭'] };
            return store.write(write);
        },
        remove: async (name) => { await store.init(); return store.remove(name); },
        status: () => ({ enabled }),
        toggle: value => { enabled = value; saveEnabled(value); return { enabled }; },
    };
    // 新 Remote 的槽位：无论是否真实宿主都备好，纯 Node 自检也能拿到一致配置。
    evolutionApiSlot = api;
    evolutionRootSlot = join(config.root, 'evolution');
    runtimeRootSlot = join(config.root, 'scripts');
    repoRootSlot = config.repoRoot ?? process.cwd();
    // 纯 Node 自检用的假 ctx 没有 ctx.reflect；真实宿主才注册 Remote 服务。
    const cordis = ctx;
    if (cordis.reflect !== undefined) {
        new GhostMemoryRemote(ctx, api);
        new GhostEvolutionRemote(ctx);
        new GhostPlaybookRemote(ctx);
        new GhostInitRemote(ctx);
        new GhostCompactionRemote(ctx);
    }
    // 自检文件：让"插件真的活着"可被外部观测（日志级别不可靠，文件不会骗人）。
    // 同时它是排障入口：谁在什么时候、以什么配置加载了哪些工具。
    try {
        mkdirSync(config.root, { recursive: true });
        const tools = memoryTools(store).map(tool => tool.name);
        writeFileSync(join(config.root, 'plugin-state.json'), JSON.stringify({
            plugin: name,
            tools,
            // 运行时自检：注册完再从服务里查回来，确认真的在册（而不是"调用没抛错"）。
            verified: tools.map(tool => ({ name: tool, present: ctx.tools.get(tool) !== undefined })),
            mode: config.mode ?? 'indexed',
            at: new Date().toISOString(),
            pid: process.pid,
        }, null, 2));
    }
    catch {
        // 自检文件写不了不该影响插件本身
    }
}
