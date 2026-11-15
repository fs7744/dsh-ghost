# 宿主能力台账：我们接了什么、没接什么、为什么

> 方法：读宿主安装包（base bundle 99 个插件、gateway 224 个端点）+ **在真实宿主里逐个探测**
> （不是查文档猜）。本文的能力状态都能在界面上看到（新增「宿主能力」页签）。

## 0. 两个直接回答

### 浏览器操控：**宿主没有**

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

### 电脑操控：**宿主有，但默认没装载，且官方面向 macOS**

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

## 1. 端点覆盖（真实统计）

宿主 gateway 暴露 224 个端点，我们实际调用过 **46 个**，涉及 19 个命名空间。

**已接（我们自己的界面在用）**：
`session` · `commands` · `skills` · `workspaceFiles` · `messageFeedback` · `job` ·
`directoryPicker` · `fileUploads` · `userQuestions` · `pluginManager` · `pluginMarket` ·
`mcpManager` · `officeKit` · `terminal` · `goals` · `settings`（只读） · `web`（工具侧） ·
以及我们自己的：`ghostMemory` · `ghostTickets` · `ghostSources` · `ghostUI`

**没接（宿主有，我们没在界面上给用户用）**：

| 命名空间 | 能力 | 我们的取舍 |
|---|---|---|
| `cuaAccess` | 电脑操控的授权与状态 | **给了开关**（白名单插件），但默认关、且官方面向 macOS |
| `agentPresets` | Agent 预设（人设 + 工具组合） | **这轮接了**：设置页可切换（standard/ptc/minimal/cordis） |
| `schedule` | 定时任务（模型侧已有 `schedule_*` 工具） | **给了开关**，界面未做（模型侧工具已能用） |
| `speech` | 语音转写 / 合成 | 未接：需要音频栈与交互设计，不适合塞进这轮 |
| `credentials` | 宿主凭据仓 | 未接：我们用自己的系统钥匙串（DPAPI / Keychain），不重复造 |
| `settings/mutate\|update` | 直接改宿主设置 | 未接：只读更安全；需要时走「宿主能力 → 设置」入口 |
| `web` | 网页抓取/搜索的提供方 | 宿主默认开，模型侧可用；界面未暴露开关 |
| `forgePanel` / `liveshareShares` / `dynamicCordisRunner` / `deepseekChatImport` | 宿主的 Forge、协同分享、动态 Cordis 运行器、旧会话导入 | 与本项目定位关系不大，且多数是实验性 |
| `productAnalytics` / `cotTranslation` / `sessionFeedback` / `sessionReferenceResolver` / `remoteAccess` / `permissionPresets` / `pluginInventory` / `pluginRecommendations` | 遥测、思维链翻译、会话反馈、引用解析、远程访问控制、权限预设、插件清单与推荐 | 未接：要么是内部机制，要么需要单独的产品决策 |

## 2. 新增的「宿主能力」页签

界面里能直接看到的四块：

1. **Agent 预设**——列表 + 一键切换（实测 `agentPresets/select` 生效，返回新预设 id）。
2. **电脑操控**——真实状态（`cuaAccess/systemStatus`）；没装载就显示「未装载（官方面向 macOS）」并给开关。
3. **可开启的宿主插件**——白名单（电脑操控 / 电脑操控权限设置 / 定时任务 / 持久目标），
   开启 → 写 `.ghost/ui/host-plugins.json` → **重启宿主**时由 `renderPatch()` 注入 profile。
4. **能力台账**——上面这张表的界面版，每条都有状态与说明。

白名单是刻意的：**只允许这四个包**，其余宿主插件要么是内部机制，要么会改变宿主行为而我们
不掌握后果——用户想开，我们也不替他承担未知副作用。

## 3. 安全边界

- 宿主插件开关只接受白名单 id，非法 id 直接拒（不静默忽略）。
- 装配时二次校验：包必须真的装在运行时里，否则跳过——**不会往 profile 里插一个不存在的包**。
- 电脑操控类插件默认**关**，且要重启宿主才生效（不热插拔，避免半初始化状态）。

## 4. 验证

- `npm run test:capabilities`：预设归一化、电脑操控状态、台账完整性（3 个）。
- 真实宿主：`agentPresets/list` 返回 4 个预设；`agentPresets/select` 生效。
- 557+ 用例、门禁 7/7。
