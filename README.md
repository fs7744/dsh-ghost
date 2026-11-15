# dsh-ghost

一个以 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 为内核的**主动型 agent 工作台**：它在你不在的时候干活，只在该有人动手时才说话。

> Built on DeepSeek Harness. Not affiliated with or endorsed by DeepSeek.

## 现在是什么状态

**仓库内的工程件已按 [PLAN.md](PLAN.md) 全部落地。** 主链路是：**外部事件 → 可插拔信息源 → 票 → 自动执行（真模型）→ 报告 → 回写来源会话**。

- 界面 26 项全自建：会话树 / 对话 / 工具卡片 / 审批 / 文件树 / 终端 / 后台任务 / 交付物与文档预览 / 计划 / 目标 / 子代理 / 团队 / 技能 / 设置 / 插件市场 / 命令面板 / 主题 / 中英 i18n / 附件 / 反馈统计 / Superagent 面板，全部走 Typert Remote。
- 剧本 = skill：`.flow` 是唯一真相源，图 / 表单 / 源码三视图编辑即回写；另有图 diff、可注入的 AI 生成与局部重写（默认确定性实现，无需 key）、单步试跑、脚本运行时与分层 references。
- 记忆与进化：文件式四层记忆、写入门槛、界面可看可删；返工三次生成约束提案，剧本/技能提案落盘待人工批准，`runs.jsonl` 记度量——**禁止运行时静默改自己**。
- 契约面：131 项宿主探针 + 224 个 Remote 端点 + 31 个转发事件，全部从 harness 编译产物生成并做漂移校验。
- 桌面壳：`apps/shell` 是 Electron 主进程（只 Windows x64），runtime 子进程 / 单实例 / 托盘 / 开机启动 / 崩溃恢复 / 首启向导 / `safeStorage`(DPAPI) / 诊断包脱敏 / NSIS 与更新通道配置齐全。
- 测试分层：L0 单测、L1 确定性故障注入假端点、L2 JSONL 回放、L3 真模型**结构**断言、L4 离线评测、L5 Playwright 骨架、CI 门禁矩阵。

> 仍需真实环境才能闭环的只有 P4 外部动作：代码签名证书、干净 Windows 上的 NSIS 安装→自更新→卸载、Electron 44 内置 Node 与原生模块 ABI 实测、发版前官方 BYOK 冒烟。详见 [PLAN.md §0](PLAN.md) 与 [docs/RELEASE.md](docs/RELEASE.md)。macOS / Linux 不在本期范围。

| 已完成 | 说明 |
|---|---|
| 契约探针 | 131 项检查，`contract.json`，0.2.2-rc.3 全绿 |
| 通路 spike | 5/5：启动 → 换 Cookie → `POST /api/session/list` → 真实数据 |
| 事件流 | `/api/remote.mux` + `$events` → `api-session/added` |
| 端点生成 | 39 个包 / **224 个 Remote 端点** → 类型化调用表 |
| `harness-port` | 传输层（调用 + 事件），零 `@deepseek-ai` 依赖 |
| `playbook` | `.flow` 解析 / 校验 / 编译成 skill 包 / 图模型往返 |
| `memory` + `memory-plugin` | 文件式记忆 + 三个模型工具；**已验通模型侧可见并被调用** |
| `superagent` | 领域核心（16 文件，零 harness 依赖）；持久化票；`npm run ticket` 跑真实工单 |
| `orchestrator-plugin` | 引擎常驻宿主：`ghost_ticket` + `ghostTickets/*` + `ghostSources/*` + **自动执行器** + Outbox |
| `source-hub` | **可插拔信息源**：注册表 + 声明式映射 + 用户自定义 mapper + 通用签名（9 个用例） |
| `source-github` / `sink-github` | webhook 入口（HMAC）与评论出口（幂等 Outbox） |
| **自动执行闭环** | 开票后执行器自己 `followup` → 等回合 → 报告 → 票结束，无需人工推进 |
| **GitHub 全闭环** | webhook → 票 → 真模型 → 评论回到原 issue（本地假服务器端到端验收） |
| **配置治理** | `scripts/cordis.patch.template.yml` 单一真相源；启动前自动同步编译产物到 profile |
| **命令面板（C11-01）** | 输入 `/` 浮出真实 `commands/list` 候选，搜索/补全/参数提示，斜杠命令绝不进模型消息 |
| **会话导出（C11-06）** | 顶栏一键导出 Markdown（与界面视图一致）/ JSONL（原始日志不丢字段），命令执行记录可见 |
| **回退（C11-05）** | 每条用户消息可 `session/fork` 出新会话，精确 `atSeq` 前缀，原会话不变、可撤销 |
| **记忆界面（C10-03）** | 分组查看 / 逐条编辑 / 删除 / 总开关，走 `ghostMemory/*` Remote；与模型工具共用同一存储与写入门槛 |
| **剧本编辑器（C9-04）** | 图 + 表单 + 源码三视图；增删节点/条件边/人闸/回退上限、改名、调顺序，编辑即回写 `.flow`，实时校验 + 导出 |
| `apps/desktop` | 26 项自建界面：会话树 + 对话 + 工具卡片 + 审批 + 文件树 + 终端 / 任务 / 计划 / 目标 / 子代理 / 团队 / 技能 / 设置 / 插件 + 主题 + 中英 i18n + 附件 + 反馈统计 + Superagent 面板 + 剧本编辑器（全走 Remote） |
| **事件契约** | `gen-events.mjs` → `events.json`（31 个转发事件）+ `events.generated.ts`；`verify:events` 查漂移，升级流水线先重生成再跑探针 |
| **剧本打磨（C9-05～12）** | 图 diff、可注入 AI 生成/局部重写、单步试跑、脚本运行时（白名单/超时/并发/幂等）、`{ok,code,fix,hint}` 输出协议、references 分层加载 |
| **进化（C10-05～07）** | 三次返工 → 人闸提案 → L2 约束；剧本/技能提案只落盘不自动应用；`runs.jsonl` + before/after 度量 |
| **上下文与项目记忆（C11-03/04/07）** | 压缩策略配置、占用条上的压缩点标记与可展开原文、`/init` 等价的 `GHOST.md` 草案（不覆盖既有文件） |
| **superagent 装配（B2–B7）** | 三个插件入口、19 个会话工具描述符与处理器、7 个面板视图、GitHub / 飞书（默认关）触发源、16 个分级加载的提示词、部署脚本与自检，见 [docs/SUPERAGENT.md](docs/SUPERAGENT.md) |
| **模型层（C3）** | `model-manager`（provider / 能力标注 / 角色路由 / 连通性自测 / Ollama·vLLM 预设 / 明文凭据拒绝）与 `model-adapter-kit`（Apache-2.0 的稳定三方法契约，第三方插件不碰 harness）；模型库页由 Electron 本机 `/api/models/*` 提供真数据，Vite 开发时降级 demo |
| **升级与纪律（C1-04/05）** | `upgrade:harness` 8 步 dry-run 默认、绝不 push；`check-port-discipline` 禁绕过 port 层；`matrix.json` + [UPGRADE.md](docs/UPGRADE.md) |
| **测试分层（C4）** | [TESTING.md](docs/TESTING.md)：L1 假端点 7 种故障、L2 规范化回放、L3 结构断言、L4 评分、L5 规格、CI 门禁 |
| **Electron 壳与发布（C5/C6/C7）** | `apps/shell` + `build/` + [RELEASE.md](docs/RELEASE.md)；单实例 / 托盘 / 崩溃恢复 / 安全存储 / 诊断包 / NSIS / 更新通道 / 隐私与第三方声明 |

## 文档

按这个顺序读：

1. [PLAN.md](PLAN.md) — 总纲：架构、分期、已定与待定
2. [docs/FEATURES.md](docs/FEATURES.md) — 227 项功能账本（白拿 / 移植 / 自建）
3. [docs/SOURCES.md](docs/SOURCES.md) — **可插拔信息源**：三种自定义方式、模板语法、mapper 契约
4. [docs/PLAYBOOK.md](docs/PLAYBOOK.md) — 剧本：图给人、文本给模型
5. [docs/MEMORY.md](docs/MEMORY.md) — 记忆与进化
6. [docs/COMMANDS.md](docs/COMMANDS.md) — 命令 / 压缩 / 回退 / 导出
7. [docs/UI-STYLE.md](docs/UI-STYLE.md) — UI 与交互规范
8. [docs/REVIEW.md](docs/REVIEW.md) — 评审：10 个风险与必改项
9. [docs/LICENSING.md](docs/LICENSING.md) — 许可证与商标
10. [docs/SUPERAGENT.md](docs/SUPERAGENT.md) — B2–B7 宿主装配、19 个工具、提示词分级
11. [docs/UPGRADE.md](docs/UPGRADE.md) — harness 升级运行手册（8 步、失败改哪里）
12. [docs/MODELS.md](docs/MODELS.md) — 模型管理面与对外 adapter 契约
13. [docs/TESTING.md](docs/TESTING.md) — L0–L5 测试分层与门禁
14. [docs/RELEASE.md](docs/RELEASE.md) — Windows 签名 / NSIS / 更新通道 / 发版前核对
15. [docs/PRIVACY.md](docs/PRIVACY.md) · [docs/THIRD-PARTY.md](docs/THIRD-PARTY.md) · [docs/DIAGNOSTICS.md](docs/DIAGNOSTICS.md) — 隐私、许可、诊断包

## 开发

```sh
npm install                       # 根依赖（typescript / ws / @types/node）
npm run verify:contract           # 契约探针，需要一份 harness 检出
npm run gen:remotes               # 重新生成 224 个端点的类型表
npm run gen:events                # 重新生成 31 个转发事件的清单与类型
npm run verify:events             # 事件契约漂移校验（升级 harness 后第一步）
npm run verify:port               # harness-port 验收：取数 + 事件
npm run typecheck                 # tsc --noEmit（全部包 + scripts）
npm run build                     # 编译 12 个包到 lib/（纯 Node 可加载）
npm test                          # 471 个用例 / 20 套件（界面/剧本/进化/模型/壳/装配/领域/持久化/信息源…）
npm run check:ui                  # 渲染层 tsc --noEmit（含 vite/client 类型）
npm run check:shell               # Electron 主进程 tsc --noEmit
npm run build:ui                  # Vite 构建桌面渲染层
npm run build:shell               # 编译 Electron 主进程到 apps/shell/dist
npm run verify:playbook-editor    # 9 步编辑 → 文本回写 → 编译成 skill 包
npm run verify:command-palette    # 真实宿主：命令清单 → 过滤 → 执行 → 不进模型消息
npm run verify:session-export     # 真实宿主：session/page → Markdown / JSONL 落盘
npm run verify:rewind             # 真实宿主：checkpoint → session/fork → 前缀新会话
npm run verify:memory-ui          # 真实宿主：ghostMemory/* 读/写/删 + 总开关
npm run verify:panels             # 真实宿主：界面 8 个端点的响应归一化
npm run verify:evolution          # 真实宿主：三次返工 → 提案 → 批准/驳回 → runs.jsonl
npm run verify:init               # /init 草案：不覆盖既有 GHOST.md
npm run verify:compaction         # 压缩策略配置与 /compact 焦点参数
npm run verify:models             # 模型管理面：route / 能力 / 角色 / 凭据（假端点）
npm run verify:shell              # 桌面壳静态自检（不启 Electron、不联网）
npm run verify:superagent-assets  # B2–B7 资产静态自检（8 项）
npm run test:superagent           # 装配 / 19 工具 / 7 视图 / 触发源 / 提示词预算 / 看护（78 用例）
npm run verify:gates              # 7 项门禁总表（PR 口径）
npm run verify:all                # 一条命令跑完全部验收（-- --with-model 连真模型）
npm run verify:l3                 # 真模型结构断言（无 key 自动 SKIP）
npm run verify:l5                 # L5 Playwright 骨架（未装依赖自动 SKIP）
npm run upgrade:harness -- 0.2.3  # 升级计划（默认 dry-run，--apply 才落盘，绝不 push）

npm run deploy:skill -- packages/playbook/examples/ticket-flow.flow
npm run verify:skill              # 确认 harness 的 skills/list 里能看到它
npm run smoke:plugin              # 编译产物冒烟（不启 harness）
npm run verify:plugin-boot        # 把插件挂进 profile 真启动一次
npm run verify:tool-visibility    # 假模型端点跑一轮：工具→模型→调用→结果回传
npm run verify:real-model         # 真模型端到端（需要 .env 里的 WB_BASE_URL / WB_KEY）
npm run verify:auth               # 安全边界：401 / 伪造 Cookie / 非本机 Host / 事件权限
npm run verify:commands           # 斜杠命令：commands/list + commands/execute
npm run check:secrets             # 扫描受版本控制的文件里有没有密钥

npm run dev:ui                    # 起 harness + 前端（自动读 .env，保留人工审批）
npm run ticket                    # 触发 → 准入 → 建票 → 派活（真模型）→ 报告
npm run verify:auto-run           # 开票后执行器自己跑完，不需人工推进
npm run verify:github             # GitHub webhook：签名 → Trigger → 开票
npm run verify:outbox             # GitHub 出口：真实 HTTP 假服务器验幂等与失败重试
npm run verify:github-loop        # webhook → 票 → 真模型 → 评论回原 issue
npm run verify:source-hub         # 一个宿主同时挂三种来源（内置/声明式/自定义 mapper）
```

**改了包里的代码之后**：先 `npm run build`，再跑任意验收脚本。`scripts/lib-driver.mjs`
会在启动宿主前把 `lib/` 同步进 profile 的插件目录，并从模板重新落盘
`cordis.patch.yml`——不要直接改 `.dsh-home` 里的副本。

**无人值守**：headless 验收会设 `DSH_PERMISSION_MODE=danger-full-access`，让审批请求立即被拒，
否则模型调用需审批的工具时会停在 `approval/asked` 不再前进。桌面 UI 走
`workspace-write`，保留人工审批闸门。

**harness 的两个路径（别混）**：

- **源码检出**：`D:\code\deepseek-harness`（纯源码、只读扫描），`verify:contract` 与升级流水线读它。
  换位置就设 `DSH_HARNESS_ROOT`（环境变量或 `.env`，见 `.env.example`）。它**没有构建产物，不能拿来启动宿主**。
- **运行时安装**：`spikes/p05-transport/node_modules`（已装 `@deepseek-ai/dsh@0.2.2-rc.3`，1.3GB，已 gitignore），
  供启动宿主、`gen:remotes`、`verify:port` 与事件探针使用；换位置设 `DSH_DSH_MODULES`。
- `npm run gen:remotes` 会同时打印两者版本，不一致时给 WARN——契约探针的结论必须建立在同一版本上。

## 两条硬边界

1. **不改 harness**：harness 只升级；所有适配只发生在 `packages/harness-port`。
2. **界面自建**：不加载 harness 的 Web UI，也不用 superagent 原来的面板；只复用它的 Remote 契约。

## 许可

| 路径 | 许可 | 文件 |
|---|---|---|
| 其余全部（应用、内部包、文档） | **专有**（All rights reserved） | [LICENSE](LICENSE) |
| `packages/model-adapter-kit/**`、`docs/PLAYBOOK.md` 格式规范 | **Apache-2.0** | [LICENSE-APACHE](LICENSE-APACHE) |
| `packages/playbook/examples/**`、`playbooks/**` | **MIT** | [LICENSE-MIT](LICENSE-MIT) |

上游 `deepseek-harness`（MIT, © 2026 DeepSeek）与 `dsh-superagent`（MIT, © 2026 DeepSeek Harness Team）的版权声明随分发保留。

Built on DeepSeek Harness. Not affiliated with or endorsed by DeepSeek.
