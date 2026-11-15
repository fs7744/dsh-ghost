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
 * 自动化插件：给模型装上「浏览器自动化」与「Windows 电脑操控」两组工具。
 *
 * 设计取向（都是有意为之，不是省事）：
 *  - **默认关**：两组能力都要用户在界面里显式开启，避免模型意外操控用户的机器；
 *  - **浏览器不额外下载**：用 CDP 直连用户已装的 Chrome/Edge，独立临时用户目录，
 *    不碰用户真实浏览器的 Cookie 与登录态；窗口默认可见——用户看得见自动化在干什么；
 *  - **电脑操控落在控件上**：先读 UI Automation 元素树（控件名/类型/位置），
 *    再按名字/类型定位，而不是盲点坐标；坐标点击仍然保留（有些东西没有可访问性树）。
 *  - **不提供任意脚本执行**：页面操作走固定的 CDP 表达式（见 @dsh-ghost/automation）。
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { clickScript, createBrowserEngine, elementsScript, findBrowser, hostAllowed, isWindows, keysScript, parseElements, screenshotScript, truncateText, typeScript, } from '@dsh-ghost/automation';
/** 插件名。 */
export const name = 'ghost-automation';
/** 依赖：工具注册表。 */
export const inject = ['tools'];
const STATE_FILE = 'automation.json';
const OUTPUT_SCHEMA = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] };
const readState = (dir) => {
    const target = join(dir, STATE_FILE);
    if (!existsSync(target))
        return { browser: false, computer: false };
    try {
        const parsed = JSON.parse(readFileSync(target, 'utf8'));
        return { browser: parsed.browser === true, computer: parsed.computer === true };
    }
    catch {
        return { browser: false, computer: false };
    }
};
const writeState = (dir, state) => {
    mkdirSync(dir, { recursive: true });
    const target = join(dir, STATE_FILE);
    const temporary = `${target}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`);
    renameSync(temporary, target);
};
/** 跑一段系统脚本（Windows 用系统自带脚本宿主）。 */
function runScript(script, timeoutMs = 30_000) {
    return new Promise((resolve) => {
        execFile('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
            timeout: timeoutMs,
            windowsHide: true,
            maxBuffer: 8 * 1024 * 1024,
        }, (error, stdout, stderr) => {
            if (error === null)
                resolve({ ok: true, stdout, stderr });
            else
                resolve({ ok: false, stdout, stderr: stderr || String(error) });
        });
    });
}
/** 宿主 Remote 面（界面用）。 */
let GhostAutomationRemote = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _status_decorators;
    let _setEnabled_decorators;
    return class GhostAutomationRemote extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _status_decorators = [Remote('status')];
            _setEnabled_decorators = [Remote('setEnabled')];
            __esDecorate(this, null, _status_decorators, { kind: "method", name: "status", static: false, private: false, access: { has: obj => "status" in obj, get: obj => obj.status }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _setEnabled_decorators, { kind: "method", name: "setEnabled", static: false, private: false, access: { has: obj => "setEnabled" in obj, get: obj => obj.setEnabled }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        constructor(ctx) {
            super(ctx, 'ghostAutomation', { namespace: 'ghostAutomation' });
            __runInitializers(this, _instanceExtraInitializers);
        }
        /** 状态：开关 + 本机能力探测。 */
        status(input) {
            const state = readState(input?.root ?? currentDir);
            const candidate = isWindows(process.platform) || process.platform === 'darwin'
                ? findBrowser(process.platform, process.env)
                : findBrowser(process.platform, process.env);
            return {
                browser: {
                    enabled: state.browser,
                    available: candidate !== undefined,
                    ...(candidate === undefined ? {} : { executable: candidate.path, name: candidate.name }),
                },
                computer: {
                    enabled: state.computer,
                    available: isWindows(process.platform),
                    platform: process.platform,
                },
            };
        }
        /** 开关：只接受 boolean。 */
        setEnabled(input) {
            const root = input?.root ?? currentDir;
            const state = readState(root);
            if (typeof input?.browser === 'boolean')
                state.browser = input.browser;
            if (typeof input?.computer === 'boolean')
                state.computer = input.computer;
            writeState(root, state);
            return state;
        }
    };
})();
export { GhostAutomationRemote };
let currentDir = '';
/**
 * 挂载插件。
 */
export function apply(ctx, config) {
    currentDir = config.stateDir;
    const workspaceDir = config.workspaceDir ?? join(currentDir, '..');
    const shotDir = join(workspaceDir, '.ghost', 'screenshots');
    const cordis = ctx;
    if (cordis.reflect !== undefined)
        new GhostAutomationRemote(ctx);
    // —— 浏览器引擎（Playwright 优先，CDP 兜底；懒启动，用完可关）——
    let engine;
    let engineNote = '';
    const ensureBrowser = async () => {
        // 每次现读开关：用户在界面里打开后立刻能用，不必重启宿主。
        if (!readState(currentDir).browser)
            return { ok: false, reason: '浏览器自动化未开启（可在「宿主能力」页打开）。' };
        if (engine !== undefined)
            return { ok: true };
        const created = await createBrowserEngine({
            headless: config.headless !== false,
            ...(config.allowHosts === undefined ? {} : { allowHosts: config.allowHosts }),
        });
        if ('error' in created)
            return { ok: false, reason: created.error };
        engine = created.engine;
        engineNote = created.note;
        return { ok: true };
    };
    const readPage = async () => truncateText(await engine.read());
    const saveShot = (base64) => {
        mkdirSync(shotDir, { recursive: true });
        const target = join(shotDir, `shot-${Date.now()}.png`);
        writeFileSync(target, Buffer.from(base64, 'base64'));
        return target;
    };
    const computerEnabled = () => readState(currentDir).computer ? undefined : '电脑操控未开启（可在「宿主能力」页打开）。';
    const tools = [
        {
            name: 'browser_open',
            description: '用本机已装的 Chrome/Edge 打开一个网址，返回标题与正文摘要。需要先在「宿主能力」页开启浏览器自动化。',
            parameters: {
                type: 'object',
                properties: { url: { type: 'string', description: '要打开的网址（http/https）' } },
                required: ['url'],
                additionalProperties: false,
            },
            execute: async (args) => {
                const url = String(args['url'] ?? '').trim();
                if (url === '')
                    return '缺少 url。';
                if (!hostAllowed(url, config.allowHosts ?? []))
                    return '这个站点不在允许列表里。';
                const ready = await ensureBrowser();
                if (!ready.ok)
                    return ready.reason ?? '浏览器不可用。';
                const title = await engine.open(url);
                const text = await readPage();
                return `已打开 ${url}\n标题：${title}\n正文：\n${text}`;
            },
        },
        {
            name: 'browser_read',
            description: '读取当前浏览器页面的正文文本。',
            parameters: { type: 'object', properties: {}, additionalProperties: false },
            execute: async () => {
                if (engine === undefined)
                    return '还没有打开任何页面。';
                return readPage();
            },
        },
        {
            name: 'browser_click',
            description: '在当前页面按 CSS 选择器点击一个元素（例如 button.primary、a[href="/docs"]）。',
            parameters: {
                type: 'object',
                properties: { selector: { type: 'string', description: 'CSS 选择器' } },
                required: ['selector'],
                additionalProperties: false,
            },
            execute: async (args) => {
                const selector = String(args['selector'] ?? '').trim();
                if (selector === '')
                    return '缺少 selector。';
                if (engine === undefined)
                    return '还没有打开任何页面。';
                const outcome = await engine.click(selector);
                return outcome === 'not-found' ? `找不到元素：${selector}` : `已点击 ${selector}`;
            },
        },
        {
            name: 'browser_type',
            description: '在当前页面的输入框里填入文本（CSS 选择器 + 文本）。',
            parameters: {
                type: 'object',
                properties: {
                    selector: { type: 'string', description: 'CSS 选择器' },
                    text: { type: 'string', description: '要输入的文本' },
                },
                required: ['selector', 'text'],
                additionalProperties: false,
            },
            execute: async (args) => {
                const selector = String(args['selector'] ?? '').trim();
                const text = String(args['text'] ?? '');
                if (selector === '')
                    return '缺少 selector。';
                if (engine === undefined)
                    return '还没有打开任何页面。';
                const outcome = await engine.type(selector, text);
                return outcome === 'not-found' ? `找不到元素：${selector}` : `已填入 ${selector}`;
            },
        },
        {
            name: 'browser_screenshot',
            description: '给当前页面截图，保存到工作区并返回文件路径（可用 read_image 查看）。',
            parameters: { type: 'object', properties: {}, additionalProperties: false },
            execute: async () => {
                if (engine === undefined)
                    return '还没有打开任何页面。';
                const shot = await engine.screenshot();
                if (shot === '')
                    return '截图失败。';
                return `截图已保存：${saveShot(shot)}`;
            },
        },
        {
            name: 'browser_close',
            description: '关掉自动化浏览器。',
            parameters: { type: 'object', properties: {}, additionalProperties: false },
            execute: async () => {
                await engine?.close();
                engine = undefined;
                return '浏览器已关闭。';
            },
        },
        {
            name: 'computer_elements',
            description: '列出当前桌面上可访问的界面元素（控件名、类型、坐标），用于按名字定位而不是盲点。',
            parameters: {
                type: 'object',
                properties: { limit: { type: 'number', description: '最多取多少个元素（默认 120）' } },
                additionalProperties: false,
            },
            execute: async (args) => {
                const blocked = computerEnabled();
                if (blocked !== undefined)
                    return blocked;
                const limit = typeof args['limit'] === 'number' ? Math.max(1, Math.min(500, Math.floor(args['limit']))) : 120;
                const result = await runScript(elementsScript(limit));
                if (!result.ok)
                    return `读取元素失败：${result.stderr.slice(0, 160)}`;
                const elements = parseElements(result.stdout);
                if (elements.length === 0)
                    return '没有读到可访问元素。';
                return elements.map(element => `${element.type}「${element.name}」(${element.automationId === '' ? '-' : element.automationId}) @${element.x},${element.y} ${element.width}x${element.height}`).join('\n');
            },
        },
        {
            name: 'computer_click',
            description: '在屏幕上按坐标点击（Windows）。先用 computer_elements 找到控件位置更稳。',
            parameters: {
                type: 'object',
                properties: {
                    x: { type: 'number', description: '屏幕横坐标' },
                    y: { type: 'number', description: '屏幕纵坐标' },
                    button: { type: 'string', enum: ['left', 'right', 'double'], description: '按键类型，默认左键' },
                },
                required: ['x', 'y'],
                additionalProperties: false,
            },
            execute: async (args) => {
                const blocked = computerEnabled();
                if (blocked !== undefined)
                    return blocked;
                const x = Number(args['x']);
                const y = Number(args['y']);
                if (!Number.isFinite(x) || !Number.isFinite(y))
                    return 'x / y 必须是数字。';
                const button = args['button'] === 'right' || args['button'] === 'double' ? args['button'] : 'left';
                const result = await runScript(clickScript(x, y, button));
                return result.ok ? `已点击 (${Math.round(x)}, ${Math.round(y)})` : `点击失败：${result.stderr.slice(0, 160)}`;
            },
        },
        {
            name: 'computer_type',
            description: '在屏幕上输入文本（Windows，中文也能输）。',
            parameters: {
                type: 'object',
                properties: { text: { type: 'string', description: '要输入的文本' } },
                required: ['text'],
                additionalProperties: false,
            },
            execute: async (args) => {
                const blocked = computerEnabled();
                if (blocked !== undefined)
                    return blocked;
                const text = String(args['text'] ?? '');
                if (text === '')
                    return '缺少 text。';
                const result = await runScript(typeScript(text));
                return result.ok ? '已输入。' : `输入失败：${result.stderr.slice(0, 160)}`;
            },
        },
        {
            name: 'computer_keys',
            description: '发送特殊按键（Windows），如 ENTER、TAB、CTRL+A、ESC。',
            parameters: {
                type: 'object',
                properties: { keys: { type: 'string', description: '按键串，如 ENTER 或 ^a' } },
                required: ['keys'],
                additionalProperties: false,
            },
            execute: async (args) => {
                const blocked = computerEnabled();
                if (blocked !== undefined)
                    return blocked;
                const keys = String(args['keys'] ?? '').trim();
                if (keys === '')
                    return '缺少 keys。';
                const result = await runScript(keysScript(keys));
                return result.ok ? `已发送 ${keys}。` : `按键失败：${result.stderr.slice(0, 160)}`;
            },
        },
        {
            name: 'computer_screenshot',
            description: '截取整屏，保存到工作区并返回文件路径（可用 read_image 查看）。',
            parameters: { type: 'object', properties: {}, additionalProperties: false },
            execute: async () => {
                const blocked = computerEnabled();
                if (blocked !== undefined)
                    return blocked;
                mkdirSync(shotDir, { recursive: true });
                const target = join(shotDir, `screen-${Date.now()}.png`);
                const result = await runScript(screenshotScript(target));
                if (!result.ok || !existsSync(target))
                    return `截图失败：${result.stderr.slice(0, 160)}`;
                return `截图已保存：${target}`;
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
        }), `ghost-automation: ${tool.name}`);
    }
    const current = readState(currentDir);
    ctx.logger?.info('ghost-automation: 浏览器 %s / 电脑操控 %s', current.browser ? '开' : '关', current.computer ? '开' : '关');
}
