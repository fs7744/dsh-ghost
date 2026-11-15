# 功能总览

> 配套 [PLAN.md](../PLAN.md)。这里回答一个问题：**总共要做多少东西，各是什么，谁负责，什么阶段做。**
>
> 计数口径：「一项」= 一个用户可感知的能力，或一个必须交付的工程件。粒度有意碾平——不是为了精确，是为了不漏项。

## 0.1 进度快照（2026-11-15）

**已完成 38 项 / 227**（含 C2-02、C2-03 基础版、C10-03、C11-01/02/05/06 与 C8-01/02/05 基础版）：B1-01～08（领域核心 + 25 个用例）、C1-01（transport）、C1-02（契约 + 224 端点生成）、C1-03（探针）、C1-06（通路 spike）、C9-01（解析器）、C9-02（编译器 + 节点详情）、C9-03（流程图渲染基础版）、C9-04（图编辑器 MVP）、C9-09（包结构编译）、C10-01（记忆存储）、C10-02（记忆工具，真模型验通）、C10-03（记忆界面）、C10-04（写入门槛）、C11-01（命令面板基础版）、C11-05（Checkpoint / rewind）、C11-06（会话导出）、C8-01（聊天流）、C8-02（工具卡片）、C8-05（会话树）。

**本轮新增的工程件**（不单列进 227 项账本，但都有可跑的验收）：自动执行器（`verify:auto-run`）、可插拔信息源 `source-hub`（`verify:source-hub`，见 [SOURCES.md](SOURCES.md)）、GitHub 全闭环（`verify:github-loop`）、配置治理（patch 模板 + 启动同步）。

**下一批（按依赖顺序）**：C8 界面其余项 → C11-03 压缩策略配置与 C11-04 压缩点标记 → C10-05 记忆进化 → P3c 剧本编辑器打磨（拖拽 / 撤销 / AI 局部重写 / 图 diff）。
其余（B2–B7 的宿主装配、C3 模型管理、C5 壳、C6 发布）依赖前三批，不宜提前。

## 0. 总量

| 类别 | 项数 | 需开发 | 含义 |
|---|---|---|---|
| **A** harness 白拿 | 73 | 0 | 升级 harness 就有，我们只写配置（宿主侧能力） |
| **B** superagent 移植 | 59 | 59（改造后） | 已有实现，搬进来按新架构重组 |
| **C** 我们新建 | 95 | 95 | 界面、剧本与技能包、记忆与进化、命令与压缩、壳、兼容层、模型面、发布链 |
| **合计** | **227** | **154** | |

按阶段分布（合计 100）：

| 阶段 | 项数 | 内容 |
|---|---|---|
| 已完成 | 3 | C1-02 契约清单、C1-03 契约探针、**C1-06 通路 spike（5/5 通过）** |
| P1 | 64 | B 全部 59 + C1-01 + C2 3 + C4-01 |
| P2 | 17 | C1-04/05 + C3-01～04 + C4-02/03/04/06 + C9-01/02/09 + C10-01/02 + C11-02/03 |
| P3 | 56 | **C8 界面 26** + C9-03～08/10～12（9）+ C10-03～06（4）+ **C11-01/04～07（5）** + C4-07 + C5 11 |
| P4 | 14 | C3-05 + C4-05 + C5-08/10 + C6 5 + C7 4 + C10-07 |

**不在范围**（明确不做）：云同步 / 跨设备、图像生成、账号订阅体系、模型聚合与负载均衡、移动端。

---

## A. harness 白拿（73 项，0 开发）

### A1 会话与上下文（11）

| ID | 能力 | 实现包 |
|---|---|---|
| A1-01 | 会话生命周期（建/恢复/重命名/归档） | `core/session` `core/agent` |
| A1-02 | 会话持久化（JSONL + 单写者锁 + 版本迁移） | `session/session-persistence-jsonl` |
| A1-03 | 会话检索 / 导出 | `session-query/session-query-sqlite` |
| A1-04 | 会话投影与缓存 | `session/session-projection` |
| A1-05 | 检查点与回滚策略 | `session/session-checkpoint-policy` |
| A1-06 | 上下文压缩（基础 + 工具结果裁剪 + 图片离位） | `compaction/*` |
| A1-07 | 会话标题自动生成 | `session/session-title*` |
| A1-08 | Agent 指令注入（AGENTS.md 等） | `context/agent-instructions` |
| A1-09 | 时间上下文 | `context/time-context` |
| A1-10 | 文件 / 会话引用 | `context/file-reference` `session-reference` |
| A1-11 | 交付物与文档处理（Office / PDF） | `deliverables/*` `document` `office-kit` |

### A2 模型可见的工具（18）

| ID | 工具 | 包 |
|---|---|---|
| A2-01 | bash（前台/持久） | `tool-bash` `tool-bash-persistent` |
| A2-02 | pwsh（前台/持久） | `tool-pwsh` `tool-pwsh-persistent` |
| A2-03 | 文件读 / 写 / 改 | `tool-fs` |
| A2-04 | glob / grep 搜索 | `tool-fs-search` |
| A2-05 | 精确替换编辑 | `tool-str-replace-editor` |
| A2-06 | 网页搜索 / 抓取 | `tool-web` `web-*` |
| A2-07 | 待办清单 | `tool-todo` |
| A2-08 | 技能调用 | `tool-skill` |
| A2-09 | 后台任务管理 | `tool-jobs` |
| A2-10 | 子代理派生 / 控制 | `tool-subagent` `tool-subagent-control` |
| A2-11 | 工作流执行 | `tool-workflow` `workflow-ptc` |
| A2-12 | 向人提问 | `tool-ask-user` |
| A2-13 | 呈现结果 | `tool-present` |
| A2-14 | 目标管理 | `tool-goal` `goal` |
| A2-15 | 定时跟进 | `tool-schedule` `schedule` |
| A2-16 | Office 文档操作 | `tool-office` `skill-office` |
| A2-17 | 代码智能（LSP） | `tool-lsp` `lsp*` |
| A2-18 | 工作目录 / 依赖管理 | `tool-working-directory` `tool-workspace-dependencies` |

### A3 执行环境与安全（12）

| ID | 能力 | 包 |
|---|---|---|
| A3-01 | 命令执行抽象与本地实现 | `shell/*` `bash-local` `pwsh-local` |
| A3-02 | 沙箱策略 | `sandbox/sandbox-policy` |
| A3-03 | 进程隔离（Landlock / Windows ACL） | `sandbox-local` `sandbox-windows-acl` |
| A3-04 | 文件系统沙箱 | `fs/fs-sandbox` |
| A3-05 | 持久终端（node-pty / ConPTY） | `terminal/*` |
| A3-06 | 子进程管理 | `subprocess/*` |
| A3-07 | SSH 远程执行（fs / sandbox / subprocess） | `ssh/*` |
| A3-08 | PTC 运行时代码执行 | `ptc-runtime/*` |
| A3-09 | 浏览器控制 | `browser-use/*` |
| A3-10 | 桌面控制 | `computer-use/*` |
| A3-11 | 权限预设与审批 | `permission-presets` `user-approval` `authorization` |
| A3-12 | 循环/工具守卫 | `guard/*` |

### A4 模型接入（6）

| ID | 能力 | 包 |
|---|---|---|
| A4-01 | LLM 运行时与适配器契约 | `llm/llm` |
| A4-02 | DeepSeek 官方（API key / 账号） | `llm-deepseek*` |
| A4-03 | 通用多协议适配器（4 协议） | `llm-pi-ai` |
| A4-04 | 重试与退避策略 | `llm-retry` |
| A4-05 | Token 计量与计费 | `token-meter` |
| A4-06 | 模型选择界面 | `client/ui-model-selection` |

### A5 扩展能力（9）

| ID | 能力 | 包 |
|---|---|---|
| A5-01 | MCP 客户端与资源 | `mcp/*` |
| A5-02 | 技能加载（文件系统） | `skill/*` |
| A5-03 | 插件管理器 | `plugin-manager` |
| A5-04 | 插件市场 | `plugin-market` |
| A5-05 | 插件清单与探测 | `plugin-package-inventory-deepseek` `host-plugin-inventory` |
| A5-06 | 外部 Hook 协议（Claude Code / Codex） | `hooks-*` `hook-protocol` |
| A5-07 | Webhook（含 GitHub） | `webhook` `webhook-github` |
| A5-08 | 动作卡片 | `action-cards` `client-ui-action-cards` |
| A5-09 | 推荐（插件/创建） | `plugin-recommendations` `creation-recommendations` |

### A6 协作与自动化（7）

| ID | 能力 | 包 |
|---|---|---|
| A6-01 | 子代理（spawn / fork / acp / claude-code / codex） | `subagent/*` |
| A6-02 | Agent 团队与共享任务 | `team/*` `tool-agent-team` |
| A6-03 | 目标循环 | `goal` `goal-round-driver` |
| A6-04 | 计划模式 | `plan-mode` `client-ui-plan` |
| A6-05 | 待办系统 | `todo/tool-todo` |
| A6-06 | 定时任务 | `schedule/*` |
| A6-07 | 工作流引擎 | `workflow/*` |

### A7 界面能力（0，已整体移出）

原计划白拿 harness 的 25 项界面能力（`packages/client/ui-*` 共 62 个包）。**改为自建界面后，这一组整体移出 A 类**，现记在 §C8。harness 的组件只作参考实现阅读，不加载、不 import、不随版本绑定。

### A8 平台与数据（10）

| ID | 能力 | 包 |
|---|---|---|
| A8-01 | Web 宿主与静态前端 | `host/webserver` `host-frontend-static` `client/web` |
| A8-02 | API 网关（Typert Remote） | `api/*` `typert/*` |
| A8-03 | 认证（Token / Desktop / Account） | `host/authentication-*` `deepseek-account` |
| A8-04 | 远程访问角色策略 | `api/remote-access` |
| A8-05 | 非会话存储 | `storage/*` |
| A8-06 | 凭据管理 | `credentials/*` |
| A8-07 | 用户设置 | `settings/settings` `config-editor` |
| A8-08 | 附件存储 | `attachment/*` |
| A8-09 | 遥测（OTel） | `telemetry/*` `*otel*` |
| A8-10 | 崩溃与诊断 | `feedback/*` `desktop/crash-report` |

---

## B. superagent 移植（59 项，全部需改造）

### B1 领域核心（8）— **已迁入并覆盖主链路（15 文件，tsc 零错误；25 个用例：状态机 10 + 决策/派活/报告/叫停 15）**

| ID | 功能 | 源文件 | 阶段 |
|---|---|---|---|
| B1-01 | Ticket 状态机（开/派/执行/答复/关闭） | `core/tickets.ts` `stage.ts` | P1 |
| B1-02 | Policy 授权评估（谁能要求工作） | `core/engine.ts` `reasons.ts` | P1 |
| B1-03 | Admission 准入（抓上下文 + 判定是否值得做） | `src/admission.ts` | P1 |
| B1-04 | Assignment / Handoff（主会话 ↔ 执行器交接） | `core/assignments.ts` | P1 |
| B1-05 | Reply（答复生成与投递） | `core/replies.ts` | P1 |
| B1-06 | Thread Memory（线程级记忆） | `core/memory.ts` | P1 |
| B1-07 | Eval（自评与决策） | `core/evals.ts` | P1 |
| B1-08 | Store 与 schema 迁移 | `app/store*.ts` `app/migration.ts` | P1 |

### B2 插件入口（3）

| ID | 功能 | 说明 | 阶段 |
|---|---|---|---|
| B2-01 | 宿主插件 `dsh-superagent` | 主入口，inject 11 个服务 | P1 |
| B2-02 | `dsh-superagent/github-watch` | GitHub 触发源 | P1 |
| B2-03 | `dsh-superagent/feishu-watch` | 飞书触发源（默认关闭） | P1 |

### B3 会话工具（19）

`orchestrator_ack` / `_thread_unrelated` / `_thread_follow` / `_trigger_handback` / `_report` / `_route` / `_ticket_retry` / `_ticket_request_status` / `_ticket_note` / `_trigger_requeue` / `_eval` / `_eval_read` / `_eval_decide` / `_reply` / `_thread_unsubscribe` / `_settings_save` / `_policy_sync` / `_prompts_save` / `_read` —— 19 个 P1 工具。

### B4 面板视图（7）

| ID | 视图 | 内容 | 阶段 |
|---|---|---|---|
| B4-01 | Overview | 需要人处理的事 | P1 |
| B4-02 | Tickets | 工作项列表与详情 | P1 |
| B4-03 | Records | 执行记录 | P1 |
| B4-04 | Threads | 线程与订阅 | P1 |
| B4-05 | Sources | 触发源配置 | P1 |
| B4-06 | Settings | 策略 / 执行器 / 提示词 | P1 |
| B4-07 | 部署配置页（插件行内） | 机器设置 + 账号 | P1 |

### B5 触发源（2）

| ID | 触发源 | 内容 | 阶段 |
|---|---|---|---|
| B5-01 | GitHub | 评论 / issue 监听、@ 提及、权限校验、PR 交付 | P1 |
| B5-02 | 飞书 | bot 提及、群成员同步（默认关闭） | P1 |

### B6 提示词与技能（16 个文件，按 6 组交付）

| ID | 类别 | 明细 | 阶段 |
|---|---|---|---|
| B6-01 | 主会话提示词 | `orchestrator.md` `shared.md` `subscriptions.md` | P1 |
| B6-02 | 派遣与交接 | `dispatch.md` `handoff.md` `handoff-orchestrator.md` `handoff-worker.md` | P1 |
| B6-03 | 执行器提示词 | `worker.md` `work.md` `cli.md` | P1 |
| B6-04 | 准入与答复 | `admission.md` `replies.md` | P1 |
| B6-05 | 团队约束段 | `team/communication.md` `team/delivery.md` `team/scope.md` | P1 |
| B6-06 | 技能 | `dsh-superagent-github` `dsh-superagent-feishu` | P1 |

### B7 部署与自检（4）

| ID | 功能 | 说明 | 阶段 |
|---|---|---|---|
| B7-01 | `scripts/dsh-superagent` 服务脚本 | 起停/状态 | P1 |
| B7-02 | 自检与 `status` 退出码 | 配置完整性 | P1 |
| B7-03 | SETUP 引导流程 | 12 步问答 → 计划 → 执行 | P1（先保留 CLI 形态） |
| B7-04 | 小时级看护（挂了自动拉起） | 定时体检 | P2 |

---

## C. 我们新建（95 项，全部需开发）

### C1 兼容与契约（6）

| ID | 交付件 | 阶段 |
|---|---|---|
| C1-01 | `packages/harness-port`：**transport（调用 + 事件）已验收**，其余 3 个文件待补 | P1（进行中） |
| C1-02 | `contract.json`（131 项检查）+ **`gen-remotes.mjs` → `remotes.json`（39 包 / 224 端点）** | ✅ 已完成 |
| C1-03 | 契约探针 `verify-harness-contract.mjs` | ✅ 已完成 |
| C1-04 | `upgrade-harness.mjs` 升级流水线 | P2 |
| C1-05 | import 纪律检查（禁止绕过 port） | P2 |
| C1-06 | **通路 spike**：不加载 `ui-*` 也能取数（`session/list`/`session/modelCatalog`）**且能订阅事件**（`$events` → `api-session/added`） | ✅ 已完成 |

### C2 安全与鉴权（3）

| ID | 交付件 | 阶段 |
|---|---|---|
| C2-01 | `/orchestrator` 迁 Typert Remote（**依赖 app 迁入，未开始**） | P1 |
| C2-02 | 非授权调用被拒的自检（**4 条已固化**：无 Cookie 401 / 伪造 Cookie 401 / 非本机 Host 403 / `interactions=none` 不能订阅事件）；Peer 角色级隔离待 app 迁入 | P1 |
| C2-03 | 凭据安全（**密钥扫描已进脚本**，92 个受控文件零命中；加密存储待桌面壳 `safeStorage`/DPAPI） | P1 |

### C3 模型管理（5）

| ID | 交付件 | 阶段 |
|---|---|---|
| C3-01 | 模型库 UI（provider/模型/能力标注） | P2 |
| C3-02 | 连通性自测 | P2 |
| C3-03 | 角色路由（router / worker 各用哪个模型） | P2 |
| C3-04 | 对外 `ModelAdapter` 契约 + 脚手架 + 示例 | P2 |
| C3-05 | 本地模型预设（Ollama / vLLM） | P4 |

### C4 测试设施（7）

| ID | 交付件 | 阶段 |
|---|---|---|
| C4-01 | L0 单测骨架（Policy / 状态机 / Prompt 组装） | P1 |
| C4-02 | L1 mock-server 场景库 | P2 |
| C4-03 | L2 snapshot 基线与回放 | P2 |
| C4-04 | L3 真模型冒烟脚本（结构断言） | P2 |
| C4-05 | L4 评测集与评分 | P4 |
| C4-06 | 门禁矩阵接入 CI | P2 |
| C4-07 | **L5 界面层**：Playwright + Electron 关键路径 + 截图基线 | P3 |

### C5 桌面壳（13）

| ID | 交付件 | 阶段 |
|---|---|---|
| C5-01 | 主窗口（加载本机 Web UI） | P3 |
| C5-02 | runtime 子进程管理（起停/健康/退出） | P3 |
| C5-03 | 单实例与深链唤醒 | P3 |
| C5-04 | 托盘与通知 | P3 |
| C5-05 | 开机启动 | P3 |
| C5-06 | 文件拖入与「用本产品打开」 | P3 |
| C5-07 | 原生菜单与快捷键 | P3 |
| C5-08 | 自动更新 | P4 |
| C5-09 | 崩溃恢复（宿主重启 + 状态锁） | P3 |
| C5-10 | 诊断包导出 | P4 |
| C5-11 | 首启向导（把 SETUP 问答变 GUI） | P3 |
| C5-12 | 界面多语言（跟随 harness 8 语） | P3 |
| C5-13 | 安全存储（Electron `safeStorage`，Windows 下即 DPAPI） | P3 |

### C6 发布（5）

Windows NSIS / macOS dmg + 公证 / Linux AppImage / 更新通道与灰度 / 发布流水线与版本核对 —— P4。

### C7 产品化（4）

遥测与隐私策略、第三方许可与声明页、文档站、崩溃上报与反馈入口 —— P4。

### C8 自建界面（26）

不用 harness 的 Web UI、也不用 superagent 原来的面板；数据走 `ctx.remote`（Typert Remote 契约），界面全部自己画。全部 P3。

| ID | 界面 | ID | 界面 |
|---|---|---|---|
| C8-01 | 聊天与消息流（**已跑**：session/page → 气泡；发送 → session/prompt） | C8-14 | 团队视图 |
| C8-02 | 工具调用卡片（**已跑**：call/result 按 callId 配对、参数解析、结果取 message.content） | C8-15 | 技能面板 |
| C8-03 | 审批弹窗 | C8-16 | 设置（模型/外壳/子代理/搜索/日志/插件） |
| C8-04 | 向人提问交互 | C8-17 | 插件管理与市场 |
| C8-05 | 侧边栏会话树 | C8-18 | 命令面板 |
| C8-06 | 工作区与文件树 | C8-19 | 快捷键 |
| C8-07 | 终端面板 | C8-20 | 主题（亮/暗） |
| C8-08 | 后台任务面板 | C8-21 | 多语言（先中/英） |
| C8-09 | 交付物预览 | C8-22 | 附件上传与目录选择 |
| C8-10 | 文档预览 | C8-23 | 消息反馈与会话统计 |
| C8-11 | 计划视图 | C8-24 | 右键菜单与文件拖拽 |
| C8-12 | 目标视图 | C8-25 | **Superagent 面板**（工作项/策略/执行状态/待人处理） |
| C8-13 | 子代理视图 | C8-26 | 文案与 i18n 词表（中文优先） |

### 已知限制（不在 227 项里，但要记）

- ~~票不持久化~~ → **已修**：`persisting(repo, file)` 在每次事务后快照，启动时读回（4 个用例覆盖；重启验收通过）。局限：整体重写，票量大时要换 append-only/SQLite。
- ~~票状态走文件桥~~ → **已修**：插件继承 `TypertRemoteService` 注册 `ghostTickets/list`（网关 source-mode 发现，无需预生成描述符），界面直接走 Remote。
  注意：网关调用 Remote 方法时 `this` 不保证是本实例，私有字段会抛错——用模块级槽位取视图。
- ~~profile 里装的是 tgz 快照，改了源码不生效~~ → **已修**：`scripts/lib-driver.mjs` 在每次启动宿主前把编译产物同步进 profile 的插件目录；改完代码先 `npm run build`。
- ~~验收脚本整份重写 `cordis.patch.yml`，冲掉 orchestrator 与默认模型~~ → **已修**：`scripts/cordis.patch.template.yml` 是唯一真相源，临时 patch 走 `boot({ patch })`，`stop()` 自动恢复。
- **无人值守审批**：headless 宿主若保留 `ask` 策略，模型调用需审批的工具会停在 `approval/asked` 永不结束。验收层设 `DSH_PERMISSION_MODE=danger-full-access`（策略 `never`）；桌面 UI 走 `workspace-write` 保留人工审批。
- **持久化仍是整体重写快照**：票量大时要换 append-only/SQLite。

### C9 剧本与技能包（12）

| ID | 交付件 | 说明 | 阶段 |
|---|---|---|---|
| C9-01 | `.flow` 解析器 + 语法校验 | 文本 → 图模型；悬空跳转/不可达/重名/缺 goal | P2 |
| C9-02 | 编译器：图模型 → `SKILL.md` + `references/nodes/*.md`（**已验通**） | 模型只看 skill，按需加载 | P2 |
| C9-03 | 流程图渲染（**基础版已跑**：自研分层布局 + 正交连线 + 条件标签 + 回边虚线） | dagre/elk 精细布局待补 | P3（进行中） |
| C9-04 | 流程图编辑器（**MVP 已完成**：增删节点/连线/条件/人闸/回退上限，编辑即回写文本，单向数据流） | 拖拽布局/撤销栈/AI 局部重写留 P3c | ✅ 已完成 |
| C9-05 | 图 diff 与校验提示 | 文本 diff 为主，图 diff 辅助 | P3 |
| C9-06 | **AI 生成流程图** | 一句话 → 流式长图 → 进入可编辑 | P3 |
| C9-07 | **AI 局部重写** | 选中块/线/框选 → 只改该局部，保留布局 | P3 |
| C9-08 | 单步试跑 | 从某节点试跑，看实际走到哪 | P3 |
| C9-09 | **包结构编译** | `.flow` → 完整 skill 包（SKILL.md + scripts/ + references/ + assets/），缺件即报错 | P2 |
| C9-10 | 脚本运行时 | 执行 `scripts/*`：超时、沙箱、幂等、并发上限 | P3 |
| C9-11 | 脚本输出协议 | `{ok,code,fix,hint}` + `--help` 一行摘要，模型不读实现 | P3 |
| C9-12 | references 分层加载 | 索引常驻、单文件按需、单文件大小上限 | P3 |

详见 [PLAYBOOK.md](PLAYBOOK.md)。

### C10 记忆与进化（7）

| ID | 交付件 | 说明 | 阶段 |
|---|---|---|---|
| C10-01 | 记忆存储（**已验通**：indexed/block 两种形态 + `.bak` + 原子写） | 四层文件布局 + 单文件常驻块（≤2KB） | P2 |
| C10-02 | 记忆工具（**真模型端到端通过**：hy3 自主调用 `memory_write` 写入 `package-manager-pnpm.md`，11.3s） | 模型可见的 list/read/write 三件套 | ✅ 已完成 |
| C10-03 | 记忆界面（**已完成**：分组查看、逐条编辑/删除、一个总开关；走 `ghostMemory/*` Remote） | 见 [MEMORY.md](MEMORY.md) §7 | ✅ 已完成 |
| C10-04 | 写入门槛（**已验通**：缺来源/一次性措辞/非法名被拒，超预算不静默截断） | 三问过滤 + 候选句提取 | P3 |
| C10-05 | 记忆进化 | 同一错误 3 次 → 提议升为约束，人确认后进 L2 | P3 |
| C10-06 | 剧本与技能进化 | 返工归因到节点 → 改 `.flow`；脚本连跑通 2 次 → 沉淀进 `scripts/` | P3 |
| C10-07 | 进化度量 | `runs.jsonl` + before/after 看板（完成率 / token / 工具数 / 返工） | P4 |

详见 [MEMORY.md](MEMORY.md)。

### C11 命令与上下文管理（7）

| ID | 交付件 | 说明 | 阶段 |
|---|---|---|---|
| C11-01 | 命令面板与斜杠输入（**基础版已跑**：真实 `commands/list` 驱动、搜索/补全/参数提示、斜杠不进模型消息） | `!` 直通 / `@` 引用仅识别提示；附件选择 UI 待补 | ✅ 基础版 |
| C11-02 | 命令执行通道（**已验通**：6 条命令 + `/compact` 执行返回 success） | 接 `commands/list` + `commands/execute`，不进模型消息 | ✅ 已完成 |
| C11-03 | 压缩策略配置 | 裁剪阈值、触发阈值、保留策略、`/compact` 带焦点 | P2 |
| C11-04 | 上下文占用条 | 显示窗口占用 + 压缩点标记，可展开看被压掉的原文 | P3 |
| C11-05 | Checkpoint / rewind（**已完成**：每条用户消息可 fork 新会话，精确 `atSeq` 前缀，原会话不变） | 见 [COMMANDS.md](COMMANDS.md) §4.1 | ✅ 已完成 |
| C11-06 | 会话导出（**已完成**：Markdown 从视图模型生成、JSONL 保留原始日志、命令执行可见、顶栏一键下载） | 见 [COMMANDS.md](COMMANDS.md) §4.1 | ✅ 已完成 |
| C11-07 | `/init` 等价物 | 扫描仓库生成 `GHOST.md` 草案（项目记忆种子） | P3 |

详见 [COMMANDS.md](COMMANDS.md)。

---

## 附：怎么用这张表

- **估工时只对 C 类和 B 类改造**：A 类不需要人天。
- **最大的一块新增是眼睛能看见的部分**：C8 界面 25 + C9 剧本 5 = 30 项，都在 P3；这是「不用别人的 Web UI」的直接代价，也是产品差异化的落点。
- **P1 的合理交付**＝ B1–B7（59）+ C1-01/02/03 + C2（3）+ C4-01 ≈ **64 项**，其余按阶段推进。
- 每完成一项，在 PLAN 的验收口径里能对应到一条可跑的命令或一个用例；对不上的，就说明这项还没定义清楚。
