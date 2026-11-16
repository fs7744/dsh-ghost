/**
 * 浏览器引擎：**Playwright 优先，CDP 兜底**。
 *
 * 为什么主引擎用 Playwright：
 *  - 业界成熟（跨平台一致、会话/等待/选择器语义都稳）；
 *  - `playwright-core` **不自带浏览器**（几 MB），可以直接驱动用户已装的
 *    Chrome / Edge（channel: 'msedge' / 'chrome'），不用下 150MB；
 *  - 想完全隔离就 `npx playwright install chromium` 装一份专用 Chromium。
 *
 * 为什么还留 CDP 兜底：Playwright 没装（或用户的浏览器被策略挡住）时，
 * 我们自己那套 CDP 直连还能顶上——它只依赖 Node 内置的 WebSocket。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { clickExpression, CdpClient, fillExpression, findBrowser, launchBrowser, READ_TEXT_EXPRESSION, } from './browser.js';
/** 站点是否在白名单内。 */
export function hostAllowed(url, allowHosts = []) {
    if (allowHosts.length === 0)
        return true;
    try {
        const host = new URL(url).hostname;
        return allowHosts.some(entry => host === entry || host.endsWith(`.${entry}`));
    }
    catch {
        return false;
    }
}
/** 动态导入 playwright-core；没装就返回 undefined。 */
async function loadPlaywright(importFn) {
    try {
        const loader = importFn ?? (() => import('playwright-core'));
        const module = await loader();
        return module.chromium;
    }
    catch {
        return undefined;
    }
}
/** 常见的浏览器通道（按优先级）。 */
export const BROWSER_CHANNELS = ['msedge', 'chrome'];
/**
 * 创建浏览器引擎：先试 Playwright（系统浏览器 → 自带 Chromium），再退到 CDP。
 * @returns 引擎，或带原因的错误
 */
export async function createBrowserEngine(options = {}) {
    const chromium = await loadPlaywright(options.importPlaywright);
    if (chromium !== undefined) {
        const channels = [...BROWSER_CHANNELS, undefined];
        for (const channel of channels) {
            try {
                const browser = await chromium.launch({
                    ...(channel === undefined ? {} : { channel }),
                    headless: options.headless !== false,
                    args: ['--no-first-run', '--no-default-browser-check'],
                });
                const page = await browser.newPage();
                const engine = {
                    kind: 'playwright',
                    async open(url) {
                        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
                        return page.title();
                    },
                    async read() {
                        return (await page.textContent('body')) ?? '';
                    },
                    async click(selector) {
                        try {
                            await page.click(selector, { timeout: 8000 });
                            return 'clicked';
                        }
                        catch {
                            return 'not-found';
                        }
                    },
                    async type(selector, text) {
                        try {
                            await page.fill(selector, text, { timeout: 8000 });
                            return 'filled';
                        }
                        catch {
                            return 'not-found';
                        }
                    },
                    async screenshot() {
                        return (await page.screenshot({ type: 'png' })).toString('base64');
                    },
                    async close() {
                        if (!page.isClosed())
                            await page.close();
                        await browser.close();
                    },
                };
                return { engine, note: `Playwright（${channel ?? 'chromium'}）` };
            }
            catch {
                // 这个通道不可用，试下一个
            }
        }
    }
    // 兜底：CDP 直连本机浏览器（依赖可注入，单测不必真启动浏览器）
    const deps = options.cdpDeps ?? {};
    const find = deps.findBrowser ?? findBrowser;
    const launch = deps.launchBrowser ?? launchBrowser;
    const connect = deps.connect ?? ((wsUrl) => CdpClient.connect(wsUrl));
    const candidate = find(process.platform, process.env);
    if (candidate === undefined)
        return { error: '本机没找到 Chrome / Edge。' };
    let launched;
    let cdp;
    let sessionId = '';
    try {
        launched = await launch({ executable: candidate.path, headless: options.headless !== false });
        cdp = await connect(launched.wsUrl);
        const target = await cdp.send('Target.createTarget', { url: 'about:blank' });
        const attached = await cdp.send('Target.attachToTarget', { targetId: target.targetId ?? '', flatten: true });
        sessionId = attached.sessionId ?? '';
        await cdp.send('Page.enable', {}, sessionId);
        await cdp.send('Runtime.enable', {}, sessionId);
        const evaluate = async (expression) => {
            const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
            const value = result.result?.value;
            return typeof value === 'string' ? value : JSON.stringify(value ?? '');
        };
        const engine = {
            kind: 'cdp',
            async open(url) {
                await cdp.send('Page.navigate', { url }, sessionId);
                await new Promise(resolve => setTimeout(resolve, 1200));
                return evaluate('document.title');
            },
            async read() {
                return evaluate(READ_TEXT_EXPRESSION);
            },
            async click(selector) {
                return (await evaluate(clickExpression(selector))) === 'not-found' ? 'not-found' : 'clicked';
            },
            async type(selector, text) {
                return (await evaluate(fillExpression(selector, text))) === 'not-found' ? 'not-found' : 'filled';
            },
            async screenshot() {
                const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
                return shot.data ?? '';
            },
            async close() {
                cdp?.close();
                launched?.close();
            },
        };
        return { engine, note: `CDP 直连（${candidate.name}）` };
    }
    catch (error) {
        launched?.close();
        return { error: `浏览器启动失败：${String(error).slice(0, 160)}` };
    }
}
/** Playwright 的 Chromium 是否已经装到本机（用于界面提示）。 */
export function bundledChromiumPresent(home = process.env['PLAYWRIGHT_BROWSERS_PATH'] ?? '') {
    const root = home === '' ? join(process.env['LOCALAPPDATA'] ?? '', 'ms-playwright') : home;
    return existsSync(root);
}
