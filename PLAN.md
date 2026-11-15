# dsh-ghost 计划

> 目标：以 **deepseek-harness 为内核**、以 **superagent 理念**为核心能力的跨平台桌面产品。
> 硬约束：**harness 只升级、不修改**；superagent 是我们自己的副本，所有适配改动只发生在这里。

---

## 1. 一页结论

| 问题 | 结论 |
|---|---|
| harness 要不要 fork | **不要**。fork 一次就失去"只升级核心"的全部收益 |
| superagent 怎么放 | **搬出来单独一份**，作为普通 npm 包（bundle）挂在 harness 的 profile 上，源码在我们仓库 |
| 升级 harness 时改什么 | 只改**一层薄适配（`packages/harness-port`）+ 版本声明**，绝不动 harness 源码 |
| 靠什么保证不改漏 | **契约清单 + 探针**（已建，**131 项**，0.2.2-rc.3 全绿，含 3 个 Remote 端点）+ `port` 目录的 import 纪律检查 |
| 支持几个 harness 版本 | **只跟最新**。不维护多版本矩阵，省掉一半测试面 |
| 一共要做多少 | **227 项功能/交付件**：harness 白拿 73、superagent 移植 59、自建 95。逐项清单见 [docs/FEATURES.md](docs/FEATURES.md) |
| 桌面端 | **Electron 大窗口应用**（已定）。功能面对标 Claude / WorkBuddy，差异在 superagent 理念层；自建壳，不复用 `apps/desktop` |
| 界面用谁的 | **自己写**。不用 harness 的 Web UI，也不用 superagent 的 Web 面板；只复用 harness 的 **API 契约**（`ctx.remote` / Typert Remote），不碰它的组件 |
| 先支持哪些平台 | **只做 Windows（x64）**。macOS / Linux 等 Windows 跑通闭环之后再排 |
| 剧本怎么表达 | **流程图给人、紧凑文本给模型**：`.flow` 是唯一真相源，布局 JSON 只给 UI 用，不进 prompt。见 [docs/PLAYBOOK.md](docs/PLAYBOOK.md) |
| 剧本编译成什么 | **完整的 skill 包**（`SKILL.md` + `scripts/` + `references/` + `assets/`），不是一篇文档；确定性步骤写成脚本，模型只读输出 |
| 记忆怎么办 | **文件式四层记忆**：会话 / 项目（进 git）/ 用户（≤2KB 常驻）/ 团队；写入有门槛，人可看可删。见 [docs/MEMORY.md](docs/MEMORY.md) |
| 进化怎么办 | 记忆 / 剧本 / 技能三级进化，**每级都走人闸 + git + before/after 度量**，禁止运行时静默改自己 |
| 命令与压缩 | 能力全用 harness（`commands/*` Remote + 三层压缩），入口自己写；压缩要**看得见**。见 [docs/COMMANDS.md](docs/COMMANDS.md) |

---

## 2. 已定前提与推论

| # | 你定的 | 推论（本计划据此展开） |
|---|---|---|
| 1 | 跟着 harness 走，cordis 版由 harness 决定 | 去掉 `@deepseek-ai/cordis` 的精确钉 `4.0.5-alpha.1`，改成跟随 harness 的 `vendor/cordis`；我们自己不锁框架版本 |
| 2 | 只跟最新 | `engines.dsh` 写成区间而不是精确值；不写多版本兼容分支；漂移即修，不背历史包袱 |
| 3 | superagent 拿过来单独一份，可改；**搬进来就对齐架构** | 不做"零改动移植"过渡期。第一版落地即按 port 层 + 契约驱动重组，鉴权同批做完；上游不再跟踪 |
| 4 | 桌面端 = Electron 大窗口，对标 Claude / WorkBuddy，但以 superagent 理念为核心 | 桌面端是 P3 产品层；domain（Ticket / Policy / Executor / Panel）必须与"壳"无关 |
| 5 | 模型层不止 DeepSeek：任何模型都可换，用户还能自己写适配插件 | 做成三层：配置化路由（harness 白给）+ 我们的模型管理面 + 对外稳定的 adapter 契约（见第 12 节） |
| 6 | P3 MVP 档位按建议收敛 | 多会话 / 工具+审批 / 文件编辑 / 终端+后台 / MCP / 多语言 / 更新；语音、账号额度、云同步后置 |
| 7 | **不用那两个项目的 Web UI** | 界面全部自建；只复用 API 契约（`ctx.remote`），不加载 `dsh-web-app` / `client/*`，也不带 superagent 原面板 |
| 8 | **先只支持 Windows x64** | 不为 macOS / Linux 预留抽象层；Windows 跑通闭环后再评估 |
| 9 | **剧本 = skill**：图给人、文本给模型 | `.flow` 是唯一真相源，布局 JSON 只给 UI；同一流程实测 token 差 8.7 倍（见第 9 节） |

**关键推论**：既然「不改 harness + 只跟最新」，那么 harness 每次发版都可能打穿我们 —— 这是**已知的、可管理的风险**，不是要消除的缺陷。管理手段只有三个：契约面收紧、适配层单点、升级流水线。**别指望 harness 给兼容承诺**——它自己在 `AGENTS.md` 里写明 `Public APIs are pre-stable; update every consumer`。

---

## 3. 目标架构

```
┌──────────────────────────────────────────────────────────────┐
│  apps/desktop   Electron 大窗口应用（Windows 先行，P3）         │
│  我们自己的 UI：工作台 / 剧本流程图 / Superagent 面板           │
│  托盘 / 单实例 / 崩溃恢复 / 更新                                │
└───────────────────────────┬──────────────────────────────────┘
                            │ Typert Remote over 127.0.0.1
                            │ （只用 API 契约，不用它的任何组件）
┌───────────────────────────▼──────────────────────────────────┐
│  harness 内核（npm 依赖，只升级不改）                            │
│  @deepseek-ai/dsh + 宿主 + webserver + api-gateway + cordis    │
│  ✗ 不加载 harness 的 Web 前端（dsh-web-app / client/*）         │
└───────────────────────────┬──────────────────────────────────┘
                            │ bundle patch（cordis.patch.yml）
┌───────────────────────────▼──────────────────────────────────┐
│  packages/superagent      我们的副本（唯一改动出口之一）          │
│  host 插件 / 3 个插件入口 / 视图模型 / 2 个 agent preset         │
│  剧本（.flow → skill）                                          │
│  ✗ 不带自己的 Web 面板（渲染归 apps/desktop）                    │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ packages/harness-port   唯一允许 import @deepseek-ai/*  │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

**两条与上一版不同的硬边界**：

1. **界面全部自建**。不用 harness 的 Web UI，也不用 superagent 原来的面板。`dsh-web-app`、`packages/client/ui-*` 一概不加载；只复用 `api-gateway` 的 **Remote 契约**（`ctx.remote`）拿数据。代价是界面工作量从"白拿 25 项"变成"自建 25 项"，收益是产品长相、交互、剧本编辑器完全自己做主。
2. **superagent 只留宿主侧**。它原来的 `src/client`（slots 面板、手写控件、`?raw` CSS）整块废弃；`src/app/views` 的 7 个视图模型保留下来当**数据形状**，渲染由我们的 UI 消费。

**为什么 `harness-port` 是这套方案的全部关键**：它把"harness 变了"收敛成"改 4 个文件"。

```
packages/harness-port/src/
├── runtime-symbols.ts   # 5 个值符号：Service / freezeMessage / MessageId / ReasoningEffortId / scopeParentOf
├── services.ts          # 12 个宿主 ctx 服务键 + Remote 客户端契约的类型聚合
├── contracts.ts         # 4 个事件 + 关键类型（Agent / Session / SessionEvent / ISessions …）
└── manifest.ts           # dsh.bundle / manifestVersion 字段与校验
```

superagent 与 desktop 的其余代码**只能** `import { … } from '@ghost/harness-port'`。harness 断契约 → 编译错误全集中在这 4 个文件里，改动半径可预期。

---

## 4. 仓库布局

```
dsh-ghost/
├── PLAN.md                        # 本文件
├── package.json                   # pnpm workspace 根
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── apps/
│   └── desktop/                   # P3：Electron 壳（Windows）；现先用 Vite 在浏览器跑第一屏
│       ├── main/                  #   主进程：runtime 子进程 / 单实例 / 托盘 / 更新
│       └── renderer/              #   我们自己的界面（聊天 / 面板 / 剧本编辑器）
├── packages/
│   ├── superagent/                # P1：superagent 副本（bundle，宿主侧）
│   │   ├── cordis.patch.yml
│   │   ├── src/{app,core,sources,infra}/   # 无 client/：面板渲染归 renderer
│   │   ├── playbooks/<name>/      # 剧本包 = skill 包：flow.flow + SKILL.md
│   │   │                          #   + scripts/ + references/ + assets/
│   │   ├── prompts/  skills/  locale/
│   │   └── package.json           # dsh.bundle + engines.dsh
│   ├── playbook/                  # P2/P3：.flow 解析器、编译器、图模型
│   └── harness-port/              # P1：唯一允许 import @deepseek-ai/*
│       ├── src/transport.ts       #   ✅ 一元调用 + 事件订阅（零 @deepseek-ai 依赖）
│       └── src/remotes.generated.ts #   ✅ 224 个端点的类型表（生成物）
├── harness-contract/
│   ├── contract.json              # 已建：128 项依赖面
│   └── matrix.json                # 已验证的 harness 版本记录
├── scripts/
│   ├── verify-harness-contract.mjs   # 已建：只读探针
│   ├── verify-port.mjs               # 已建：harness-port 验收（取数 + 事件）
│   ├── upgrade-harness.mjs           # P2：一条命令跑完升级
│   └── check-port-discipline.mjs     # P2：禁止绕过 port 层 import
└── docs/
    ├── FEATURES.md               # 功能总览：227 项逐项编号、来源、阶段
    ├── PLAYBOOK.md               # 剧本格式、编辑器交互、AI 生成与编辑
    ├── UI-STYLE.md               # UI 与交互风格规范（含 WorkBuddy 对标实测）
    ├── MEMORY.md                 # 记忆与进化：四层记忆、三级进化、防漂移
    ├── COMMANDS.md               # 命令 / 压缩 / 回退 / 导出（Claude 对照表）
    ├── REVIEW.md                 # 计划评审：风险与必改项
    └── UPGRADE.md                # P2：升级运行手册
```

---

## 5. 三条机制

### 5.1 契约面（已落地）

`harness-contract/contract.json` 声明 superagent 依赖的全部外部面：**44 个包/导出子路径、26 个符号、17 个 ctx 服务键、4 个事件、3 个清单字段、16 个 patch 配置键、15 个服务方法**。

✅ **Remote 已验（P0.5 spike）**，调用形状固定为：

```
POST /api/<namespace>/<method>
{ "type":"client-request", "rpcId":"…", "method":"session/list",
  "payload": { "args": { "_request": {} } } }
```

参数名是 **TS 源码里的参数名**（连 `_` 前缀都算），所以调用代码必须从 typert descriptor 生成——手写必错。这条已验证：`session/list` 返回 `ok:true`。

✅ **Remote 元数据已自动生成**（评审 R1 的解法落地）：`gen-remotes.mjs` 读各包的 `lib/typert.remote-client.js`，产出 `remotes.json` —— **39 个包 / 224 个端点**，含每个端点的 `wire` 参数名与 `scope`（上下文值如何上线，如 `agent` → `agentId`）。

**为什么不手写**：payload 的键是 TS 源码里的参数名（连 `_request` 的下划线都算）。已实测：用生成元数据调用 `session/list`、`session/modelCatalog` 全部 `ok:true`（17ms / 4ms），代码里零硬编码参数名。

✅ **事件面也已验通**（`spikes/p05-transport/events.mjs`）：连 `ws://…/api/remote.mux` → `open $events` → 收到 `ready` → 建会话立刻收到 `emit api-session/added`。

**一个会改变登录设计的发现**：订阅事件必须用 `interactions=answer` 换 Cookie；`interactions=none` 会被 `gateway/interactions-forbidden` 拒掉。→ **桌面端的凭据按 answer 申请**，`none` 只够拉数据。

⚠️ **待补**：事件名清单还没自动生成（目前只知道 `api-session/added` 等少数几个），下一步从 descriptor 的 `EventMap` 生成 `events.json`。

```sh
node scripts/verify-harness-contract.mjs --harness <harness 检出>
```

只读扫描、秒级返回、不需要安装依赖。**在 0.2.2-rc.3 上 128/128 通过**。

> 它已经抓到过两处判断错误：`ctx.slots` 的声明方其实是 `ui-renderer` 而非 `ui-slots`；`bash-sandbox` 的 `timeoutMs` 继承自 `bash-local` 的 `Config`。这类"看着对其实记错了"的假设，正是升级时最容易踩的坑。

### 5.2 port 层（P1 落地）

- 目录约定 + 一条仓库级 lint：除 `packages/harness-port/**` 外，任何文件 import `@deepseek-ai/*` 直接报错（`check-port-discipline.mjs`，可进 CI）。
- 同时禁止 `@deepseek-ai/*/src/*`（内部源码路径）——只用公开导出。

### 5.3 升级流水线（P2 落地）

```sh
pnpm run upgrade:harness -- 0.2.3        # 唯一的升级入口
```

固定顺序，任一步失败即停止并打印该改哪个 port 文件：

1. 改 `package.json` 的 `@deepseek-ai/*` 版本（单点）
2. `pnpm install`
3. `node scripts/verify-harness-contract.mjs`（契约面）
4. `pnpm typecheck`（类型面，比探针精确）
5. `pnpm test`（行为面）
6. 冒烟：起一个只装我们 bundle 的 profile，用 renderer 跑通一条 Ticket
7. 界面回归（L5，每日跑，不进 PR）
8. 写 `harness-contract/matrix.json`，提交

---

## 6. 分期计划

### 6.1 先看总量：227 项，其中 154 项要开发

完整清单（逐项编号、来源、阶段、工作量）在 **[docs/FEATURES.md](docs/FEATURES.md)**，这里只给账。

| 类别 | 项数 | 需开发 | 是什么 |
|---|---|---|---|
| **A** harness 白拿 | 73 | 0 | 宿主侧能力：会话与上下文 11、工具 18、执行与安全 12、模型接入 6、扩展 9、协作 7、平台数据 10 |
| **B** superagent 移植 | 59 | 59 | 领域核心 8、插件入口 3、会话工具 19、视图模型 7、触发源 2、提示词与技能 16、部署自检 4 |
| **C** 我们新建 | 95 | 95 | **界面 26、剧本与技能包 12、记忆与进化 7、命令与压缩 7**、兼容契约 6、安全鉴权 3、模型管理 5、测试设施 7、壳 13、发布 5、产品化 4 |
| **合计** | **227** | **154** | |

按阶段：**已完成 3 项**（含通路 spike）、**P1 = 64 项**（B 全部 59 + C1-01 + C2 3 + C4-01）、**P2 = 17 项**、**P3 = 56 项**、**P4 = 14 项**。

> 「73 项白拿」仍然是这个方案的地基：宿主能力全不用写。但**界面 25 项从白拿变成自建**——这是"不用别人 Web UI"的直接代价，也是产品差异化的落点。

### 6.2 阶段

| 阶段 | 内容 | 交付 | 验收（可验证） | 工作量 |
|---|---|---|---|---|
| **P0** | 契约面与探针 | `contract.json`、`verify-harness-contract.mjs` | 0.2.2-rc.3 上 131/131、exit 0 | 已完成 |
| **P0.5** | **通路 spike：不加载 Web UI 也能拿到数据** | `spikes/p05-transport/` | **5/5 通过**：启动→`/connect` 换 API Cookie→`POST /api/session/list` 返回 `ok:true, items:0` | ✅ 已完成 |
| **P1** | superagent 副本落地（**对齐架构**，非零改动移植）**64 项** | `packages/superagent` + `packages/harness-port` + 鉴权改造 + workspace 骨架 | 纯 npm 依赖下 `typecheck` + 单测 + `build` 绿；除 port 层外零 `@deepseek-ai/*` import；`/orchestrator` 仅有所有者 Peer 可访问（自检用例） | L |
| **P2** | 升级流水线、模型面、技能包、记忆基座、命令通道 **17 项** | `upgrade-harness.mjs`、`check-port-discipline.mjs`、`matrix.json`、`docs/UPGRADE.md`、模型库 UI、adapter 契约、测试分层 | 一次真实升级演练：从 0.2.2-rc.3 到下一个版本，全程只改 port 层；L0–L3 门禁可跑 | M |
| **P3a** | 壳 + **最小闭环界面** | 主窗口、runtime 子进程、单实例、托盘、崩溃恢复、首启向导 + 聊天流 / 工具卡片 / 审批 / 会话树 / 文件树 / 终端 / 面板 / 编辑器 | **Windows 安装包**：能登录、能对话、能跑通一次 Ticket 闭环 | L |
| **P3b** | 其余 18 项界面 | 计划/目标/子代理/团队/技能/插件页/命令面板/主题/文案… | 功能对标表 8.3 全绿 | L |
| **P3c** | 剧本编辑器打磨 | AI 生成、AI 局部重写、单步试跑、图 diff | 一句话生成一张合法流程图；选中改一处不影响布局 | M |
| **P4** | 发布与产品化 **14 项** | 签名、公证、自动更新通道、诊断包、遥测策略、评测集、本地模型预设 | 三平台安装→自更新→卸载全链路通过 | L |

P1 与 P3 可以并行（桌面壳只依赖"能启动的 profile"，不依赖 superagent 内部结构）。

---

## 7. 已知打穿点（P1 必须处理）

| # | 打穿点 | 现状 | 处置 |
|---|---|---|---|
| 1 | `@deepseek-ai/cordis` 精确钉 `4.0.5-alpha.1` | harness 已到 `4.1.0` | 改成跟随（`peer: *` 或与 harness 一致），由 harness 决定 |
| 2 | `engines.dsh: ^0.2.1-alpha.2` | master 是 `0.2.2-rc.3` | 改区间（如 `>=0.2.2-rc.3 <0.3.0`），靠探针兜底而不是靠版本号拦 |
| 3 | 原 superagent 的 client 插件（slots / `?raw` CSS / 手写 CJS banner） | 已无意义 | **整块删除**：界面自建，`dsh.client` 字段与客户端构建配置一并去掉。这里少了一整类要跟着 harness 变的契约 |
| 4 | 自建 `/orchestrator` HTTP 路由 | 需与自建界面一起重做 | 既然不再有 web 面板，管理面直接改用 `ctx.typert` + `bindTypertRemote`，让渲染进程走 Remote 契约；顺带拿到统一的 Peer 鉴权 |
| 5 | 自建 `node:sqlite` 存储 + `proper-lockfile` | 与 harness 的 session 存储并存 | 保留（零原生依赖是优点），但 `stateDir` 必须落在 `$DSH_HOME/state/<bundle>`，禁止落进 sessions 目录 |
| 6 | 启动后靠 `settings.describe()` 修配置表单 | 依赖 harness 内部行为（源码里自带 TODO） | 归入 port 层并标记为"最易碎项"，每次升级重点看 |

---

## 8. 桌面端（已定：Electron 大窗口应用）

**产品定位一句话**：用户拿到的第一个窗口，功能上不输 Claude / WorkBuddy；差异不在"能不能干活"，而在"**谁在什么时候干活**"——superagent 的理念层。

**平台范围**：**只做 Windows x64**（Windows 10 1903+ / 11）。macOS / Linux 只在 Windows 闭环跑通后再评估，本计划不为它们预留抽象层——需要时再加，不为想象中的第二平台付设计成本。

### 8.1 为什么是 Electron

| 方案 | 引擎 | Node 从哪来 | 判断 |
|---|---|---|---|
| **Electron 44**（选定） | 自带 Chromium | 壳内置，`RunAsNode` 子进程跑宿主 | ✅ 仅有的"带 Node 不用额外背成本"选项；界面自绘时一致性最好 |
| Tauri 2 | 系统 WebView | 必须自带 Node sidecar | ✗ 体积只小了壳；界面自绘时还要吃下三套 WebView 差异 |
| Wails v3 | 系统 WebView | 必须自带 Node sidecar | ✗ 生态更薄，updater 基本 DIY |
| NW.js | 自带 Chromium | 壳内置 | ✗ 相对 Electron 无优势 |
| Flutter + webview | 系统 WebView | 必须自带 Node sidecar | ✗ 界面本来就自绘，再多一门语言没收益 |
| 无壳（daemon + 浏览器） | 用户浏览器 | 随 daemon 装 | ✗ 大窗口产品形态不成立 |

三条决定性理由：

1. **Node 反正要带**。harness 宿主是 Node 程序（`engines.node >= 24.9`，且用了 `node-pty` / `koffi` / `node:sqlite`）。Tauri 的真实账是「~10MB 壳 + ~40MB 压缩后的 Node」，不是 10MB。
2. **我们预算最薄的地方，正好是 Electron 已解完的题**：自定义协议、凭证注入、子进程崩溃恢复、签名与自动更新。
3. **界面全部自绘**，Electron 一份 Chromium 就够；换成系统 WebView 等于自己给自己加三套渲染/IME/字体 QA（即使先只做 Windows，WebView2 也仍有运行时版本碎片）。

### 8.2 白拿什么、自建什么

| 能力 | 来源 |
|---|---|
| 会话 / 工作区 / 工具 / 权限模型 / 文件操作 / 终端 / 后台任务 / 子代理 / MCP / 技能 / 定时 / 计划 / 模型接入 | **harness 白拿**（宿主侧，不写一行） |
| **整个界面**：聊天流、工具卡片、审批、侧栏、文件树、终端面板、设置、插件页、剧本流程图编辑器 | **自建**（`apps/desktop` 的 renderer，25 项） |
| 主窗口壳、单实例、托盘、开机启动、自动更新、签名、首启向导、崩溃恢复、诊断包 | **自建**（P3 / P4） |
| Ticket / Policy / Executor / 剧本 / 主动触发 / 少打扰 | **superagent**（P1 起的差异化） |

> 和上一版最大的差别：**界面从"白拿"变成"自建"**。这是你要求"不用那两个项目的 Web UI"的直接代价——换来的是产品长相和剧本编辑器完全自己说了算。

### 8.3 功能对标（P3 验收口径）

| 对标项 | 我们的实现 | 状态 |
|---|---|---|
| 多会话与项目管理 | harness 会话 + 工作区 API；界面自绘 | 数据白拿 / 界面自建
| 工具调用 + 审批/权限档位 | `tools` / `permission-presets` / `user-approval` | 数据白拿 / 卡片自绘 |
| 文件编辑与差异呈现 | `tool-fs` / `deliverables` / `workspace-changes` | 数据白拿 / diff 自绘 |
| 终端与后台任务 | `terminal` / `jobs` | 数据白拿 / 面板自绘 |
| MCP 与插件市场 | `mcp` / `plugin-manager` / `plugin-market` | 数据白拿 / 页面自绘 |
| 定时与自动化 | `schedule` / `goal` | 数据白拿 / 界面自绘 |
| 子代理与团队协作 | `subagent` / `team` | 数据白拿 / 视图自绘 |
| 多语言 | harness 的 i18n **格式**可用，但界面文案要自己写 | 自建 |
| 图片输入 | `attachment` | 数据白拿 / 输入框自绘 |
| 语音输入 | `experimental/api-speech-to-text` | 待评估（experimental 不稳定，可能自己接） |
| 账号与额度 | harness `deepseek-account` / `credentials` | 需产品决策（商业化不属于 P3） |
| 云同步 / 跨设备 | 无 | **不做**（本地优先，作为差异化方向后置） |
| 桌面壳体验（更新、托盘、恢复） | 自建 | P3 |
| **剧本流程图编辑器**（呈现 + 编辑 + 编译成 skill） | 自建，见 [docs/PLAYBOOK.md](docs/PLAYBOOK.md) | **差异化核心** |
| **Superagent 面板：工作项、策略、执行状态、需要人看的东西** | superagent 视图模型 + 自绘 | **差异化核心** |

### 8.4 桌面端不做的事

1. **不复用 `apps/desktop`**：它是 `private: true` 的产品装配、随 master 变，复用等于长期追内部实现。
2. **不用 harness 的 Web UI，也不用 superagent 的 Web 面板**：那两个前端一行都不加载。
3. **不复制 `dsh-app://` 协议**：自建 `127.0.0.1` + 一次性 token 即可。
4. **不做多窗口 / 分屏**：先保证一条闭环。
5. **暂不做 macOS / Linux**：Windows 跑通闭环之后再评估。
6. **不做云同步、不做账号体系**：P3 之后单独排。

### 8.5 P3 前置核对（动手前必须先验）

1. Electron 内置 Node 版本是否满足 harness 的 `engines.node >= 24.9`（harness 打包时用 `<electron> -p process.versions.node` 记录，说明路径可行，但版本要实测）。
2. `node-pty` / `koffi` / `node:sqlite` 在 Electron ABI 下是否可用（原生模块需与内置 Node ABI 匹配）。
3. ~~无 Web UI 时宿主怎么起~~ → **已验证**（P0.5）：宿主照常起，API Cookie + `POST /api/<ns>/<method>` 可取数；渲染进程既可直接用 HTTP，也可用 `api-gateway/client`。
4. 窗口鉴权：本机 URL + token 如何在子资源与 WebSocket 上统一附加。
5. 端口策略：OS 分配端口，避免与 `3080` / `3082` 冲突。

---

## 9. 剧本（Playbook）：图给人，文本给模型

完整设计见 **[docs/PLAYBOOK.md](docs/PLAYBOOK.md)**，这里只记决策。

**决策：剧本就是 skill。** 同一张流程图两种表示：

| 表示 | 消费者 | 事实 |
|---|---|---|
| `.flow` 紧凑文本 | **模型** + git | 唯一真相源；顺序即边、条件内联、名字即 id |
| 布局 JSON（坐标/样式/视口） | 只有 UI | 派生缓存，gitignore，**永不进 prompt** |

**实测 token 差**（同一条 10 节点流程）：文本 301 字符 ≈ **109 token**；完整 UI JSON 3,342 字符 ≈ 945 token —— **8.7 倍**。

四条硬规则：

1. **文本是唯一真相源**。UI 拖节点只改布局缓存；改语义才改文本。单向数据流，图不会抖。
1b. **纯鼠标、零语法**：全流程只有五个动作（加块 / 连线 / 加条件 / 设重试 / 加人闸），用户永远看不到 `.flow`。语法是逃生门，不是主入口。
1c. **AI 生成与编辑**：一句话生成一张图；选中一块说一句就改一块，且**保留布局**。AI 产物过同一道校验，与手拖的没有区别。
2. **流程图必须完整呈现且可编辑**：加/删/连节点、改条件、设回退上限、插人闸 —— 编辑后立刻回写文本再重绘。
3. **模型只看 skill 包**：编译产物是**完整的 skill 包**（`SKILL.md` + `scripts/` + `references/` + `assets/`），不是一篇文档。四级加载：索引常驻（~20）、流程按需（~110）、引用按需（400–600）、**脚本只跑不看**（输出 40–80）。
4. **编译期校验不过就不生成 skill**：悬空跳转、不可达节点、重名、缺 `goal`、回边无上限。

**已验通（端到端）**：`.flow` → 编译 → 投放 `.dsh/skills/ticket-flow/SKILL.md` → harness `skills/list` 能看到它（`scripts/verify-skill.mjs`）。常驻 37 + 正文 48 token；带节点详情时正文 56（多 8 token 换"按需可查"）。

**GitHub 出口也通了，全闭环已闭合**：`packages/sink-github` 实现 Outbox 端口（幂等、状态可查、失败留 pending 待重试）。`npm run verify:github-loop` 用两个本地回环假服务器验通整条链：webhook（HMAC）→ 票 → 真模型回合 → 报告 → 评论回到原 issue，正文就是票的报告；重复 flush 不刷屏，状态文件里能看到 `sent`。

**触发源已接 GitHub**：`packages/source-github` 做签名校验与事件映射；本地回环投递验通（正确签名 202 / 错误签名 401，被 @ 的标为 addressed）。

**信息源做成可插拔**（不写死、用户可自定义）：`packages/source-hub` 提供注册表、通用签名（头名/算法/前缀可配）、声明式字段映射与用户自定义 `.mjs` mapper。一个宿主里同时挂 GitHub 内置适配器、一个与 GitHub 无关的声明式来源、一个用户 mapper，`ghostSources/list` / `ghostSources/ingest` 全部验通（`npm run verify:source-hub`，9 个单测）。详见 [docs/SOURCES.md](docs/SOURCES.md)。

**引擎已常驻**：`packages/orchestrator-plugin` 把 Engine 挂进宿主，注册 `ghost_ticket` 工具。真实模型自己调用它开了票（`npm run verify:ticket-tool`）。界面右栏能看到票与阶段。票已持久化（`persisting()` 快照 + 启动读回），票状态已改成 Remote（`ghostTickets/list`，网关 source-mode 发现）。两条已知限制都已清掉。

**执行器常驻且自动跑完**：开票后插件自己 `agent.followup` 到驱动会话，读会话快照事件等 `turn/end`（并有"日志静止"兜底），把最后的 assistant 文本交回 Engine，票 working → ended（`npm run verify:auto-run`）。无人值守时审批请求必须立即被拒（`DSH_PERMISSION_MODE=danger-full-access`），否则模型调用需审批的工具会停在 `approval/asked` 不再前进；桌面 UI 保留人工审批。

**配置治理**：`scripts/cordis.patch.template.yml` 是唯一真相源；`scripts/lib-driver.mjs` 每次启动前把编译产物同步进 profile 插件目录并落盘 patch，`stop()` 恢复标准版。这修掉了"改了代码不生效"（profile 里装的是 tgz 快照）和"某个验收脚本整份重写 patch 冲掉 orchestrator 与默认模型"两类顽疾。

**引擎已跑通真实闭环**（`npm run ticket`）：触发 → 准入 → 评估 → 建票 → 派活（真实模型回合）→ 报告 ready → 票 ended。这是 Engine 第一次被非测试代码驱动，执行器真的往 harness 发 prompt 并等回合结束。

**领域核心已迁入并加测试**：`packages/superagent/src/core` 15 文件、零 harness 依赖、tsc 零错误；25 个用例：收单去重 / scope 过滤 / 时间规范化 / 评估排队与交接 / **决策建票 / 派活 / 报告 / 叫停**。

顺带钉住一条容易误解的领域规则：**`ready` 报告在没有 follow 项（如 PR 未合并）时直接结束票**——面板的"待人处理"只显示还需要人动手的票。

**图模型（`toGraph`/`fromGraph`）已完成**：`order` 是语义顺序、`x/y` 只是缓存——往返后 `renderBody` 完全一致（有测试守着）。这条是编辑器"拖不坏语义"的保证。

**连带影响（很重要）**：superagent 现有 14 个提示词文件要重新归属——角色/语气留下当 persona，**流程步骤改写成 `.flow` 剧本**。常驻系统提示从数千 token 降到数百，这本身就是省 token 的主要来源。

---

## 10. 记忆与进化

完整设计见 **[docs/MEMORY.md](docs/MEMORY.md)**，这里只记决策。

**决策：记忆是文件，不是数据库；常驻的必须极小；写入有门槛；人永远能看见和删掉。**

四层：

| 层 | 存什么 | 存哪 | 谁写 | 何时进上下文 |
|---|---|---|---|---|
| L0 工作记忆 | 当前上下文 | harness 会话 | 自动压缩 | 始终 |
| L1 会话记忆 | 一次任务的过程与结论 | harness session | 自动 | 恢复时 |
| L2 项目记忆 | 约定、构建命令、踩过的坑 | 仓库 `GHOST.md` + `.ghost/memory/*.md` | 模型提议 → 人确认 → git | 索引常驻，条目按需 |
| L3 用户记忆 | 偏好、习惯、禁忌 | `%APPDATA%/ghost/user-memory.md` | 模型自动写（有门槛） | 常驻 ≤ 2KB |
| L4 团队记忆 | 共享约定、剧本库 | 仓库 `playbooks/`、`docs/` | 人（PR） | 按需 |

**对标实证**：WorkBuddy 的用户记忆是 `~/.workbuddy/memory/<uid>_memory.md`——17 行 / **254 字节**，结构是 `# User Memory Profile` + `## Memory Block`，带 `.bak`。这个小到能整段常驻的块，就是我们的规模基准。

三条我们照抄的成熟经验：分层文件记忆（Claude Code 的 `CLAUDE.md` 层级）、默认可见可编辑可关（Claude 产品）、单文件小常驻块 + 备份（WorkBuddy）。

**进化三级，每级都有人闸**：记忆进化（同错 3 次 → 升为约束）／剧本进化（返工归因到节点 → 改 `.flow`，走 diff + git）／技能进化（脚本连跑通 2 次 → 沉淀进 `scripts/`）。三条防漂移：禁止运行时静默改写自己的提示词、无度量不合并、可回滚。

**已实现（`packages/memory`，10 个测试）**：`indexed`（项目：索引常驻 + `entries/` 按需）与 `block`（用户：单文件常驻块，硬预算）两种形态；写入闸门拒"缺来源/一次性措辞/非法名"；覆盖前留 `.bak`，写入原子。超预算**明确拒绝并提示归档**，不静默截断。

**插件已装进真实 harness**：`npm pack` → 装进 profile → `cordis.patch.yml` 插一行 → 启动，自检文件确认三个工具就位，且**用 `ctx.tools.get()` 从运行中的服务查回**（`present: true` 三条）。**真模型也验通了**（`npm run verify:real-model`，11.3s）：接 `http://127.0.0.1:7864/v1` 的 hy3，模型自主决定调用 `memory_write`，写入 `entries/package-manager-pnpm.md`，内容与 source 都正确。

**假模型端点也验过**（`npm run verify:tool-visibility`）：用假 Messages 端点跑一轮，捕获到的请求里 `tools` 共 34 个、含我们的三个；端点回 `tool_use: memory_list`，工具在宿主执行后以 `tool_result` 回到第三轮请求。不需要任何 key。这是本仓库代码第一次真正跑在 harness 进程里。

工具层（`memory_list` / `memory_read` / `memory_write`）已定义并可执行：描述即说明书（每条 ≤120 字符）、只回人话、写入被拒时把原因原样返回让模型自愈。**尚未挂进 `agent.ctx.tools.register`**——那一步需要把 harness 依赖装到仓库根。

---

## 11. 命令与上下文管理（对齐 Claude）

完整对照表见 **[docs/COMMANDS.md](docs/COMMANDS.md)**。

**决策：命令、压缩、回退、导出——能力全用 harness 的，入口全自己写。**

- `@deepseek-ai/dsh-commands` 已把斜杠命令暴露成 Remote（`commands/list` + `commands/execute`），且**执行不产生模型消息**、`command/run`→`command/done` 有日志可审计。**人闸（ask_user_question）**：UI 已能渲染待答横幅并调用 `userQuestions/answer`（参数 `agentId/callId/answer`）；`answer` 的具体形状还没用真实提问验证过——模型在非交互回合里没触发该工具，这条留待有真实提问时补齐。

**已验通（`npm run verify:commands`）**：会话里能列出 6 条命令（compact / export / feedback / goal / permission / plan），`/compact` 执行返回 `success`。剩下只有命令面板。
- 压缩三层全是白拿：工具结果裁剪（`compaction-tool-result-pruner`）、自动压缩（`compaction-basic`）、图片离位（`compaction-image-offload`）；手动 `/compact` 走 `dsh-command-compact`。
- 会话操作白拿：`session/create`、`session/list`、`session/page`、`session/selectModel`、`session/projections`、`session/fork`、`session/cancel`。
- **我们要补的 7 项**：命令面板、命令通道、压缩策略配置、上下文占用条（含压缩点标记，可展开看被压掉的原文）、checkpoint/rewind UI、会话导出、`/init` 等价的 `GHOST.md` 草案生成。

> 差异在"看得见"：harness 有压缩，我们有**压缩可视化**——否则用户不敢让它长跑。

---

## 12. 模型层：任何模型都能接

**结论先说：这件事 harness 已经解决了 80%，我们做的是产品面 + 一个对外契约。**

### 9.1 harness 白给的部分（核实过）

| 设施 | 事实 |
|---|---|
| 适配器抽象 | `LlmAdapter` 公开抽象类 + `ctx.llm.registerAdapter(providers, adapter)`，一个实例可拥有多条 provider 路由 |
| 通用适配器 | `@deepseek-ai/dsh-llm-pi-ai` 一条插件覆盖 4 种线协议：`openai-completions` / `openai-responses` / `anthropic-messages` / `google-generative-ai` |
| 路由两种写法 | **catalog route**（pi-ai 已知供应商，只给 `apiKeyEnv`）与**手写 route**（`baseURL` + `api` + `models[]`，含 `contextWindow` / `maxTokens` / `reasoningEfforts` / `compat.thinkingFormat`） |
| 热更新 | provider 事实按请求解析（settings 段 + 凭据 seam），改 key / 端点 / 模型**不需要重启**；只有路由集合变了才原地重注册 |
| 其它 | `llm-deepseek*` 专供 DeepSeek；`token-meter` 计费、`llm-retry` 重试策略 |

**含义**：接 Ollama、vLLM、任何 OpenAI 兼容网关、Anthropic、Gemini，全部是**配置**，不是写代码。

### 9.2 我们要建的三层

1. **模型管理面（产品化）**：provider 增删、能力标注（上下文 / 输出上限 / reasoning 档位）、连通性自测、每角色默认模型（superagent 已有 router/worker 的 role-models，接上即可）。
2. **凭据策略**：本机加密存储 + 按 provider 隔离 + 可选团队共享；绝不明文进 settings。
3. **对外 adapter 契约（用户自写插件）**：在 `harness-port` 之上再收一层，导出稳定的 `ModelAdapter` 契约 + 脚手架 + 示例。理由：harness 的 `LlmAdapter` 是 pre-stable，**不能让用户插件直接依赖它**，否则一次 harness 升级就把第三方插件全打翻。

> 用户写一个自定义后端（自有推理服务、公司内网网关、本地小模型）= 实现我们这层 3 个方法的接口，不碰 harness。

### 9.3 明确不做

- 不自己实现一套 provider 协议栈（harness 已有 4 种）。
- 不做模型聚合/负载均衡（先单路由；需要时作为策略层后置）。
- 不把模型能力探测做成自动爬取（能力由路由声明，用户可覆盖）。

---

## 13. 测试分层与真模型从哪来

**先纠正我上一版的结论**：上一版把"WorkBuddy 桌面 App 没有 API"直接推成"没有真模型可用"，这是我搞错了层次。两件事要分开看：

- **桌面 App**：确实没有公开 API（本机端口实测 + 官方文档确认）。这条不变。
- **CodeBuddy 账号能力**：可以被第三方反代（`workbuddy2api`）转成标准 OpenAI / Anthropic 兼容接口。所以**开发期是有真模型可用的**，只是走第三方通道，不是官方契约。

### 10.1 四层测试（照抄 harness 自己的分法）

harness 本身就是这么分的：`test`（单测）/ `test:expected` / `test:snapshot`（keyless 回放）/ `test:e2e`（真 API，没有 key 自动 skip）。我们照抄，升级时才不打架。

| 层 | 测什么 | 要真模型吗 | 门禁 |
|---|---|---|---|
| **L0** 纯逻辑 | Policy 判定、Ticket 状态机、Prompt 组装、权限规则 | 否 | 每次 PR |
| **L1** 适配与事件流 | harness 适配层、工具调用序列、流式分片、重试与截断 | 否（`llm-mock-server` 确定性故障注入） | 每次 PR |
| **L2** 会话回放 | 真 agent + 真工具 + 真 prompt，模型响应固定（`llm-replay`） | 否（录制时用过） | 每次 PR |
| **L3** 真模型冒烟 | 5–10 条端到端：开 Ticket → 改文件 → 出结果 | **是** | 每日 / 发版前 |
| **L4** 评测集 | 任务集 + 评分：完成率 / 越权率 / 噪音率 | **是** | 手动 / 夜间 |
| **L5** 界面 | Playwright 驱动 Electron：关键路径 + 截图基线（自建界面后必需） | 否 | 每日 |

**最重要的原则**：L3/L4 只断言**结构**——工具调用发生了没有、文件改了没有、状态迁移对不对、答复里有没有链接；**绝不断言文本**。否则模型一升级，测试全红，最后就没人看测试了。这也正是 L2 能承担回归主力的原因：它跑的是真实的 agent 与工具，只有模型那一段是固定的。

### 10.2 真模型的三个来源（并存，各有用途）

**① `workbuddy-manager`（CodeBuddy 账号池 → OpenAI / Anthropic 兼容反代）— 开发自测主力**

它对外就是标准接口，正好是 `llm-pi-ai` 手写 route 的形状：

```yaml
providers:
  wb:
    displayName: WorkBuddy Gateway
    api: openai-completions          # 或 anthropic-messages
    baseURL: http://127.0.0.1:7864/v1
    apiKeyEnv: WB_GATEWAY_KEY
    models:                          # 从它的「模型中心」抄：上下文 / 最大输出 / 思考档位
      - id: <模型 id>
        contextWindow: <n>
        maxTokens: <n>
```

除"能出 token"之外，它额外给我们三样别处没有的东西：

1. **`/v1/messages`（Anthropic 协议）** → 可以把 Claude Code / cc-switch 指到同一个网关。**同一模型、同一任务、不同 agent** 做横向对比，这对"对标 Claude / WorkBuddy"极有价值。
2. **轨迹抓包（客户端视角 / 网关视角 / 与上一轮 diff）** → 直接看我们发出去的 system prompt、工具 schema、参数钳制。harness 集成的头号 bug 就是"SaaS 工具 schema 太大 / prompt 段重复"，这个功能是现成的显微镜。
3. **多密钥 + IP/模型白名单 + 用量日志** → 不同测试批次隔离配额，CI 侧也能看清谁花了多少。

**边界（写死，不能松）**：

- 只用于**本人/团队自持账号的内网开发自测**；**产品后端绝不用它**；商业 CI 不依赖它。
- 它依赖第三方反代 + 平台客户端/网页协议，**平台一改版就断**（它自带"页面监控"正是为此）；有封号风险，用独立账号。
- 能力边界：仅对话 / Responses / Messages，**不支持生图**；工具调用的完整度取决于上游。
- 合规：它自己的声明限定"本人及亲属自愿授权账号"，禁止转售与盈利性用途。我们只在自己的开发机上按这个边界用。

**② BYOK（官方 key）** — DeepSeek / OpenAI / Anthropic / Gemini。发版前冒烟与对外演示用它，最稳、可写进合同。
**③ 本地模型（Ollama / vLLM）** — 无网、无成本、无合规问题。CI 可选的 L3 降级档。

### 10.3 门禁矩阵

| 时机 | 跑什么 | 需要 key |
|---|---|---|
| 每次 PR | 契约探针 + L0 + L1 + L2 | 零 |
| 每日 | L3 冒烟（manager 或本地模型） | 需要（非产品依赖） |
| 发版前 | L3 冒烟（官方 key）+ L4 抽样 | 需要 |
| harness 升级 | 契约探针 + L0/L1/L2 + L3 冒烟（跨版本行为对比） | 需要 |

### 10.4 WorkBuddy 的第二个用途（不冲突）

WorkBuddy 本身是 MCP 客户端。把 superagent 的操作面（开 Ticket、查状态、读面板）暴露成 **MCP server**，就能让一个真实 Agent 端到端驱动我们——这是"别人家的 Agent 能不能用我们的能力"的唯一实证方式。与 §13.2 的模型通道互相独立，可并行。

> 一句话：**模型用谁的通道都行（开发期可以借），产品后端必须是可写进合同的官方 key；而测试的主力永远是零 key 的回放，不是真模型。**

---

## 14. 红线

1. **不改 harness 源码**，也不 fork（fork 即失效）。
2. **不依赖 `private: true` 的包**（`apps/desktop`、`packages/test-support/*` 等）。
3. **不 import `@deepseek-ai/*/src/*`**，只用清单里声明的公开导出。
4. **不在 harness 里加兼容 shim**——所有兼容代码只活在 `packages/harness-port`。
5. **不为了兼容旧 harness 写分支**：只跟最新，旧版本直接不支持。

---

## 15. 风险

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| harness pre-stable，升级打断 API | 高 | 中 | 契约探针 + port 单点 + 升级流水线；每次升级工作量预计 ≤ 一天（除重大重构） |
| 手写路由绕过鉴权 | 中 | **高（安全）** | 第 7 节第 5 项：迁 Typert Remote 或补自检 |
| 客户端 bundle 契约（manifestVersion）变更 | 中 | 高（面板白屏） | 纳入契约清单 + 冒烟渲染检查 |
| 桌面端签名/公证/更新链条 | 高 | 高（发不出去） | P4 单独排期，Windows 与 macOS 分别验证 |
| 原型代码质量（研究代码，测试分层弱） | 高 | 中 | P1 只做"能跑"，P2 起补关键路径测试，不追求全覆盖 |

---

## 16. 已定与待定

**已定**

1. harness 只升级不修改；cordis 版由 harness 决定。
2. 只跟最新 harness，不维护多版本矩阵。
3. superagent 搬进本仓库单独一份，**第一版即对齐架构**（不做零改动过渡）。
4. 桌面端 = **Electron 大窗口应用**，功能面对标 Claude / WorkBuddy，superagent 理念为差异化核心。
5. 不复用 `apps/desktop`，自建壳。
6. 鉴权（`/orchestrator` 路由绕过 `remoteAccess`）与 P1 同批做。**已固化四条边界测试**：无 Cookie 401、伪造 Cookie 401、非本机 Host 403、`interactions=none` 不能订阅事件（`npm run verify:auth`）。
7. P3 MVP 档位 = 多会话 / 工具+审批 / 文件 / 终端+后台 / MCP / 多语言 / 更新。
8. 模型层：任意模型可换 + 用户可自写适配插件（第 12 节）。
9. **界面全部自建**，不加载 harness 的 Web UI，也不用 superagent 原面板（第 3、8 节）。
10. **只做 Windows x64**，其他平台等闭环后再议。
11. **剧本 = skill**：`.flow` 文本为唯一真相源，布局 JSON 只给 UI（第 9 节）。
12. **剧本编辑器纯鼠标即可完成**，不要求用户记任何语法；同时支持用 AI 生成与编辑（第 9 节）。
12b. **剧本编译成完整 skill 包**，脚本优先（确定性步骤进 `scripts/`，模型只读输出），四级渐进披露（第 9 节）。
12c. **记忆四层、进化三级**，全部文件化、可 diff、可回滚，写入有门槛，人可见可删（第 10 节）。
13. UI 与交互遵循 [docs/UI-STYLE.md](docs/UI-STYLE.md)；计划评审结论见 [docs/REVIEW.md](docs/REVIEW.md)。
14. Claude 那套常用命令、上下文压缩、回退、导出必须有（第 11 节）。

**待定**

1. **界面 MVP 切到哪几项**：25 项全做太重。建议 P3 先做 8 项——聊天流、工具卡片、审批、会话树、文件树、终端、Superagent 面板、剧本编辑器；其余补在 P3.5。要按这个切吗？
2. **模型密钥谁出**：用户自带（BYOK）还是我们托管额度？这决定 P4 的商业模式，也决定凭据存储要不要做服务端。
3. **对外 adapter 契约是否独立成包**（如 `packages/model-adapter-kit`）：独立成包利于第三方写插件，但多一条要长期维护的公开 API。
4. **MCP server 面现在做还是 P3 做**：做了能立刻用 WorkBuddy 当测试对手方，但会多一个对外接口要守。
5. **账号体系**：用 harness 的 `deepseek-account`，还是完全 BYOK 不建账号（更轻，但没有订阅形态）。
6. **真模型测试配额**：日常 L3 用自持 CodeBuddy 账号（`workbuddy-manager`）跑，还是买官方 key 预算？建议「日常用前者、发版前必须有后者」，但预算要定。
