# 宿主能力台账：我们接了什么、没接什么、为什么

> 方法：读宿主安装包（base bundle 99 个插件、gateway 224 个端点）+ **在真实宿主里逐个探测**
> （不是查文档猜）。本文的能力状态都能在界面上看到。

## 0. 更正与补记（2026-11-16 晚）

被问到「宿主的多 agent 为何没接，不是说都给了配置吗」——查账后发现两个**高价值欠账**，已补：

### 欠账一：多 agent（subagents / agentTeams）

**实情**：宿主的多 agent **本来就是开的**——`dsh-subagent`、`dsh-agent-team`、
`dsh-tool-agent-team`、`subagent-spawn-in-process`、`subagent-fork-in-process`
都在 base patch 里，**模型侧早就有团队工具与子 agent 工具**。

我之前在台账里把 `subagents` / `agentTeams` 写成「未接」，指的是**界面层**没接——
用户看不见团队任务、管不了子 agent、也看不到权限档位。这轮补上了：

- 新增「**多 agent**」页签：
  - 团队模式开关（`agentTeams/setEnabled`，实测开关后投影里 `agentTeam.enabled` 变 true）；
  - 团队任务列表（投影 `agentTeam.tasks`）；
  - 子 agent 目录与当前子 agent 状态（投影 `subagentCatalog` / `subagent`）；
  - 权限档位显示（投影 `permissions.currentValue`）。

### 欠账二：权限档位（引导页问了却没生效）

`approvalPreset` 在**引导页问过用户**，但**从来没传给宿主**——用户选「只读」或
「工作区可写」，宿主的沙箱策略根本没变。这轮：

- 壳启动宿主时传 `DSH_PERMISSION_MODE`（宿主 `sandbox-policy` 与 `user-approval` 策略
  在加载 patch 时读这个环境变量）；
- 设置页新增「权限档位」区：列出宿主给的档位、标出当前生效档位、可切换
  （改完重启宿主生效）。

### 我之前的说法边界

我当时说的是「已接的列清单 + 未接的逐条写原因」，并**没有**说「宿主能力都已可配置」；
但确实有两个高价值项列了没做，而台账的排版让人误读成「都覆盖了」。这两个已补。

## 1. 浏览器操控：**宿主没有**

宿主里与网页相关的只有三层：

| 宿主包 | 作用 | 状态 |
|---|---|---|
| `dsh-web` | 网页能力抽象层（搜索/抓取的提供方注册表） | 默认开 |
| `dsh-tool-web` | 给模型的 `web_search` / `web_fetch` | 默认开 |
| `dsh-web-search-deepseek` / `dsh-web-fetch-http` | 具体提供方 | 默认开 |

**没有浏览器自动化**（无 Playwright / Puppeteer / CDP 相关包）——也就是说宿主能做的是
「抓一个网址的文本」和「搜一下」，**不能点按钮、不能填表单、不能跑页面脚本**。

想真做浏览器操控，得另接驱动（Playwright / CDP，或 WorkBuddy 侧的 browser-use 插件）。
那是**另一个依赖与一条新的安全面**（脚本执行、凭据、下载），不该顺手塞进来。
我们把它在台账里如实标成「未接入」，而不是假装有。

**后来我们自己做了一套**（Playwright 优先、CDP 兜底），见 [AUTOMATION.md](AUTOMATION.md)。

## 2. 电脑操控：**宿主有，但默认没装载，且官方面向 macOS**

| 宿主包 | 作用 |
|---|---|
| `dsh-computer-use` | 「独占命名」的 computer-use 提供方注册口（seam） |
| `dsh-cua` | 共享的 Computer Use 对象、授权与**带日志的工具执行** |
| `dsh-cua-bundle` | 可选的 **macOS** Computer Use 与权限设置 |

实测：我们的 profile 里这些**没装载** → `cuaAccess/systemStatus` 返回 **404**。

所以我们的做法是：

- 界面「宿主能力 → 电脑操控」显示真实状态（可用 / 未装载）；
- 提供**开关**（白名单里的 `dsh-cua` / `dsh-cua-bundle`），开启后**重启宿主**生效；
- 装配时还会检查包是否真的装在运行时里，**没装就跳过**（不插入不存在的包）；
- 说清楚：**官方 CUA 面向 macOS，Windows 上多半不可用**——不承诺跨平台。

**Windows 那套我们自己写了**（UI Automation 元素级动作，不用截图也不用坐标），
见 [AUTOMATION.md](AUTOMATION.md)。

## 3. 端点覆盖（真实统计）

宿主 gateway 暴露 224 个端点，我们实际调用过 50+ 个，涉及 21+ 个命名空间。

**已接（界面/插件在用）**：
`session` · `commands` · `skills` · `workspaceFiles` · `messageFeedback` · `job` ·
`directoryPicker` · `fileUploads` · `userQuestions` · `pluginManager` · `pluginMarket` ·
`mcpManager` · `officeKit` · `terminal` · `goals` · `settings`（只读） · `web`（工具侧） ·
`agentPresets` · `permissionPresets`（档位目录） · `agentTeams`（团队开关） ·
`subagents`（子 agent 派活/中断） · 以及我们自己的：
`ghostMemory` · `ghostTickets` · `ghostSources` · `ghostUI` · `ghostAutomation` · `ghostPage` · `ghostPeers`

## 4. 仍然没有给用户配置入口的宿主能力（如实清单）

| 命名空间 | 能力 | 为什么不接 | 计划 |
|---|---|---|---|
| `speech/*` | 语音转写 / 合成 | 需要音频栈与交互设计（录音、波形、流式），不是配置能解决的 | 未排期 |
| `credentials/*` | 宿主凭据仓 | 我们用系统钥匙串（DPAPI / Keychain），不做两套凭据 | 不做 |
| `settings/mutate|update|replace` | 直接写宿主设置 | 只读更安全；写设置需要一整套 schema UI | 未排期（可先给个「高级」文本框） |
| `forgePanel/*`（32 端点） | 宿主的 Forge 实验功能 | 与本项目定位不符（我们是工作台，不是 Forge） | 不做 |
| `liveshareShares/*`（13） | 协同分享 | 未接；需要账号体系与分享语义 | 未排期 |
| `dynamicCordisRunner/*`（12） | 浏览器端插件运行器 | 宿主自带的能力，与我们的扩展机制目标重叠 | 不做 |
| `deepseekChatImport` | 旧会话导入 | 与工作台定位无关 | 不做 |
| `productAnalytics` / `cotTranslation` / `sessionFeedback` / `sessionReferenceResolver` / `remoteAccess` / `toolResults` / `account` | 遥测、思维链翻译、会话反馈、引用解析、远程访问控制、工具结果、账号 | 内部机制或需要单独的产品决策（尤其遥测与远程访问） | 未排期 |
| `pluginInventory` / `pluginRecommendations` / `pluginRegistryProbe` | 插件清单 / 推荐 / 仓库探测 | `pluginManager/listPlugins` 与市场页已覆盖大部分 | 低价值，可补 |
| `web`（提供方选择） | 网页搜索/抓取的具体提供方 | 宿主默认开且模型可用，做选择器意义不大 | 不做 |
| `schedule/*`（9 端点） | 定时任务 | 模型侧 `schedule_*` 工具已可用；界面只给了插件开关，没有任务列表 | 可补（下一轮候选） |
| `goals/*`（7 端点） | 目标 | 模型侧工具可用；我们的「目标」页是自建数据 | 不做（两套目标会打架） |

**原则**：能在界面上给用户**开关或选择**的宿主能力（插件、预设、权限档位、团队模式、
外部 agent、浏览器自动化、电脑操控）我们都在做；纯内部机制、账号/遥测类、
以及与我们自建能力重叠的，就明确不接。

## 5. 我们自己补上的宿主之外的能力

- **浏览器自动化**（Playwright 优先、CDP 兜底）：[AUTOMATION.md](AUTOMATION.md)
- **Windows 电脑操控**（UIA 元素级动作）：[AUTOMATION.md](AUTOMATION.md)
- **当前标签页操控**（扩展 + chrome.debugger）：[EXTENSION.md](EXTENSION.md)
- **外部 agent 协作**（CLI / HTTP / A2A）：[PEER-AGENTS.md](PEER-AGENTS.md)
- **用户扩展**（放 JSON 加页面 / 注入界面）：[UI-EXTENSIONS.md](UI-EXTENSIONS.md)

## 6. 验收

- `npm run verify:team`：7 项——团队开关（开/关/投影反映）、投影里的子 agent 目录、
  团队任务列表、权限档位字段，全过。
- `npm run test:team-panel`：3 个——团队任务/子 agent 目录/权限档位的归一化。
