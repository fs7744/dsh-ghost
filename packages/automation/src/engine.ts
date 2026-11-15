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
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  clickExpression, CdpClient, fillExpression, findBrowser, launchBrowser, READ_TEXT_EXPRESSION,
  type LaunchedBrowser,
} from './browser.ts'

/** 统一的浏览器引擎接口（工具层只认这个）。 */
export interface BrowserEngine {
  /** 引擎种类，便于界面显示。 */
  readonly kind: 'playwright' | 'cdp'
  /** 打开网址，返回页面标题。 */
  open(url: string): Promise<string>
  /** 读页面正文。 */
  read(): Promise<string>
  /** 按 CSS 选择器点击。 */
  click(selector: string): Promise<'clicked' | 'not-found'>
  /** 按 CSS 选择器填值。 */
  type(selector: string, text: string): Promise<'filled' | 'not-found'>
  /** 截图，返回 PNG 的 base64。 */
  screenshot(): Promise<string>
  /** 关掉。 */
  close(): Promise<void>
}

/** Playwright 的最小类型（避免在纯包里硬依赖它的类型）。 */
interface PlaywrightPage {
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>
  title(): Promise<string>
  textContent(selector: string): Promise<string | null>
  click(selector: string, options?: { timeout?: number }): Promise<void>
  fill(selector: string, value: string, options?: { timeout?: number }): Promise<void>
  screenshot(options?: { type?: string }): Promise<Buffer>
  close(): Promise<void>
  isClosed(): boolean
}

interface PlaywrightBrowser {
  newPage(): Promise<PlaywrightPage>
  close(): Promise<void>
}

interface PlaywrightChromium {
  launch(options: { channel?: string; headless?: boolean; args?: string[] }): Promise<PlaywrightBrowser>
}

export interface EngineOptions {
  headless?: boolean
  /** 允许的站点白名单；空表示不限制。 */
  allowHosts?: string[]
  /** 动态导入 playwright-core（测试可注入）。 */
  importPlaywright?: () => Promise<unknown>
}

/** 站点是否在白名单内。 */
export function hostAllowed(url: string, allowHosts: readonly string[] = []): boolean {
  if (allowHosts.length === 0) return true
  try {
    const host = new URL(url).hostname
    return allowHosts.some(entry => host === entry || host.endsWith(`.${entry}`))
  } catch {
    return false
  }
}

/** 动态导入 playwright-core；没装就返回 undefined。 */
async function loadPlaywright(importFn?: () => Promise<unknown>): Promise<PlaywrightChromium | undefined> {
  try {
    const loader = importFn ?? (() => import('playwright-core'))
    const module = await loader() as { chromium?: PlaywrightChromium }
    return module.chromium
  } catch {
    return undefined
  }
}

/** 常见的浏览器通道（按优先级）。 */
export const BROWSER_CHANNELS = ['msedge', 'chrome'] as const

/**
 * 创建浏览器引擎：先试 Playwright（系统浏览器 → 自带 Chromium），再退到 CDP。
 * @returns 引擎，或带原因的错误
 */
export async function createBrowserEngine(options: EngineOptions = {}): Promise<
  { engine: BrowserEngine; note: string } | { error: string }
> {
  const chromium = await loadPlaywright(options.importPlaywright)
  if (chromium !== undefined) {
    const channels: Array<string | undefined> = [...BROWSER_CHANNELS, undefined]
    for (const channel of channels) {
      try {
        const browser = await chromium.launch({
          ...(channel === undefined ? {} : { channel }),
          headless: options.headless !== false,
          args: ['--no-first-run', '--no-default-browser-check'],
        })
        const page = await browser.newPage()
        const engine: BrowserEngine = {
          kind: 'playwright',
          async open(url: string) {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
            return page.title()
          },
          async read() {
            return (await page.textContent('body')) ?? ''
          },
          async click(selector: string) {
            try {
              await page.click(selector, { timeout: 8000 })
              return 'clicked'
            } catch {
              return 'not-found'
            }
          },
          async type(selector: string, text: string) {
            try {
              await page.fill(selector, text, { timeout: 8000 })
              return 'filled'
            } catch {
              return 'not-found'
            }
          },
          async screenshot() {
            return (await page.screenshot({ type: 'png' })).toString('base64')
          },
          async close() {
            if (!page.isClosed()) await page.close()
            await browser.close()
          },
        }
        return { engine, note: `Playwright（${channel ?? 'chromium'}）` }
      } catch {
        // 这个通道不可用，试下一个
      }
    }
  }

  // 兜底：CDP 直连本机浏览器
  const candidate = findBrowser(process.platform, process.env)
  if (candidate === undefined) return { error: '本机没找到 Chrome / Edge。' }
  let launched: LaunchedBrowser | undefined
  let cdp: CdpClient | undefined
  let sessionId = ''
  try {
    launched = await launchBrowser({ executable: candidate.path, headless: options.headless !== false })
    cdp = await CdpClient.connect(launched.wsUrl)
    const target = await cdp.send('Target.createTarget', { url: 'about:blank' }) as { targetId?: string }
    const attached = await cdp.send('Target.attachToTarget', { targetId: target.targetId ?? '', flatten: true }) as { sessionId?: string }
    sessionId = attached.sessionId ?? ''
    await cdp.send('Page.enable', {}, sessionId)
    await cdp.send('Runtime.enable', {}, sessionId)
    const evaluate = async (expression: string): Promise<string> => {
      const result = await cdp!.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId) as {
        result?: { value?: unknown }
      }
      const value = result.result?.value
      return typeof value === 'string' ? value : JSON.stringify(value ?? '')
    }
    const engine: BrowserEngine = {
      kind: 'cdp',
      async open(url: string) {
        await cdp!.send('Page.navigate', { url }, sessionId)
        await new Promise(resolve => setTimeout(resolve, 1200))
        return evaluate('document.title')
      },
      async read() {
        return evaluate(READ_TEXT_EXPRESSION)
      },
      async click(selector: string) {
        return (await evaluate(clickExpression(selector))) === 'not-found' ? 'not-found' : 'clicked'
      },
      async type(selector: string, text: string) {
        return (await evaluate(fillExpression(selector, text))) === 'not-found' ? 'not-found' : 'filled'
      },
      async screenshot() {
        const shot = await cdp!.send('Page.captureScreenshot', { format: 'png' }, sessionId) as { data?: string }
        return shot.data ?? ''
      },
      async close() {
        cdp?.close()
        launched?.close()
      },
    }
    return { engine, note: `CDP 直连（${candidate.name}）` }
  } catch (error) {
    launched?.close()
    return { error: `浏览器启动失败：${String(error).slice(0, 160)}` }
  }
}

/** Playwright 的 Chromium 是否已经装到本机（用于界面提示）。 */
export function bundledChromiumPresent(home = process.env['PLAYWRIGHT_BROWSERS_PATH'] ?? ''): boolean {
  const root = home === '' ? join(process.env['LOCALAPPDATA'] ?? '', 'ms-playwright') : home
  return existsSync(root)
}
