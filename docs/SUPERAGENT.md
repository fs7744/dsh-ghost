# superagent 宿主侧装配（B2–B7）

> 配套 [PLAN.md](../PLAN.md) §2 / §3 / §9、[FEATURES.md](FEATURES.md) §B、
> [PLAYBOOK.md](PLAYBOOK.md)、[SOURCES.md](SOURCES.md)。
> 本文回答一件事：**B1 领域核心之上的宿主装配层落在哪里、怎么和已有插件分工、怎么验。**

## 0. 一句话

`packages/superagent` 在零 harness 依赖的领域核心（`src/core/`）之上，补齐
B2 插件入口、B3 会话工具、B4 面板视图、B5 触发源、B6 提示词与剧本、B7 部署自检。
所有适配只发生在 `packages/harness-port`；本层不 import 任何 `@deepseek-ai/*`、不碰 DOM、
不改 `contracts.ts`、不启动宿主即可静态验收。

## 1. 与 orchestrator-plugin 的分工（最重要）

| | `ghost-orchestrator`（packages/orchestrator-plugin） | `dsh-superagent`（本文 B2-01 装配层） |
|---|---|---|
| Engine | **唯一** `new Engine(...)` 的地方，常驻宿主 | **不 new Engine**，注入同一份 `Engine` / `Repositories` 实例 |
| 票状态 | 持久化快照、`ghost_ticket` 工具、自动执行器、Outbox | 只读 `repo` 出视图；写操作经注入的 Engine 端口 |
| Remote | `ghostTickets/*`、`ghostSources/*` | `ghostViews/*`、`ghostTools/*`（新增），并声明完整管理面清单 |
| 工具 | 1 个 `ghost_ticket` | 19 个 `orchestrator_*` 会话工具（描述符 + 处理器，不真注册进 harness） |
| 触发源 | `ghostSources/ingest` 收单 | 产出声明式 `SourceSpec`，交给 `ghostSources/ingest` |

两者共用一份 `repo` 与 `engine`，**避免双实例**。装配清单里的 `division` 字段与
`docs/SUPERAGENT.md` 本节是这份分工的机器可读 / 人读两份记录。
B2-01 的 `apply(ctx, deps, config)` 里 `deps.engine` 就是 orchestrator-plugin 常驻的那一个。

## 2. B2 三个插件入口

| ID | 入口 id | 文件 | 说明 |
|---|---|---|---|
| B2-01 | `dsh-superagent` | `src/app/host/main.ts` | 主装配层，`inject` 声明 11 个逻辑服务；把 19 工具 / 7 视图 / Remote 清单接齐 |
| B2-02 | `dsh-superagent/github-watch` | `src/app/host/github-watch.ts` | GitHub 触发源，签名复用 `source-github`、归一化复用 `source-hub`，GitHub 逻辑不写死在插件里 |
| B2-03 | `dsh-superagent/feishu-watch` | `src/app/host/feishu-watch.ts` | 飞书触发源，声明式映射 + 通用签名，**默认关闭** |

装配核心在 `src/app/host/assembly.ts`：`createAssembly(config)` 产出可核对的清单，
`install(ctx, deps, config)` 把描述符注册到可注入的 `HostContext`（鸭子类型，零 harness 依赖）。
`install` 只做「转成宿主工具的注册动作」，绝不改 `contracts.ts`，也绝不重复挂 Engine。

## 3. B3 19 个会话工具（一览表）

统一在 `src/tools/registry.ts`：描述符含 `name` / `description`（<=120 字符，给模型看的说明书）/
`parameters`（JSON Schema）/ `handler`。`handler` 只依赖可注入的
`Repositories` + `Engine` + `ConfigStore` + `ViewReader`（实现在 `src/tools/context.ts`），
返回人话文本；领域拒绝（`UserError`）由 `invokeTool` 把原因**原样返回**让模型自愈。

| 工具 | 作用 | 主要参数 |
|---|---|---|
| `orchestrator_ack` | 确认收到并接管某人消息 | ticketId, triggerId, text |
| `orchestrator_thread_unrelated` | 把线程标为与票无关 | ticketId, thread, reason |
| `orchestrator_thread_follow` | 订阅线程作只读上下文 | ticketId, source, threadId |
| `orchestrator_trigger_handback` | worker 把消息交回主会话 | ticketId, triggerId, reason |
| `orchestrator_report` | 汇报进展 / 提问 / 答复 | ticketId, state, summary, question?, askedBy?, answers? |
| `orchestrator_route` | 路由显式请求：接受 / 叫停 / 忽略 / 附票 | triggerId, kind, title?, scope?, ticketId?, note? |
| `orchestrator_ticket_retry` | 重试卡住的票 | ticketId |
| `orchestrator_ticket_request_status` | 请等待中的 worker 报状态 | ticketId |
| `orchestrator_ticket_note` | 给票追加事实注记 | ticketId, text |
| `orchestrator_trigger_requeue` | 重新排队评估一条触发 | triggerId |
| `orchestrator_eval` | 取等待评估的候选 | triggerId, evalId? |
| `orchestrator_eval_read` | 读线程决策记录 | thread / triggerId |
| `orchestrator_eval_decide` | 记下评估结论 | triggerId, kind, title?, scope?, reason?, evalId? |
| `orchestrator_reply` | 按用途排队回复 | purpose, text, ticketId?, triggerId?, question? |
| `orchestrator_thread_unsubscribe` | 人取消线程订阅 | thread |
| `orchestrator_settings_save` | 保存配置块 | block, values |
| `orchestrator_policy_sync` | 推进策略版本并通知引擎 | from? |
| `orchestrator_prompts_save` | 保存提示词分片（校验非空 / 预算 / 占位符） | id, text |
| `orchestrator_read` | 读一个面板视图 | view |

账本里的简写（如 `_thread_unrelated`）完整名一律是 `orchestrator_` 前缀；
`scripts/verify-superagent-assets.mjs` 直接解析 FEATURES.md §B3 与注册表比对，防止漏项。

## 4. B4 7 个面板视图

`src/app/views/`：纯函数 `buildXxxView(repo, extra?) -> { view, rows, summary, actions }`。
统一形状见 `types.ts`；`VIEW_BUILDERS` 是名字到 builder 的映射，`renderViewText` 把视图渲成人话供 `orchestrator_read` 用。
示例数据在 `examples/superagent-views.json`（由 `sampleViews()` 生成）。

| ID | 视图 | 内容 |
|---|---|---|
| B4-01 | Overview | **只显示需要人处理的票**（`ticketStage` 为 `person`） |
| B4-02 | Tickets | 全部工作项列表与详情 |
| B4-03 | Records | 决策记录 + 派活报告，按时间排序 |
| B4-04 | Threads | 线程与订阅概况 |
| B4-05 | Sources | 触发源配置（默认关闭的源要显眼） |
| B4-06 | Settings | 策略 / 执行器 / 提示词配置块 |
| B4-07 | 部署配置页 | 机器 + 账号 + 自检结果，缺项显眼 |

**领域规则**：`ready` 报告在没有 follow 项（如 PR 未合并）时直接结束票。
所以 Overview 用 `ticketStage(ticket).stage === 'person'` 过滤，已结束的票（含 `completed`）一律不进「待人处理」；
示例 JSON 里 `tk-done` 不出现在 Overview，静态验收守着这一条。

## 5. B5 两个触发源与配置样例

`src/sources/` 只做「来源配置」与「是否值得建票」的策略：

- 原始投递 → `verifyAuth`（source-hub 通用 HMAC / token / none，头名 / 算法 / 前缀 / 密钥来源可配）
  → `adapterFor(kind).normalize`（GitHub 内置适配器 / generic 声明式映射）→ `shouldOpenTicket` → 领域 `Trigger`。
- `shouldOpenTicket` 默认**只给 addressed 的事件建票**：旁观消息、机器人消息、空线程 / 空正文一律不建票。
- 端到端入口 `ingestAndOpenTickets(spec, input, env)`，正确签名接受 / 错误签名拒绝（带 reason）/ 非 addressed 不建票都有测试。

| ID | 来源 | 实现 |
|---|---|---|
| B5-01 | GitHub | 评论 / issue / PR / review、`@` 提及、权限校验、PR 交付；签名复用 `source-github.verifySignature`，映射复用 `source-hub` 的 github 适配器 |
| B5-02 | 飞书 | bot 提及、群成员同步，`kind=generic` 声明式字段映射；**默认关闭** |

可直接用的配置样例：`examples/sources.patch.yml`（与 `SAMPLE_PATCH_YAML` 常量同源）。
密钥一律走 `*Env` 指向环境变量，配置里不出现任何明文 token。

### 如何启用飞书源

1. 在宿主环境里设置 `FEISHU_WEBHOOK_SECRET`（或改名后用 `feishuWatchSpec({ secretEnv })` 指定）。
2. 在 `cordis.patch.yml` 的 `sources` 里把飞书那一项 `options.enabled` 改成 `true`，
   必要时调整 `auth.header` / `auth.algorithm` / `auth.prefix` 与 `mapping` 字段路径。
3. 或以代码方式 `createFeishuWatchAssembly({ enabled: true })` / `applyFeishuWatch(ctx, { enabled: true })`。
4. 不显式启用就用默认关闭，`apply` 只打一条日志、不注册 spec（静态验收断言这一点）。

## 6. B6 提示词 6 组与分级加载

`prompts/manifest.json` 是机器可读账本：分组、每文件加载级别、常驻字符预算 `residentMaxChars`。

| 组 | 明细 | 加载级别 |
|---|---|---|
| B6-01 主会话 | orchestrator.md / shared.md / subscriptions.md | **常驻**：persona + 底线 + 订阅规则，必须极小 |
| B6-02 派遣与交接 | dispatch / handoff / handoff-orchestrator / handoff-worker | **按需**：流程步骤已改写为 `.flow` 剧本 |
| B6-03 执行器 | worker.md（**常驻** persona）/ work.md / cli.md（按需） | 混合 |
| B6-04 准入与答复 | admission.md / replies.md | **按需**：判断标准进剧本节点详情 |
| B6-05 团队约束 | team/communication / delivery / scope | **按需**：shared.md 引用，细节按需 |
| B6-06 技能 | 两个 SKILL.md（github / feishu） | **按需**：frontmatter 常驻约 20 token，正文按需 |

**PLAN §9 连带影响**：角色与语气留下当短 persona，流程步骤改写成 `.flow` 剧本
（`playbooks/superagent.flow` / `admission.flow` / `dispatch.flow` / `handoff.flow` / `work.flow` / `replies.flow`）。
4 个常驻文件合计约 872 字符（约 300 token 级），每个都小于 700 字符预算；
常驻系统提示从数千 token 降到数百，这就是省 token 的主要来源。

**口径说明**：FEATURES.md §B6 账本写「16 个文件」，逐项明细实为 17 个
（15 个纯提示词 + 2 个技能 SKILL.md）。本实现以逐项明细为准全部交付，不丢项、不凑数；
静态验收输出里如实标注这个差异。2 个 SKILL.md 都有合法 frontmatter（`name` + `description`）。

## 7. B7 部署与自检 4 项

| ID | 交付件 | 落点 |
|---|---|---|
| B7-01 | `scripts/dsh-superagent` 服务脚本 | `packages/superagent/scripts/dsh-superagent`；`src/infra/service.ts` 提供 `parseArgs` / `runService`，执行器与 IO 可注入 |
| B7-02 | 自检与 status 退出码 | `src/infra/selfcheck.ts`：8 项完整性检查，缺项给明确原因；退出码 0 全绿 / 1 缺项 / 2 安全红线 |
| B7-03 | SETUP 12 步问答 → 计划 → 执行 | `src/infra/setup.ts`：`SETUP_STEPS` / `buildSetupPlan` / `executeSetupPlan` / `runSetup`，纯逻辑 + 可注入 IO；CLI 的 `setup` 命令接它 |
| B7-04 | 小时级看护 | `src/infra/watchdog.ts`：默认 3600000ms 体检，挂了自动拉起，指数退避（base 1000ms、封顶 60000ms、连续失败 5 次告警停拉）；`startWatchdog` 常驻 / `runWatchdog` 有限轮 |

运行形态：

```sh
node --experimental-transform-types packages/superagent/scripts/dsh-superagent help
node --experimental-transform-types packages/superagent/scripts/dsh-superagent status
node --experimental-transform-types packages/superagent/scripts/dsh-superagent start
node --experimental-transform-types packages/superagent/scripts/dsh-superagent setup
node --experimental-transform-types packages/superagent/scripts/dsh-superagent watch --ticks=5
```

`start` 启动前先跑自检，缺项不启；`status` 逐条打印检查结果并把退出码原样交出去。

## 8. C2-01 管理面全部走 Typert Remote

管理面不存在自建 `/orchestrator` HTTP 路由。已有 Remote：
`ghostTickets/*`（票）、`ghostSources/*`（触发源）、`ghostMemory/*`（记忆）、`ghostEvolution/*`（进化）；
本装配层新增 `ghostViews/*`（视图）与 `ghostTools/*`（工具清单），同样走 Remote 契约、统一 Peer 鉴权。
完整清单在 `src/app/host/assembly.ts` 的 `MANAGEMENT_REMOTES`。

`src/infra/selfcheck.ts` 里有一条静态断言 `findSelfBuiltRoutes`：只认明确的路由注册写法
（`*.get('/orchestrator'`、`route('/orchestrator'` 等），不认文档里对该词的叙述，也不认 Typert Remote 声明；
断言定义自身不参与扫描，避免模式字面文本自我命中。
`verify-superagent-assets.mjs` 会先证明断言能命中一段坏代码，再扫描整个仓库要求 0 命中。

## 9. 验收命令

```sh
# 只跑本线新增的测试（不启动宿主、不跑 build）
node --test --experimental-transform-types packages/superagent/tests/tools.test.ts \
  packages/superagent/tests/views.test.ts packages/superagent/tests/sources.test.ts \
  packages/superagent/tests/setup-status.test.ts packages/superagent/tests/prompts-budget.test.ts \
  packages/superagent/tests/watchdog.test.ts packages/superagent/tests/assembly.test.ts

# 类型门禁
npx tsc --noEmit -p tsconfig.json

# 不启动宿主的静态验收（失败 exit 1）
node --experimental-transform-types scripts/verify-superagent-assets.mjs
```

建议登记到根 package.json 的两条脚本：

```json
"test:superagent": "node --test --experimental-transform-types packages/superagent/tests/tools.test.ts packages/superagent/tests/views.test.ts packages/superagent/tests/sources.test.ts packages/superagent/tests/setup-status.test.ts packages/superagent/tests/prompts-budget.test.ts packages/superagent/tests/watchdog.test.ts packages/superagent/tests/assembly.test.ts",
"verify:superagent-assets": "node --experimental-transform-types scripts/verify-superagent-assets.mjs"
```

## 10. 未完成边界（如实登记）

- B2 是**装配层**：产出描述符 / 清单 / `HostContext` 适配接口，并未真正把 19 个工具注册进 harness 的
  `ctx.tools.register`（按任务要求不改 `contracts.ts`、不碰 harness 工具注册）；真实接线留给宿主侧集成。
- `dsh-superagent` 不 new Engine，必须注入 orchestrator-plugin 常驻的 Engine；单独启动没有票状态。
- B4 只产出数据形状与示例 JSON，界面渲染由别线（apps/desktop）完成。
- B7-03 SETUP 先保留 CLI 形态；GUI 化（C5-11）复用 `runSetup` 三段逻辑。
- 飞书源默认关闭；启用需要真实密钥与飞书侧事件订阅配置，本线不联调外部服务。
- `scripts/dsh-superagent` 的起停是最小 pid 文件形态，未接 Windows 服务 / Electron 运行时子进程。
