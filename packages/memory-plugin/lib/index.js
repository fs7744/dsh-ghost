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
import { join } from 'node:path';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { MemoryStore, memoryTools } from '@dsh-ghost/memory';
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
/** 记忆管理的 Remote 面：界面只读/写这里，不碰文件。 */
let GhostMemoryRemote = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _listEntries_decorators;
    let _readEntry_decorators;
    let _writeEntry_decorators;
    let _removeEntry_decorators;
    let _status_decorators;
    let _toggle_decorators;
    return class GhostMemoryRemote extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _listEntries_decorators = [Remote('list')];
            _readEntry_decorators = [Remote('read')];
            _writeEntry_decorators = [Remote('write')];
            _removeEntry_decorators = [Remote('remove')];
            _status_decorators = [Remote('status')];
            _toggle_decorators = [Remote('toggle')];
            __esDecorate(this, null, _listEntries_decorators, { kind: "method", name: "listEntries", static: false, private: false, access: { has: obj => "listEntries" in obj, get: obj => obj.listEntries }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _readEntry_decorators, { kind: "method", name: "readEntry", static: false, private: false, access: { has: obj => "readEntry" in obj, get: obj => obj.readEntry }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _writeEntry_decorators, { kind: "method", name: "writeEntry", static: false, private: false, access: { has: obj => "writeEntry" in obj, get: obj => obj.writeEntry }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _removeEntry_decorators, { kind: "method", name: "removeEntry", static: false, private: false, access: { has: obj => "removeEntry" in obj, get: obj => obj.removeEntry }, metadata: _metadata }, null, _instanceExtraInitializers);
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
    // 纯 Node 自检用的假 ctx 没有 ctx.reflect；真实宿主才注册 Remote 服务。
    const cordis = ctx;
    if (cordis.reflect !== undefined)
        new GhostMemoryRemote(ctx, api);
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
