# Token 节省（借鉴 TokenEconomizer）

> 参考：[microsoft/TokenEconomizer](https://github.com/microsoft/TokenEconomizer)（Apache-2.0）。
> 只借鉴它验证过的三条经验，代码为本项目独立实现；没有引入它的运行时、Python 依赖或插件。

## 为什么需要

编码 agent 的固定成本不是“模型不会写”，而是每次都重复付：

1. **同一仓库的同一事实**被反复发现（构建命令、环境变量、坑）；
2. **从来没被调用的工具定义**随每个请求一起发送；
3. **同一个失败**在同一回合反复撞，烧掉多轮上下文。

TokenEconomizer 的结论是：不改模型、不改 agent，只从历史会话学习，就能在 SWE-Bench 上省 18–31%，且多数组合成功率不降。本项目把它落到宿主插件与工具层。

## 已实现

### 1. 会话前置简报（对标 micro-skills）

实现：`packages/economizer/src/brief.ts` + `ghostMemory/brief` Remote + 桌面聊天/开票两条路径都注入。

- 数据源：`.ghost/memory/MEMORY.md`（索引，每行一条名字+标题）。
- 触发门槛：**至少 3 条**才注入，避免为两条笔记白付 header。
- 预算：默认 **1200 字符**（约 300 token），按行裁剪，不切半个条目。
- 内容只有索引，正文仍用 `memory_read`；模型开局就知道“以前定过什么”，不用先 `memory_list` 再逐条读。
- 空记忆 / 读不到文件时**原样返回任务**，零额外 token。
- **普通聊天也前置了**（`apps/desktop/src/chat-context.ts` 的 `composeChatMessage`）：
  用户原话在前、记忆块在后；开票路径仍用 `buildSessionBrief`。

### 2. 工具剪枝（对标 tool pruning）

实现：`packages/economizer/src/tool-prune.ts` + 编排插件注册前过滤。

只剪“锦上添花”的 8 个可选工具：

`settings_save` / `policy_sync` / `prompts_save` / `eval` / `eval_read` / `eval_decide` / `thread_unsubscribe` / `ticket_note`

判定同时满足才剪：

- 至少经历 **5 次宿主启动**；
- 首次见到该工具已超过 **7 天**；
- 期间 **调用次数为 0**；
- 没被人工 `restore`。

核心票据、报告、读取、路由工具永不剪。账本在 `.ghost/tool-usage.json`；`disabled` 是人工确认的停用名单，`restore` 会同时移除并打上永久保留标记。可逆：

```bash
npm run economizer:status              # 看调用次数/启动轮次/disabled
npm run economizer -- prune --dry-run # 只看会被剪哪些
npm run economizer -- prune           # 写入 disabled，下次宿主启动生效
npm run economizer -- restore orchestrator_eval  # 恢复，并永久免疫自动剪枝
```

节省量：这 8 个工具的定义约 **2227 字符（≈557 token）/ 请求**；多轮会话按请求数线性放大。

### 3. 工具结果截断与重复提醒：**已删除我们的实现，只用宿主的**

宿主 `dsh-compaction-tool-result-pruner`（`8192/4096/1024`）和 `dsh-repeat-tool-reminder`
（`3/5/8`）默认就开着。我们原来的 `truncateToolResult` 与 `LoopGuard` 已**从代码里删除**：
两层都做只会更粗、还抢在宿主前面；重复提醒也该由宿主统一口径。

### 4. 上下文提醒（压缩由宿主做，我们只提醒）

实现：`packages/economizer/src/compaction.ts`（读宿主真实用量）+ `apps/desktop/src/chat-context.ts`。

- **宿主已经自动压缩**：`dsh-compaction-basic` 在 `thresholdRatio 0.8` 时自动压缩，
  `/compact` 由 `dsh-command-compact` 提供（Claude Code / Codex / Cursor 同一套做法）。
  所以我们**不再自动触发**——重复触发一次就是多花一次模型调用。
- 我们改做两件事：
  - 读宿主 `session/projections` 的**真实用量**（`tokenUsage` 含缓存读写、
    `contextPressure` 含压力、`contextBreakdown` 拆系统/工具/消息），不再自己瞎估；
  - 到 **90%**（`localStorage.dsh-ghost.compactHintRatio` 可调）才在状态栏提醒
    「上下文已到 X%，建议 /compact」，并保留手动压缩入口。
- 拿不到投影时**不猜、不提醒**。

### 5. 成本看板（统计页）

`apps/desktop/src/stats-cost.ts` + `feedback.ts`：统计页现在显示
**未缓存输入 / 缓存读 / 缓存写 / 输出 / 缓存命中率**（都来自宿主真实用量），
金额只有用户填了单价才显示（单价存在 `localStorage.dsh-ghost.pricing`，
JSON：`{"inputPerMillion":3,"outputPerMillion":15,"cacheReadPerMillion":0.3,"cacheWritePerMillion":3.75}`）。

**没配单价就只显示 token，不显示金额**——宿主不提供价格表，编一个数字比不显示更糟。

### 6. 缓存感知成本换算

`packages/economizer/src/cost.ts` 的 `estimateCost(usage, pricing)`：把宿主的
`uncachedInputTokens` / `cacheReadTokens` / `cacheWriteTokens` / `outputTokens`
按给定单价换算成钱，并给出缓存命中率。**价格由调用方给**，没给价格就返回 0，
宁可显示 token 也不显示拍脑袋的钱。

### 6. 凭据护栏（顺带省 token）

实现：`packages/economizer/src/redact.ts`（纯逻辑，编排与桌面端共用）。

- **写盘前拦**：`settings_save` 拒写明文密钥（`token` / `secret` / `apiKey` 等键），
  必须改成指向环境变量（`tokenEnv: 'GITHUB_TOKEN'`）——否则它会同时进磁盘、视图文本和上下文。
- **显示前洗**：所有面板视图文本、桌面端审批卡的标题与细节统一把敏感值换成 `***`；
  顺带少占 token（长密钥没必要进上下文）。
- 端到端验收：`npm run verify:ai-config`（AI 改配置落盘 + 明文密钥被拒且不回显）。

## 配置

编排插件 `ghost-orchestrator`：

| 键 | 默认 | 说明 |
|---|---|---|
| `briefFile` | `<stateFile 目录>/memory/MEMORY.md` | 前置简报来源；指向空文件即关闭 |
| `toolPrune` | `true` | `false` 关闭自动剪枝（账本仍记录） |
| `keepTools` | `[]` | 永不剪的工具名 |
| `maxToolResultChars` | `0`（关闭） | 宿主 pruner 已做；仅宿主不可用时开 |
| `loopGuard` | `true` | `false` 关闭重复失败提示 |

桌面端（localStorage）：

| 键 | 默认 | 说明 |
|---|---|---|
| `dsh-ghost.compactHintRatio` | `0.9` | 上下文提醒阈值（宿主 0.8 已自动压） |

## 不做什么（保持诚实）

- **不自己实现压缩算法**：就地压缩由宿主完成；我们只读真实用量并提醒。
- **不自己实现 token 计量**：宿主 `token-meter` 已经是真实值，估算只做兜底。
- **不自研就地摘要**：宿主没暴露改写历史的接口（`session/page` 只读、`session/prompt` 只追加）。
- **不新开会话**：换会话会断掉宿主侧连续性与工具状态，代价大于省下的 token。
- **不自动改用户 AGENTS.md / settings**：简报只读记忆索引；剪枝只影响本插件注册的可选工具。
- **不调 judge 模型**：循环判定是确定性的；TokenEconomizer 的 judge 置信度机制没有照搬。
- **没有端到端成本基准**：`measure:tokens` 量的是**请求固定开销**（工具定义），
  会话历史的节省还没实测（需要真实模型样本）。

## 验证

- `npm run test:economizer`：12 个纯逻辑用例（剪枝门槛/观察期/恢复、简报门槛/预算、
  宿主真实用量与提醒阈值、缓存感知成本、凭据脱敏）。
- `npm run test:chat-context`：4 个用例（记忆拼接、读宿主真实用量、
  宿主已压过时不重复提醒、拿不到投影不猜）。
- `npm run verify:ai-config`：端到端——AI 调配置工具落盘 + 明文密钥被拒、不落盘、不回显。
- `npm run measure:tokens`：真实抓包量「剪枝前 vs 剪枝后」的每请求固定开销。
- 编排插件接入后，`npm run verify:all -- --only=local` 仍全绿。

> 与宿主能力的逐项对照见 [HARNESS-AUDIT.md](HARNESS-AUDIT.md)。
