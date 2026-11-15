/** 统一的浏览器引擎接口（工具层只认这个）。 */
export interface BrowserEngine {
    /** 引擎种类，便于界面显示。 */
    readonly kind: 'playwright' | 'cdp';
    /** 打开网址，返回页面标题。 */
    open(url: string): Promise<string>;
    /** 读页面正文。 */
    read(): Promise<string>;
    /** 按 CSS 选择器点击。 */
    click(selector: string): Promise<'clicked' | 'not-found'>;
    /** 按 CSS 选择器填值。 */
    type(selector: string, text: string): Promise<'filled' | 'not-found'>;
    /** 截图，返回 PNG 的 base64。 */
    screenshot(): Promise<string>;
    /** 关掉。 */
    close(): Promise<void>;
}
export interface EngineOptions {
    headless?: boolean;
    /** 允许的站点白名单；空表示不限制。 */
    allowHosts?: string[];
    /** 动态导入 playwright-core（测试可注入）。 */
    importPlaywright?: () => Promise<unknown>;
}
/** 站点是否在白名单内。 */
export declare function hostAllowed(url: string, allowHosts?: readonly string[]): boolean;
/** 常见的浏览器通道（按优先级）。 */
export declare const BROWSER_CHANNELS: readonly ['msedge', 'chrome'];
/**
 * 创建浏览器引擎：先试 Playwright（系统浏览器 → 自带 Chromium），再退到 CDP。
 * @returns 引擎，或带原因的错误
 */
export declare function createBrowserEngine(options?: EngineOptions): Promise<{
    engine: BrowserEngine;
    note: string;
} | {
    error: string;
}>;
/** Playwright 的 Chromium 是否已经装到本机（用于界面提示）。 */
export declare function bundledChromiumPresent(home?: string): boolean;
