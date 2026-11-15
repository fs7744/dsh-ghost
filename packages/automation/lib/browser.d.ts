/**
 * 浏览器自动化（CDP 直连，不额外下载浏览器）。
 *
 * 为什么不用 Playwright/Puppeteer：它们要自带一份浏览器（~150MB 下载 + 版本对齐）。
 * 业界同样主流、而且更轻的做法是 **Chrome DevTools Protocol 直连用户已装的
 * Chrome / Edge**：只做协议层的事（导航、取文本、点、填、截图）。
 *
 * 安全姿态：
 *  - **独立的临时用户目录** → 不碰用户真实浏览器的 Cookie 与登录态；
 *  - **默认关**：要用户显式开启（宿主插件配置）；
 *  - 窗口**默认可见** → 用户看得见自动化在干什么（这是可信度，不是装饰）。
 */
import { spawn } from 'node:child_process';
export interface BrowserCandidate {
    /** 可执行文件路径。 */
    path: string;
    /** 展示名。 */
    name: string;
}
/** 各平台常见的浏览器安装位置（按优先级）。 */
export declare function browserCandidates(platform: string, env?: Record<string, string | undefined>): BrowserCandidate[];
/**
 * 找一个真实存在的浏览器。
 * @param exists - 存在性判断（测试可注入）
 */
export declare function findBrowser(platform: string, env?: Record<string, string | undefined>, exists?: (path: string) => boolean): BrowserCandidate | undefined;
/** 从 Chromium 的 stderr 里找 DevTools 地址。 */
export declare function parseDevToolsUrl(text: string): string | undefined;
/** 文本截断（页面正文可能很长）。 */
export declare function truncateText(text: string, max?: number): string;
/** 取页面可读正文的表达式（innerText，回退 textContent）。 */
export declare const READ_TEXT_EXPRESSION = "(() => {\n  const body = document.body;\n  if (!body) return '';\n  return body.innerText || body.textContent || '';\n})()";
/** 点击元素的表达式（CSS 选择器）。 */
export declare function clickExpression(selector: string): string;
/** 填值的表达式（CSS 选择器 + 文本；会派发 input/change 事件）。 */
export declare function fillExpression(selector: string, text: string): string;
/** 已启动的浏览器进程信息。 */
export interface LaunchedBrowser {
    /** DevTools 浏览器级地址。 */
    wsUrl: string;
    /** 临时用户目录。 */
    userDataDir: string;
    /** 关掉浏览器并清理临时目录。 */
    close(): void;
}
/** 启动参数：独立临时目录 + 远程调试端口。 */
export declare function launchArgs(userDataDir: string, headless: boolean): string[];
/**
 * 启动浏览器并等 DevTools 地址出来。
 */
export declare function launchBrowser(options: {
    executable: string;
    headless?: boolean;
    timeoutMs?: number;
    spawnFn?: typeof spawn;
}): Promise<LaunchedBrowser>;
/**
 * 极简 CDP 客户端：一个 WebSocket + id 计数 + pending 表。
 * 只实现我们需要的能力，不做协议全家桶。
 */
export declare class CdpClient {
    private readonly socket;
    private nextId;
    private readonly pending;
    private constructor();
    /** 连上 DevTools 地址。 */
    static connect(wsUrl: string, timeoutMs?: number): Promise<CdpClient>;
    /** 收消息：按 id 分发。 */
    private handle;
    /** 发一条命令并等结果。 */
    send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<unknown>;
    /** 关掉连接。 */
    close(): void;
}
