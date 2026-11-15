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
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
/** 桥的存储：按 sessionId 分。 */
const bridges = new Map();
/**
 * 「当前页面」只有一个：本地单用户应用 + 一个浏览器扩展，
 * 所以最近一次上报的会话就是活动页（多标签/多会话的取舍写在这里）。
 */
let activeSessionId = '';
/** 当前活动页的 sessionId（没有扩展连着时为空串）。 */
export function activePageSessionId() {
    return activeSessionId;
}
const bridgeFor = (sessionId) => {
    let bridge = bridges.get(sessionId);
    if (bridge === undefined) {
        bridge = { snapshot: undefined, pending: [], inflight: new Map(), lastSeenAt: 0 };
        bridges.set(sessionId, bridge);
    }
    return bridge;
};
/** 扩展是否在线（60 秒内轮询过）。 */
export function isBridgeOnline(sessionId, now = Date.now()) {
    const bridge = bridges.get(sessionId);
    return bridge !== undefined && now - bridge.lastSeenAt < 60_000;
}
/** 上报快照（扩展侧调用；也是 Remote 的底层）。 */
export function registerSnapshot(sessionId, snapshot) {
    const bridge = bridgeFor(sessionId);
    bridge.snapshot = {
        url: String(snapshot?.url ?? ''),
        title: String(snapshot?.title ?? ''),
        text: String(snapshot?.text ?? '').slice(0, 20_000),
        at: Date.now(),
    };
    bridge.lastSeenAt = Date.now();
    activeSessionId = sessionId;
}
/**
 * 取一条待执行命令（扩展轮询）。
 * 注意：取走只是「在途」，命令仍在 inflight 里等结果——否则回传时找不到人可唤醒。
 */
export function takeCommand(sessionId) {
    const bridge = bridgeFor(sessionId);
    const queued = bridge.pending.shift();
    if (queued === undefined)
        return undefined;
    bridge.inflight.set(queued.command.id, queued);
    return queued.command;
}
/** 回传结果，唤醒等待中的模型工具。 */
export function completeCommand(sessionId, result) {
    const bridge = bridgeFor(sessionId);
    const pending = bridge.inflight.get(String(result?.id ?? ''));
    if (pending === undefined)
        return false;
    bridge.inflight.delete(pending.command.id);
    clearTimeout(pending.timer);
    pending.resolve({
        id: String(result.id),
        ok: result.ok === true,
        message: String(result.message ?? ''),
        ...(result.path === undefined ? {} : { path: result.path }),
        ...(result.data === undefined ? {} : { data: String(result.data) }),
    });
    return true;
}
/** 读当前页面快照。 */
export function readSnapshot(sessionId) {
    const bridge = bridges.get(sessionId);
    if (bridge === undefined)
        return { online: false };
    return { ...(bridge.snapshot === undefined ? {} : { snapshot: bridge.snapshot }), online: isBridgeOnline(sessionId) };
}
/**
 * 宿主 Remote 面（扩展用）。
 */
let GhostPageRemote = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _register_decorators;
    let _next_decorators;
    let _result_decorators;
    let _read_decorators;
    return class GhostPageRemote extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _register_decorators = [Remote('register')];
            _next_decorators = [Remote('next')];
            _result_decorators = [Remote('result')];
            _read_decorators = [Remote('read')];
            __esDecorate(this, null, _register_decorators, { kind: "method", name: "register", static: false, private: false, access: { has: obj => "register" in obj, get: obj => obj.register }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _next_decorators, { kind: "method", name: "next", static: false, private: false, access: { has: obj => "next" in obj, get: obj => obj.next }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _result_decorators, { kind: "method", name: "result", static: false, private: false, access: { has: obj => "result" in obj, get: obj => obj.result }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _read_decorators, { kind: "method", name: "read", static: false, private: false, access: { has: obj => "read" in obj, get: obj => obj.read }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        constructor(ctx) {
            super(ctx, 'ghostPage', { namespace: 'ghostPage' });
            __runInitializers(this, _instanceExtraInitializers);
        }
        /** 扩展上报页面快照。 */
        register(input) {
            if (typeof input?.sessionId !== 'string' || input.sessionId === '')
                return { ok: false };
            registerSnapshot(input.sessionId, input.snapshot);
            return { ok: true };
        }
        /** 扩展轮询命令（长轮询：最多等 20 秒）。 */
        async next(input) {
            if (typeof input?.sessionId !== 'string' || input.sessionId === '')
                return {};
            bridgeFor(input.sessionId).lastSeenAt = Date.now();
            const queued = takeCommand(input.sessionId);
            if (queued !== undefined)
                return { command: queued };
            await new Promise(resolve => setTimeout(resolve, 20_000));
            const later = takeCommand(input.sessionId);
            return later === undefined ? {} : { command: later };
        }
        /** 扩展回传执行结果。 */
        result(input) {
            if (typeof input?.sessionId !== 'string' || input.sessionId === '')
                return { ok: false };
            return { ok: completeCommand(input.sessionId, input.result) };
        }
        /** 读当前页面快照。 */
        read(input) {
            return readSnapshot(input?.sessionId ?? '');
        }
    };
})();
export { GhostPageRemote };
/**
 * 下发一条命令并等结果。
 * @param timeoutMs - 等待上限
 */
export function dispatchPageCommand(sessionId, command, timeoutMs = 60_000) {
    const bridge = bridgeFor(sessionId);
    const id = `pc-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            const index = bridge.pending.findIndex(item => item.command.id === id);
            if (index >= 0)
                bridge.pending.splice(index, 1);
            bridge.inflight.delete(id);
            resolve({ id, ok: false, message: '扩展没有回应（页面桥可能没连上，或标签页被关掉了）。' });
        }, timeoutMs);
        bridge.pending.push({
            command: { ...command, id },
            resolve,
            timer,
        });
    });
}
