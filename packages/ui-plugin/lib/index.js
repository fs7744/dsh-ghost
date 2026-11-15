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
 * ghost-ui：让用户**用配置**扩展我们的界面与模型服务，不改我们的代码。
 *
 * 三件事：
 *  1. **加页面**：`<root>/panels/*.json` 放面板清单 → 桌面端多出一个页签；
 *  2. **改已有界面**：`<root>/slots/*.json` 放插槽贡献 → 注入聊天工具栏 / 设置分区 / 统计扩展；
 *  3. **加 LLM 服务**：`<root>/providers.json` 放 provider 规格 → 下次启动宿主时写进 profile，
 *     宿主就能用这个 provider（凭据只认 env 引用名，明文密钥一律拒）。
 *
 * 安全边界：扩展只能声明「去哪个宿主端点取数据 / 点了调哪个端点」，
 * 不能塞任意代码进来跑；清单都要过 `@dsh-ghost/ui-extensions` 的校验。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { normalizePanels, normalizeSlots, } from '@dsh-ghost/ui-extensions';
import { validateProviderSpec } from '@dsh-ghost/model-manager';
/** 插件名。 */
export const name = 'ghost-ui';
/** 依赖：工具注册表必需（与其它插件同口径）。 */
export const inject = ['tools'];
/** 编程注册的扩展（别的插件可以在运行时塞进来）。 */
const registeredPanels = [];
const registeredSlots = [];
/** 编程注册一个面板（其它插件用）。 */
export function registerPanel(manifest) {
    registeredPanels.push(manifest);
}
/** 编程注册一条插槽贡献（其它插件用）。 */
export function registerSlot(slot) {
    registeredSlots.push(slot);
}
const readJsonFiles = (dir) => {
    if (!existsSync(dir))
        return [];
    const out = [];
    for (const name of readdirSync(dir)) {
        if (!name.endsWith('.json'))
            continue;
        try {
            out.push(JSON.parse(readFileSync(join(dir, name), 'utf8')));
        }
        catch {
            out.push({ id: name, __parseError: true });
        }
    }
    return out;
};
const PROVIDERS_FILE = 'providers.json';
const PROXY_FILE = 'proxy.json';
const CUSTOM_CSS_FILE = 'custom.css';
/** 校验代理地址；空字符串表示「这一项不设」。非 http(s) 一律拒。 */
export function validateProxy(config) {
    const errors = [];
    for (const key of ['http', 'https']) {
        const value = config[key];
        if (value === undefined || value === '')
            continue;
        if (typeof value !== 'string' || !/^https?:\/\/[^\s]+$/.test(value)) {
            errors.push(`${key} 必须是 http(s) 地址`);
        }
    }
    if (config.noProxy !== undefined && config.noProxy !== '' && typeof config.noProxy !== 'string') {
        errors.push('noProxy 必须是字符串（逗号分隔的主机列表）');
    }
    return errors;
}
/** 读代理配置（纯函数）。 */
export function readProxy(root) {
    const target = join(root, PROXY_FILE);
    if (!existsSync(target))
        return {};
    try {
        const parsed = JSON.parse(readFileSync(target, 'utf8'));
        return typeof parsed === 'object' && parsed !== null ? parsed : {};
    }
    catch {
        return {};
    }
}
/** 写代理配置：校验后原子落盘（纯函数）。 */
export function saveProxy(root, config) {
    const errors = validateProxy(config);
    if (errors.length > 0)
        return { ok: false, errors };
    try {
        mkdirSync(root, { recursive: true });
        const target = join(root, PROXY_FILE);
        const temporary = `${target}.tmp`;
        writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`);
        renameSync(temporary, target);
        return { ok: true, errors: [] };
    }
    catch (error) {
        return { ok: false, errors: [String(error)] };
    }
}
/** 自定义皮肤 CSS 的大小上限（64KB，够用且防手滑贴整个文件进来）。 */
export const CUSTOM_CSS_LIMIT = 64 * 1024;
/**
 * 写用户自定义皮肤 CSS（纯函数）：只接受文本，超过上限拒写。
 */
export function saveCustomCss(root, css) {
    if (typeof css !== 'string')
        return { ok: false, errors: ['皮肤内容必须是文本'] };
    if (Buffer.byteLength(css, 'utf8') > CUSTOM_CSS_LIMIT) {
        return { ok: false, errors: [`皮肤过大（上限 ${CUSTOM_CSS_LIMIT} 字节）`] };
    }
    try {
        mkdirSync(root, { recursive: true });
        const target = join(root, CUSTOM_CSS_FILE);
        const temporary = `${target}.tmp`;
        writeFileSync(temporary, css);
        renameSync(temporary, target);
        return { ok: true, errors: [] };
    }
    catch (error) {
        return { ok: false, errors: [String(error)] };
    }
}
/** 读用户自定义皮肤 CSS（纯函数）。没有文件就返回空串。 */
export function readCustomCss(root) {
    const target = join(root, CUSTOM_CSS_FILE);
    if (!existsSync(target))
        return '';
    try {
        return readFileSync(target, 'utf8');
    }
    catch {
        return '';
    }
}
/** 读面板清单（纯函数，测试直接用）。 */
export function readPanels(root) {
    const result = normalizePanels([...readJsonFiles(join(root, 'panels')), ...registeredPanels]);
    return { panels: result.items, errors: result.errors };
}
/** 读插槽贡献（纯函数）。 */
export function readSlots(root) {
    const result = normalizeSlots([...readJsonFiles(join(root, 'slots')), ...registeredSlots]);
    return { slots: result.items, errors: result.errors };
}
/** 读已登记的 provider（纯函数）。 */
export function readProviders(root) {
    const raw = readProvidersFile(root);
    const providers = Array.isArray(raw) ? raw : [];
    const errors = [];
    for (const provider of providers) {
        for (const problem of validateProviderSpec(provider))
            errors.push(`${provider?.id ?? '?'}: ${problem}`);
    }
    return { providers, errors };
}
/** 写 provider 规格：先校验，再原子写盘（纯函数）。 */
export function saveProviders(root, providers) {
    const errors = [];
    for (const provider of providers) {
        for (const problem of validateProviderSpec(provider))
            errors.push(`${provider?.id ?? '?'}: ${problem}`);
    }
    if (errors.length > 0)
        return { ok: false, errors, count: 0 };
    try {
        mkdirSync(root, { recursive: true });
        const target = join(root, PROVIDERS_FILE);
        const temporary = `${target}.tmp`;
        writeFileSync(temporary, `${JSON.stringify(providers, null, 2)}\n`);
        renameSync(temporary, target);
        return { ok: true, errors: [], count: providers.length };
    }
    catch (error) {
        return { ok: false, errors: [String(error)], count: 0 };
    }
}
/** 宿主 Remote 面。 */
let GhostUiRemote = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _panels_decorators;
    let _slots_decorators;
    let _providers_decorators;
    let _proxy_decorators;
    let _proxySave_decorators;
    let _customCss_decorators;
    let _customCssSave_decorators;
    let _providersSave_decorators;
    return class GhostUiRemote extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _panels_decorators = [Remote('panels')];
            _slots_decorators = [Remote('slots')];
            _providers_decorators = [Remote('providers')];
            _proxy_decorators = [Remote('proxy')];
            _proxySave_decorators = [Remote('proxySave')];
            _customCss_decorators = [Remote('customCss')];
            _customCssSave_decorators = [Remote('customCssSave')];
            _providersSave_decorators = [Remote('providersSave')];
            __esDecorate(this, null, _panels_decorators, { kind: "method", name: "panels", static: false, private: false, access: { has: obj => "panels" in obj, get: obj => obj.panels }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _slots_decorators, { kind: "method", name: "slots", static: false, private: false, access: { has: obj => "slots" in obj, get: obj => obj.slots }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _providers_decorators, { kind: "method", name: "providers", static: false, private: false, access: { has: obj => "providers" in obj, get: obj => obj.providers }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _proxy_decorators, { kind: "method", name: "proxy", static: false, private: false, access: { has: obj => "proxy" in obj, get: obj => obj.proxy }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _proxySave_decorators, { kind: "method", name: "proxySave", static: false, private: false, access: { has: obj => "proxySave" in obj, get: obj => obj.proxySave }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _customCss_decorators, { kind: "method", name: "customCss", static: false, private: false, access: { has: obj => "customCss" in obj, get: obj => obj.customCss }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _customCssSave_decorators, { kind: "method", name: "customCssSave", static: false, private: false, access: { has: obj => "customCssSave" in obj, get: obj => obj.customCssSave }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _providersSave_decorators, { kind: "method", name: "providersSave", static: false, private: false, access: { has: obj => "providersSave" in obj, get: obj => obj.providersSave }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        constructor(ctx) {
            super(ctx, 'ghostUI', { namespace: 'ghostUI' });
            __runInitializers(this, _instanceExtraInitializers);
        }
        /** 所有面板清单（含编程注册的）。 */
        panels(input) {
            return readPanels(input?.root ?? currentRoot);
        }
        /** 所有插槽贡献（含编程注册的）。 */
        slots(input) {
            return readSlots(input?.root ?? currentRoot);
        }
        /** 已登记的 LLM 服务（provider 规格）。 */
        providers(input) {
            return readProviders(input?.root ?? currentRoot);
        }
        /** 代理配置：读取。 */
        proxy(input) {
            const config = readProxy(input?.root ?? currentRoot);
            return { proxy: config, errors: validateProxy(config) };
        }
        /** 代理配置：保存（校验通过才写盘）。 */
        proxySave(input) {
            const config = input?.proxy ?? {};
            return saveProxy(input?.root ?? currentRoot, config);
        }
        /** 用户自定义皮肤 CSS（覆盖 CSS 变量即可换肤）。 */
        customCss(input) {
            return { css: readCustomCss(input?.root ?? currentRoot) };
        }
        /** 保存用户自定义皮肤 CSS（超过 64KB 拒写）。 */
        customCssSave(input) {
            return saveCustomCss(input?.root ?? currentRoot, input?.css ?? '');
        }
        /**
         * 登记 LLM 服务：先过校验，再原子写盘。
         * 写完**下次启动宿主**生效（渲染 profile 时会把它写进 llm-pi-ai.providers）。
         */
        providersSave(input) {
            const providers = Array.isArray(input?.providers) ? input.providers : [];
            return saveProviders(input?.root ?? currentRoot, providers);
        }
    };
})();
export { GhostUiRemote };
let currentRoot = '';
const readProvidersFile = (root) => {
    const target = join(root, PROVIDERS_FILE);
    if (!existsSync(target))
        return [];
    try {
        return JSON.parse(readFileSync(target, 'utf8'));
    }
    catch {
        return [];
    }
};
/**
 * 挂载插件。
 * @param ctx - cordis 上下文
 * @param config - 扩展根目录
 */
export function apply(ctx, config) {
    currentRoot = config.root;
    const cordis = ctx;
    if (cordis.reflect !== undefined)
        new GhostUiRemote(ctx);
    // 自检文件：外部能确认「插件活着、根目录在哪、读到几个扩展」。
    try {
        mkdirSync(config.root, { recursive: true });
        const panels = normalizePanels(readJsonFiles(join(config.root, 'panels')));
        const slots = normalizeSlots(readJsonFiles(join(config.root, 'slots')));
        writeFileSync(join(config.root, 'plugin-state.json'), `${JSON.stringify({
            plugin: name,
            root: config.root,
            panels: panels.items.length,
            slots: slots.items.length,
            panelErrors: panels.errors.length,
            at: new Date().toISOString(),
            pid: process.pid,
        }, null, 2)}\n`);
    }
    catch {
        // 自检文件写不了不影响插件本身
    }
}
