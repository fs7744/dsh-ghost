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

### 3. 失败循环短提示（对标 loop guard）

实现：`packages/economizer/src/loop-guard.ts` + 工具包装层。

- 不做 judge、不额外调模型。
- 只认「同一工具 + 同一错误」在 **10 分钟**内重复；文件名/数字/ID 会归一化。
- **第 2 次**才追加一行：“换参数、先读相关文件，或报告卡点，不要重复调用。”
- 工具成功一次即清零，不干扰正常试错。

### 4. 工具结果截断（默认交给宿主）

宿主 `dsh-compaction-tool-result-pruner` 已按 `thresholdChars 8192 / head 4096 / tail 1024`
裁剪超长工具结果，**比我们原来的 12000 字符更细**。所以我们的 `truncateToolResult`
默认**关闭**（`maxToolResultChars: 0`），只在宿主不可用时手动开——两层都裁只会更粗，
还抢在宿主前面。

### 5. 上下文提醒（压缩由宿主做，我们只提醒）

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

### 6. 缓存感知成本换算

`packages/economizer/src/cost.ts` 的 `estimateCost(usage, pricing)`：把宿主的
`uncachedInputTokens` / `cacheReadTokens` / `cacheWriteTokens` / `outputTokens`
按给定单价换算成钱，并给出缓存命中率。**价格由调用方给**，没给价格就返回 0，
宁可显示 token 也不显示拍脑袋的钱。

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
- **没有真实成本基准**：暂无“省了 X%”的实测数字，只有静态估算；等有稳定样本再补。

## 验证

- `npm run test:economizer`：15 个纯逻辑用例（剪枝门槛/观察期/恢复、简报门槛/预算、
  token 估算、触发计划、宿主真实用量与提醒阈值、缓存感知成本、循环归一化、截断边界）。
- `npm run test:chat-context`：5 个用例（记忆拼接、记录转消息、读宿主真实用量、
  宿主已压过时不重复提醒、拿不到投影不猜）。
- 编排插件接入后，`npm run verify:all -- --only=local` 仍全绿。

> 与宿主能力的逐项对照见 [HARNESS-AUDIT.md](HARNESS-AUDIT.md)。
