/**
 * Windows 电脑操控（不用官方 macOS-only 的 CUA，自己写一套 Windows 版）。
 *
 * 能力：
 *  - **截图**：全屏抓取 → PNG（可多显示器，取虚拟屏幕）；
 *  - **鼠标**：移动 + 点击（左/右/双击）；
 *  - **键盘**：Unicode 文本输入（SendInput）+ 特殊按键（SendKeys）；
 *  - **元素树**：Windows UI Automation 读出控件名/类型/位置 → **动作可以落在控件上，
 *    而不是盲点坐标**（这是能用的关键）。
 *
 * 实现方式：**PowerShell + 内置 .NET 组件**（System.Drawing / Windows.Forms / UIAutomationClient），
 * 不需要编译原生程序、不需要额外依赖。
 *
 * 安全姿态：默认关；开启后所有动作都经由本模块生成脚本，**不执行任意用户脚本**。
 */
import type { UiElement } from './types.ts';
export { type UiElement } from './types.ts';
/** PowerShell 单引号字符串转义（单引号要写两个）。 */
export declare function escapePowerShellString(text: string): string;
/** 全屏截图脚本。 */
export declare function screenshotScript(outputPath: string): string;
/** 鼠标点击脚本。 */
export declare function clickScript(x: number, y: number, button?: 'left' | 'right' | 'double'): string;
/** 文本输入脚本（Unicode 逐字符 SendInput，中文也能打）。 */
export declare function typeScript(text: string): string;
/** 特殊按键脚本（ENTER / TAB / CTRL+A 等，走 SendKeys）。 */
export declare function keysScript(keys: string): string;
/** UI Automation 元素树脚本（控件名、类型、位置、可用性）。 */
export declare function elementsScript(limit?: number): string;
/** 解析元素树输出（PowerShell 可能返回对象或数组）。 */
export declare function parseElements(output: string): UiElement[];
/** Windows 平台判定（电脑操控只在 Windows 上做）。 */
export declare function isWindows(platform: string): boolean;
