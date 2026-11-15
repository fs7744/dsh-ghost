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
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface BrowserCandidate {
  /** 可执行文件路径。 */
  path: string
  /** 展示名。 */
  name: string
}

/** 各平台常见的浏览器安装位置（按优先级）。 */
export function browserCandidates(
  platform: string,
  env: Record<string, string | undefined> = {},
): BrowserCandidate[] {
  if (platform === 'win32') {
    const programFiles = env['PROGRAMFILES'] ?? 'C:\\Program Files'
    const programFilesX86 = env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)'
    const localAppData = env['LOCALAPPDATA'] ?? ''
    return [
      { name: 'Chrome', path: join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe') },
      { name: 'Chrome', path: join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe') },
      { name: 'Edge', path: join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe') },
      { name: 'Edge', path: join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe') },
      ...(localAppData === '' ? [] : [
        { name: 'Chrome', path: join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe') },
        { name: 'Edge', path: join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe') },
      ]),
    ]
  }
  if (platform === 'darwin') {
    return [
      { name: 'Chrome', path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
      { name: 'Chrome', path: '/Applications/Chromium.app/Contents/MacOS/Chromium' },
      { name: 'Edge', path: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' },
    ]
  }
  return [
    { name: 'Chrome', path: '/usr/bin/google-chrome' },
    { name: 'Chrome', path: '/usr/bin/google-chrome-stable' },
    { name: 'Chromium', path: '/usr/bin/chromium' },
    { name: 'Chromium', path: '/usr/bin/chromium-browser' },
    { name: 'Edge', path: '/usr/bin/microsoft-edge' },
  ]
}

/**
 * 找一个真实存在的浏览器。
 * @param exists - 存在性判断（测试可注入）
 */
export function findBrowser(
  platform: string,
  env: Record<string, string | undefined> = {},
  exists: (path: string) => boolean = existsSync,
): BrowserCandidate | undefined {
  return browserCandidates(platform, env).find(candidate => exists(candidate.path))
}

/** 从 Chromium 的 stderr 里找 DevTools 地址。 */
export function parseDevToolsUrl(text: string): string | undefined {
  const match = /DevTools listening on (ws:\/\/\S+)/.exec(text)
  return match?.[1]
}

/** 文本截断（页面正文可能很长）。 */
export function truncateText(text: string, max = 8000): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n…（已截断，共 ${text.length} 字）`
}

/** 取页面可读正文的表达式（innerText，回退 textContent）。 */
export const READ_TEXT_EXPRESSION = `(() => {
  const body = document.body;
  if (!body) return '';
  return body.innerText || body.textContent || '';
})()`

/** 点击元素的表达式（CSS 选择器）。 */
export function clickExpression(selector: string): string {
  return `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return 'not-found';
  el.scrollIntoView({ block: 'center' });
  el.click();
  return 'clicked';
})()`
}

/** 填值的表达式（CSS 选择器 + 文本；会派发 input/change 事件）。 */
export function fillExpression(selector: string, text: string): string {
  return `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return 'not-found';
  el.focus();
  const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value');
  if (setter && setter.set) setter.set.call(el, ${JSON.stringify(text)});
  else el.value = ${JSON.stringify(text)};
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return 'filled';
})()`
}

/** 已启动的浏览器进程信息。 */
export interface LaunchedBrowser {
  /** DevTools 浏览器级地址。 */
  wsUrl: string
  /** 临时用户目录。 */
  userDataDir: string
  /** 关掉浏览器并清理临时目录。 */
  close(): void
}

/** 启动参数：独立临时目录 + 远程调试端口。 */
export function launchArgs(userDataDir: string, headless: boolean): string[] {
  return [
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-features=Translate,MediaRouter,OptimizationHints',
    '--disable-popup-blocking',
    ...(headless ? ['--headless=new'] : []),
    'about:blank',
  ]
}

/**
 * 启动浏览器并等 DevTools 地址出来。
 */
export function launchBrowser(options: {
  executable: string
  headless?: boolean
  timeoutMs?: number
  spawnFn?: typeof spawn
}): Promise<LaunchedBrowser> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'dsh-ghost-browser-'))
  const child: ChildProcess = (options.spawnFn ?? spawn)(options.executable, launchArgs(userDataDir, options.headless === true), {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: options.headless === true,
  })
  return new Promise((resolve, reject) => {
    let buffer = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('浏览器启动超时'))
    }, options.timeoutMs ?? 20_000)
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString()
      const wsUrl = parseDevToolsUrl(buffer)
      if (wsUrl === undefined) return
      clearTimeout(timer)
      child.stderr?.off('data', onData)
      resolve({
        wsUrl,
        userDataDir,
        close: () => {
          child.kill()
          try {
            rmSync(userDataDir, { recursive: true, force: true })
          } catch { /* 清理失败无所谓 */ }
        },
      })
    }
    child.stderr?.on('data', onData)
    child.once('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', code => {
      clearTimeout(timer)
      reject(new Error(`浏览器退出（code ${code}）`))
    })
  })
}

interface CdpMessage {
  id?: number
  method?: string
  params?: unknown
  result?: unknown
  error?: { message?: string }
  sessionId?: string
}

/**
 * 极简 CDP 客户端：一个 WebSocket + id 计数 + pending 表。
 * 只实现我们需要的能力，不做协议全家桶。
 */
export class CdpClient {
  private nextId = 1
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()

  private constructor(private readonly socket: WebSocket) {}

  /** 连上 DevTools 地址。 */
  static connect(wsUrl: string, timeoutMs = 10_000): Promise<CdpClient> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(wsUrl)
      const timer = setTimeout(() => {
        socket.close()
        reject(new Error('连接 DevTools 超时'))
      }, timeoutMs)
      socket.addEventListener('open', () => {
        clearTimeout(timer)
        resolve(new CdpClient(socket))
      })
      socket.addEventListener('error', () => {
        clearTimeout(timer)
        reject(new Error('连接 DevTools 失败'))
      })
    })
  }

  /** 收消息：按 id 分发。 */
  private handle(raw: string): void {
    let message: CdpMessage
    try {
      message = JSON.parse(raw) as CdpMessage
    } catch {
      return
    }
    if (message.id === undefined) return
    const entry = this.pending.get(message.id)
    if (entry === undefined) return
    this.pending.delete(message.id)
    if (message.error !== undefined) entry.reject(new Error(message.error.message ?? 'CDP 错误'))
    else entry.resolve(message.result)
  }

  /** 发一条命令并等结果。 */
  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<unknown> {
    const id = this.nextId++
    const payload: Record<string, unknown> = { id, method, params }
    if (sessionId !== undefined) payload['sessionId'] = sessionId
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify(payload))
    })
  }

  /** 关掉连接。 */
  close(): void {
    try {
      this.socket.close()
    } catch { /* 已经关了 */ }
  }
}
