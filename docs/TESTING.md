# 测试分层与门禁（C4）

> 对应 PLAN §13、FEATURES C4-01～07、REVIEW R4。
> 最重要的原则：**L3 / L4 只断言结构，绝不断言文本**。否则模型一升级测试全红，
> 最后没人看测试。回归主力永远是零 key 的 L2 回放，不是真模型。

## 1. 分层（照抄 harness 自己的分法）

| 层 | 测什么 | 要真模型 | 门禁 | 命令 |
|---|---|---|---|---|
| L0 | 纯逻辑：契约兼容、目录、route、角色、凭据、门禁汇总 | 否 | 每次 PR | `npm run test`、`npm run test:model` |
| L1 | 适配与事件流：工具调用序列、重试、截断 | 否（假端点） | 每次 PR | `npm run verify:mock-server` |
| L2 | 会话回放：真 agent + 真工具 + 真 prompt，模型响应固定 | 否 | 每次 PR | `npm run test:replay` |
| L3 | 真模型冒烟：开会话 → 工具 → 结果 | **是** | 每日 / 发版前 | `npm run verify:l3` |
| L4 | 评测集：完成率 / 越权率 / 噪音率 | **是** | 手动 / 夜间 | `npm run verify:l3 -- --l4` |
| L5 | 界面：Playwright + Electron 关键路径 + 截图基线 | 否 | 每日 | `npm run verify:l5` |

L4 作为 `verify-l3.mjs` 的 `--l4` 子命令提供，不另起脚本、不进 PR 门禁。

## 2. L1 假端点（C4-02）

`scripts/llm-mock-server.mjs`：OpenAI 兼容的确定性假端点，端口 0 由 OS 分配，
可启停（模块导出 `startMockServer` / `stopMockServer`）。响应体完全确定，
不含时间戳、不含随机 id。

端点：`POST /v1/chat/completions`、`GET /v1/models`。

模式选择优先级：`x-dsh-fault` 请求头 > `/fault/<mode>/v1/...` 路径段 >
`?fault=<mode>` 查询参数 > 缺省 `normal`。未知模式回 400，不静默降级。

| 模式 | 行为 |
|---|---|
| `normal` | 正常 chat.completion，回显最后一条 user 文本 |
| `timeout` | 故意不响应，让调用方走自己的超时逻辑 |
| `http500` | 返回 500 |
| `http429` | 返回 429 + `Retry-After` |
| `truncated` | 返回被截断的合法前缀（JSON 不可解析） |
| `bad-json` | 返回非法 JSON 文本 |
| `tool-call` | 返回一个 `tool_calls` 结构 |

```sh
node scripts/llm-mock-server.mjs            # 默认跑一次本地 fetch 自检（7 模式 + 路径选择 + 未知模式 400）
node scripts/llm-mock-server.mjs --serve    # 常驻，打印地址，Ctrl+C 停止
```

## 3. L2 回放基线（C4-03）

`scripts/replay.mjs` 录制 / 回放 JSONL，比较前做确定性规范化：

- 去掉易变字段：时间类（`at` / `createdAt` / `timestamp` ...）、id 类
  (`id` / `rpcId` / `requestId` / `sessionId` ...)、token 计数类
  (`usage` / `tokens` / `total_tokens` ...)、耗时类（`durationMs` / `elapsed` ...）；
  完整清单见 `scripts/lib-models.mjs` 的 `VOLATILE_KEYS`。
- 对象键按字典序排列（`stableStringify`）；**数组顺序保留**（顺序是语义，不能排序）。
- `diffRecords` 逐行对齐比较，缺行 / 多出 / 语义差异都记为 diff，失败 exit 1。

```sh
node scripts/replay.mjs --replay                                  # 自检：fixture 自比 + 扰动注入 + 语义差异检出
node scripts/replay.mjs --replay --baseline <f> --actual <f>    # 比较两份 JSONL
node scripts/replay.mjs --record --source <f> [--out <f>]       # 录制规范化基线（无 --out 打印 stdout）
```

样例基线：`tests/fixtures/session-baseline.jsonl`（6 行会话事件，含易变字段）。

## 4. L3 真模型结构断言（C4-04）

`scripts/verify-l3.mjs` 读 `.env` 的 `WB_BASE_URL` / `WB_KEY` / `WB_MODEL`。

- **没有 key 时明确 SKIP 并 exit 0**（L3 每日 / 发版前跑，不进 PR）。
- 有 key 时启动宿主、建会话、投递一条要求用工具的任务，然后只看结构：

| 检查 | 是否硬断言 | 信号 |
|---|---|---|
| 工具调用发生 | 是 | 记忆条目文件出现 |
| 文件被改动 | 是 | 该文件非空 |
| 状态迁移到结束 | 是 | `session/page` 里出现 `turn/end` |
| 答复含链接 | 否（观测项） | 答复里出现 URL 或 markdown 链接 |

`evaluateStructure`（lib-models.mjs）统一求值。**绝不断言模型文本**：不检查
具体措辞、不检查是否提到某个词。链接是观测项，不阻断，避免模型某次不给链接就误红。

## 5. L4 评测集与评分（C4-05）

任务集 `tests/evals/agent-tasks.jsonl`：每行一个任务，`outcome` 里带
`completed` / `violation` / `noise` 三个结构信号（人工或夜间真模型跑后标注）。

`scoreEvals` 统计完成率 / 越权率 / 噪音率，只统计结构、不解析模型文本。
`npm run verify:l3 -- --l4` 输出评分表。真模型逐条执行器待接，
当前是离线评分管线 + 任务集，**不进 PR 门禁**。

## 6. L5 界面层骨架（C4-07）

`scripts/verify-l5.mjs` + `tests/e2e/desktop-flow.spec.ts`。

- **不安装 playwright / electron**；检测不到依赖时明确 SKIP 并 exit 0，不进 PR。
- 依赖齐全时执行 `npx playwright test tests/e2e`。
- 关键路径写成可运行规格：启动 → 首屏 → 会话 → 命令面板 → 剧本页 → 记忆页，
  另有一条串跑规格；截图基线目录 `tests/e2e/__screenshots__/`。

## 7. 门禁矩阵（C4-06）

| 时机 | 跑什么 | 需要 key |
|---|---|---|
| 每次 PR | 契约探针 + L0 + L1 + L2 + typecheck + check:ui + import 纪律 + 密钥扫描 | 零 |
| 每日 | L3 冒烟、L5 界面骨架 | L3 需要（缺则 SKIP） |
| 发版前 | L3 冒烟 + L4 抽样 | 需要 |
| harness 升级 | 按 docs/UPGRADE.md 的 8 步 | 需要 |

`.github/workflows/ci.yml` 用 `npm run <命令名>` 引用，不写死脚本路径。
`scripts/verify-gates.mjs` 是本地「门禁总检」：依次跑
check-port-discipline / check:secrets / typecheck / test / check:ui，
用 `summarizeGates` 汇总成一张表，exit 码正确（全通过 0，任一失败 1）。

## 8. import 纪律与密钥扫描

- `scripts/check-port-discipline.mjs`：除 `packages/harness-port/**` 外禁止
  import/require `@deepseek-ai/*`，禁止内部 `src` 路径。默认把已登记白名单
  （两个宿主插件入口，理由：必须用 `TypertRemoteService` 装饰器）列为 WARN 不阻断；
  `--strict` 才把这些也判失败。
- `scripts/check-secrets.mjs`（现有）：扫描受版本控制文件里的疑似密钥。

## 9. 退出码约定

| 脚本 | 0 | 1 | 2 |
|---|---|---|---|
| `check-port-discipline.mjs` | 无 error 级违规 | 有 error 级违规 | 用法/环境错误 |
| `llm-mock-server.mjs` | 自检通过 | 自检失败 | 用法/启动错误 |
| `replay.mjs` | diff 相等 | diff 失败 / 坏 JSONL | 用法/文件错误 |
| `verify-l3.mjs` | 通过或 SKIP | 结构断言失败 | 用法错误 |
| `verify-l5.mjs` | SKIP 或规格通过 | 规格失败 | 用法错误 |
| `verify-models.mjs` | 全部通过 | 有失败 | 用法错误 |
| `verify-gates.mjs` | 全部通过 | 至少一项失败 | 用法错误 |
| `upgrade-harness.mjs` | 计划打印完 / 全流程通过 | 任一步失败或版本不合法 | 用法/环境错误 |

## 10. 集成到根 package.json 的命令字符串

以下由集成方登记，本仓库不修改根 package.json：

| 命令名 | 精确命令字符串 |
|---|---|
| `verify:port-discipline` | `node scripts/check-port-discipline.mjs` |
| `test:model` | `node --test --experimental-transform-types packages/model-adapter-kit/tests/contract.test.ts packages/model-manager/tests/catalog.test.ts packages/model-manager/tests/credentials.test.ts tests/unit/tooling.test.ts` |
| `test:replay` | `node scripts/replay.mjs --replay` |
| `verify:mock-server` | `node scripts/llm-mock-server.mjs` |
| `verify:l3` | `node --experimental-transform-types scripts/verify-l3.mjs` |
| `verify:l5` | `node scripts/verify-l5.mjs` |
| `verify:models` | `node --experimental-transform-types scripts/verify-models.mjs` |
| `verify:gates` | `node scripts/verify-gates.mjs` |
| `upgrade:harness` | `node scripts/upgrade-harness.mjs` |

`upgrade:harness` 用 `npm run upgrade:harness -- 0.2.3` 传版本；
`verify:l3` 的 L4 子命令用 `npm run verify:l3 -- --l4`。
