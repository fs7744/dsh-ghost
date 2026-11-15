/**
 * 自动化能力包：浏览器（CDP 直连已装浏览器）与 Windows 电脑操控（UIA + 截图 + 输入）。
 *
 * 分成「纯逻辑」与「执行」两层：
 *  - 本包给出协议与脚本的**生成/解析**（可单测）；
 *  - 真正 spawn 浏览器、跑系统脚本的是插件层（宿主进程内）。
 */
export {
  browserCandidates, clickExpression, CdpClient, fillExpression, findBrowser, launchArgs,
  launchBrowser, parseDevToolsUrl, READ_TEXT_EXPRESSION, truncateText,
  type BrowserCandidate, type LaunchedBrowser,
} from './browser.ts'
export {
  clickScript, elementsScript, escapePowerShellString, invokeScript, isWindows, keysScript,
  parseElements, screenshotScript, setValueScript, typeScript,
} from './computer.ts'
export {
  BROWSER_CHANNELS, bundledChromiumPresent, createBrowserEngine, hostAllowed,
  type BrowserEngine, type EngineOptions,
} from './engine.ts'
export type { UiElement } from './types.ts'
