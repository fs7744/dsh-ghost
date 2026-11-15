# 浏览器自动化 与 Windows 电脑操控

> 目标：浏览器自动化按**业界成熟方案**做（Playwright 优先），电脑操控**补上 Windows**（宿主官方 CUA 只面向 macOS）。
> 两组能力都**默认关闭**，要在界面里显式开启；开启后立即生效。

## 0. 一览

| 能力 | 引擎 | 默认 | 平台 |
|---|---|---|---|
| 浏览器自动化 | **Playwright**（`playwright-core`，驱动系统 Chrome/Edge）→ 兜底 **CDP 直连** | 关 | Windows / macOS / Linux |
| 电脑操控 | Windows **UI Automation + 截图 + 输入**（PowerShell + 内置 .NET） | 关 | 仅 Windows |

## 1. 浏览器自动化：为什么是 Playwright

业界主流就是 Playwright / Puppeteer 这类 **浏览器驱动 + CDP** 方案。我们选 Playwright 的理由：

- `playwright-core` **不自带浏览器**（几 MB），直接驱动用户已装的 Chrome / Edge
  （`channel: 'msedge' / 'chrome'`）——不用下 150MB 的 Chromium；
- 想完全隔离就 `npx playwright install chromium` 装一份专用浏览器，插件会自动优先用它；
- 等待语义、选择器语义、会话管理都是成熟实现，比我们手写 CDP 稳。

**兜底**：Playwright 没装、或系统浏览器被策略挡住时，用我们自己那套 **CDP 直连**
（只依赖 Node 内置 `WebSocket`，独立临时用户目录，不碰用户真实浏览器的 Cookie）。
本机上就是这条路径救的场：Edge 裸启会被单实例吞掉（exit 0），Playwright 的启动参数能过。

引擎选择是**运行时探测**的，界面会显示当前用的是哪个（`Playwright（msedge）` / `CDP 直连（Edge）`）。

## 2. 工具（模型侧）

| 工具 | 作用 |
|---|---|
| `browser_open(url)` | 打开网址，返回标题 + 正文摘要 |
| `browser_read()` | 读当前页正文（截断到 8000 字） |
| `browser_click(selector)` | 按 CSS 选择器点击 |
| `browser_type(selector, text)` | 按选择器填值 |
| `browser_screenshot()` | 截图存到工作区，返回路径（模型可用 `read_image` 看） |
| `browser_close()` | 关掉浏览器 |
| `computer_elements()` | 列出桌面上可访问的界面元素（控件名 / 类型 / 坐标） |
| `computer_click(x, y, button?)` | 坐标点击（左/右/双击） |
| `computer_type(text)` | 输入文本（Unicode，中文可用） |
| `computer_keys(keys)` | 特殊按键（ENTER / TAB / CTRL+A…） |
| `computer_screenshot()` | 整屏截图存工作区，返回路径 |

## 3. Windows 电脑操控：我们自己写的一套

宿主官方 `dsh-cua` / `dsh-cua-bundle` **面向 macOS**（`dsh-cua-bundle` 的描述里明确写着
"Optional macOS Computer Use and permission setup"），所以 Windows 这边我们另写一套：

| 能力 | 实现 | 说明 |
|---|---|---|
| 截图 | `System.Drawing` + `CopyFromScreen` | 取**虚拟屏幕**，多显示器也对；输出 PNG 到工作区 |
| 鼠标 | `user32.dll` 的 `SetCursorPos` + `mouse_event` | 左/右/双击 |
| 键盘输入 | `SendInput`（KEYEVENTF_UNICODE） | 逐字符，中文/emoji 都能打 |
| 特殊按键 | `SendKeys` | ENTER / TAB / `^a` 等 |
| **元素树** | `UIAutomationClient` | 控件名、类型、AutomationId、坐标、可用性 |

**元素树是关键**：先读到控件（“保存”“登录”“提交”……），再按名字/类型定位，
而不是盲点坐标——盲点在高 DPI、缩放、窗口移动下基本不可用。坐标点击仍然保留，
因为有些东西没有可访问性树（自绘控件、Canvas）。

实现方式：**PowerShell + 系统自带 .NET 组件**，不需要编译原生程序、不需要额外依赖；
所有动作都由固定脚本模板生成，**不执行用户提供的任意脚本**。

## 4. 安全姿态（都是刻意的）

- **默认关**：两组能力都要在「宿主能力 → 自动化」里显式打开；
- **开关立即生效**：插件每次调用现读开关文件，不需要重启宿主；
- **站点白名单**：插件配置 `allowHosts` 非空时，只允许这些域名（子域也算）；
- **独立浏览器画像**：CDP 兜底路径用**临时用户目录**，不碰用户真实浏览器的登录态；
- **窗口默认可见**：用户看得见自动化在干什么（这是可信度，不是装饰）；
- **不提供任意脚本执行**：页面操作走固定表达式（`@dsh-ghost/automation` 里可查）；
- **不提供任意命令**：Windows 侧只有截图/点击/输入/按键/读元素这五种。

## 5. 真机验收

`npm run verify:automation`（本机实跑，不需要模型与 key）：

```
PASS  浏览器引擎就绪：Playwright（msedge）
PASS  打开了测试页（标题：自动化验收）
PASS  读到了页面正文
PASS  按选择器点击成功
PASS  点击真的生效了（页面内容变了）
PASS  按选择器填值成功
PASS  页面截图拿到了数据（10624 字节 base64）
PASS  整屏截图落盘成功
PASS  截图不是空白（5135763 字节）
PASS  UI Automation 读到 120 个可访问元素
PASS  元素里有可读的控件名（可以按名字定位，而不是盲点）
PASS  鼠标点击脚本执行完成
```

`npm run verify:automation-plugin`（真实宿主里插件可用、开关能改）：

```
PASS  ghostAutomation/status 可调用
PASS  报出浏览器可用性：true（Edge）
PASS  报出电脑操控可用性：true（win32）
PASS  开关能关
PASS  开关能开（立即生效）
```

## 6. 边界

- **浏览器自动化不是「任意网站都能用」**：站点可能有反自动化、登录墙、验证码；
  我们不绕过它们。
- **电脑操控只在 Windows 上**：macOS/Linux 的等价物需要各自的实现
  （宿主官方 CUA 是 macOS 的，但它没装载、也没验证过）。
- **不做视觉定位**：没有 OCR / 截图找按钮，只用 DOM 选择器与 UIA 元素树；
  视觉定位是另一条技术路线（要模型看图 + 坐标回归）。
- **不代替人做最终确认**：涉及付款、删除、发送这类动作，模型应该先问。

## 7. 相关文件

| 文件 | 作用 |
|---|---|
| `packages/automation/src/browser.ts` | CDP 直连（发现浏览器、启动、客户端、页面表达式） |
| `packages/automation/src/engine.ts` | 引擎抽象：Playwright 优先、CDP 兜底、白名单 |
| `packages/automation/src/computer.ts` | Windows 脚本生成与元素树解析 |
| `packages/automation-plugin/src/index.ts` | 宿主插件：注册 11 个工具 + `ghostAutomation/*` |
| `apps/desktop/src/capabilities-panel.ts` | 界面：自动化开关与状态 |
| `scripts/verify-automation.mjs` | 真机能力验收 |
| `scripts/verify-automation-plugin.mjs` | 宿主内插件验收 |
