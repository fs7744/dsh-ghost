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
 * 宿主插件：把外部 agent 程序接成**同事**（agent-to-agent）。
 *
 * 模型侧两个工具：
 *  - `agent_peers()`：现在有哪些同事可用（id、名称、能干什么）；
 *  - `agent_delegate(peer, task, context?)`：把一件事交给某个同事，返回他的产出。
 *
 * 同事的产出**只是参考材料**：主 agent 自己判断要不要采纳、要不要验证。
 * 我们不替同事做决定，也不自动执行同事建议的动作。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { normalizePeers, runPeer, validatePeer } from '@dsh-ghost/peer-agent';
/** 插件名。 */
export const name = 'ghost-peers';
/** 依赖：工具注册表。 */
export const inject = ['tools'];
const PEERS_FILE = 'peers.json';
const OUTPUT_SCHEMA = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] };
let currentDir = '';
const peersPath = (dir) => join(dir, PEERS_FILE);
/** 读 peer 清单（纯函数，便于测试）。 */
export function readPeers(dir) {
    const target = peersPath(dir);
    if (!existsSync(target))
        return { peers: [], errors: [] };
    try {
        const parsed = JSON.parse(readFileSync(target, 'utf8'));
        const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.peers) ? parsed.peers : []);
        return normalizePeers(list);
    }
    catch {
        return { peers: [], errors: [{ id: PEERS_FILE, errors: ['不是合法 JSON'] }] };
    }
}
/** 写 peer 清单：整份校验，非法项拒绝写入（不静默丢配置）。 */
export function savePeers(dir, peers) {
    const list = Array.isArray(peers) ? peers : [];
    const errors = [];
    list.forEach((peer, index) => {
        for (const problem of validatePeer(peer))
            errors.push(`第 ${index + 1} 个：${problem}`);
    });
    if (errors.length > 0)
        return { ok: false, errors, count: 0 };
    try {
        mkdirSync(dir, { recursive: true });
        const target = peersPath(dir);
        const temporary = `${target}.tmp`;
        writeFileSync(temporary, `${JSON.stringify(list, null, 2)}\n`);
        renameSync(temporary, target);
        return { ok: true, errors: [], count: list.length };
    }
    catch (error) {
        return { ok: false, errors: [String(error)], count: 0 };
    }
}
/** 宿主 Remote 面（界面用）。 */
let GhostPeersRemote = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _list_decorators;
    let _save_decorators;
    return class GhostPeersRemote extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _list_decorators = [Remote('list')];
            _save_decorators = [Remote('save')];
            __esDecorate(this, null, _list_decorators, { kind: "method", name: "list", static: false, private: false, access: { has: obj => "list" in obj, get: obj => obj.list }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _save_decorators, { kind: "method", name: "save", static: false, private: false, access: { has: obj => "save" in obj, get: obj => obj.save }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        constructor(ctx) {
            super(ctx, 'ghostPeers', { namespace: 'ghostPeers' });
            __runInitializers(this, _instanceExtraInitializers);
        }
        /** peer 清单。 */
        list(input) {
            return readPeers(input?.root ?? currentDir);
        }
        /** 保存 peer 清单。 */
        save(input) {
            return savePeers(input?.root ?? currentDir, input?.peers);
        }
    };
})();
export { GhostPeersRemote };
/** 挂载插件。 */
export function apply(ctx, config) {
    currentDir = config.stateDir;
    const cordis = ctx;
    if (cordis.reflect !== undefined)
        new GhostPeersRemote(ctx);
    const timeoutMs = config.timeoutMs ?? 300_000;
    const describePeers = () => {
        const { peers } = readPeers(currentDir);
        if (peers.length === 0) {
            return '还没有登记任何外部 agent。可在「设置 → 外部 agent」里添加（命令行 / HTTP / A2A 三种接法）。';
        }
        return peers
            .map(peer => `${peer.id}（${peer.label}，${peer.kind}）${peer.description === undefined ? '' : `：${peer.description}`}`)
            .join('\n');
    };
    const tools = [
        {
            name: 'agent_peers',
            description: '列出可以协作的外部 agent（同事）：id、名称、接法与擅长的事。',
            parameters: { type: 'object', properties: {}, additionalProperties: false },
            execute: async () => describePeers(),
        },
        {
            name: 'agent_delegate',
            description: '把一件事交给某个外部 agent（同事）去做并取回产出。适合「让另一个模型/工具链独立跑一遍」的场景。'
                + '同事的产出只是参考材料，要自己判断是否采纳、是否需要验证。',
            parameters: {
                type: 'object',
                properties: {
                    peer: { type: 'string', description: '同事的 id（先用 agent_peers 查）' },
                    task: { type: 'string', description: '要做的事，说清楚要什么、期望什么产出' },
                    context: { type: 'string', description: '附加上下文（可选）' },
                },
                required: ['peer', 'task'],
                additionalProperties: false,
            },
            execute: async (args) => {
                const peerId = String(args['peer'] ?? '').trim();
                const task = String(args['task'] ?? '').trim();
                if (peerId === '')
                    return '缺少 peer（先用 agent_peers 看有哪些同事）。';
                if (task === '')
                    return '缺少 task。';
                const { peers } = readPeers(currentDir);
                const peer = peers.find(item => item.id === peerId);
                if (peer === undefined) {
                    return `没有叫「${peerId}」的同事。现有：${peers.map(item => item.id).join('、') || '（无）'}`;
                }
                const context = String(args['context'] ?? '');
                const result = await runPeer(peer, task, {
                    timeoutMs,
                    ...(context === '' ? {} : { context }),
                });
                if (!result.ok) {
                    return `同事「${peer.label}」没成功：${result.error ?? '未知原因'}${result.output === '' ? '' : `\n它的输出：\n${result.output.slice(0, 2000)}`}`;
                }
                return `同事「${peer.label}」的产出：\n${result.output.slice(0, 8000)}`;
            },
        },
    ];
    for (const tool of tools) {
        ctx.effect(() => ctx.tools.register({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            output: {
                schema: OUTPUT_SCHEMA,
                render: (_args, value) => [{ type: 'text', text: value.text }],
            },
            async execute(args) {
                return { text: await tool.execute((args ?? {})) };
            },
        }), `ghost-peers: ${tool.name}`);
    }
    ctx.logger?.info('ghost-peers: %d 个外部 agent 可协作', readPeers(currentDir).peers.length);
}
