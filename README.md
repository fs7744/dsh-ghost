# dsh-ghost

一个以 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 为内核的**主动型 agent 工作台**：它在你不在的时候干活，只在该有人动手时才说话。

> Built on DeepSeek Harness. Not affiliated with or endorsed by DeepSeek.

## 现在是什么状态

地基与主链路已打通：**外部事件 → 可插拔信息源 → 票 → 自动执行（真模型）→ 报告 → 回写来源会话**。
剧本页已可编辑（图 + 表单 + 源码，编辑即回写 `.flow`），P3 其余界面项按 [PLAN.md](PLAN.md) 推进中。

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
| **剧本编辑器（C9-04）** | 图 + 表单 + 源码三视图；增删节点/条件边/人闸/回退上限、改名、调顺序，编辑即回写 `.flow`，实时校验 + 导出 |
| `apps/desktop` | 会话树 + 对话 + 工具卡片 + 上下文条 + 票列表/详情 + 剧本流程图与编辑器（全走 Remote） |

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

## 开发

```sh
npm install                       # 根依赖（typescript / ws / @types/node）
npm run verify:contract           # 契约探针，需要一份 harness 检出
npm run gen:remotes               # 重新生成 224 个端点的类型表
npm run verify:port               # harness-port 验收：取数 + 事件
npm run typecheck                 # tsc --noEmit
npm run build                     # 编译各包到 lib/（纯 Node 可加载）
npm test                          # 127 个用例（剧本/编辑器/命令面板/会话解析/导出/回退/记忆/插件/领域/持久化/GitHub 出入/信息源）
npm run check:ui                  # 前端 tsc --noEmit（含 vite/client 类型）
npm run build:ui                  # Vite 构建桌面渲染层
npm run verify:playbook-editor    # 9 步编辑 → 文本回写 → 编译成 skill 包
npm run verify:command-palette    # 真实宿主：命令清单 → 过滤 → 执行 → 不进模型消息
npm run verify:session-export     # 真实宿主：session/page → Markdown / JSONL 落盘
npm run verify:rewind             # 真实宿主：checkpoint → session/fork → 前缀新会话

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
