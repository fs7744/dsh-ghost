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

实现：`packages/economizer/src/brief.ts` + 编排插件开票时注入。

- 数据源：`.ghost/memory/MEMORY.md`（索引，每行一条名字+标题）。
- 触发门槛：**至少 3 条**才注入，避免为两条笔记白付 header。
- 预算：默认 **1200 字符**（约 300 token），按行裁剪，不切半个条目。
- 内容只有索引，正文仍用 `memory_read`；模型开局就知道“以前定过什么”，不用先 `memory_list` 再逐条读。
- 空记忆 / 读不到文件时**原样返回任务**，零额外 token。

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

### 4. 工具结果截断

`truncateToolResult` 默认 **12000 字符**（约 3k token）。超长结果只留头部，并注明原文长度与“用更精确查询”的提示。

## 配置

编排插件 `ghost-orchestrator`：

| 键 | 默认 | 说明 |
|---|---|---|
| `briefFile` | `<stateFile 目录>/memory/MEMORY.md` | 前置简报来源；指向空文件即关闭 |
| `toolPrune` | `true` | `false` 关闭自动剪枝（账本仍记录） |
| `keepTools` | `[]` | 永不剪的工具名 |
| `maxToolResultChars` | `12000` | 单次工具结果上限 |
| `loopGuard` | `true` | `false` 关闭重复失败提示 |

## 不做什么（保持诚实）

- **不压缩历史**：上下文压缩是 harness 的 `/compact` 与 `evolution/compaction` 配置，两套东西不混。
- **不自动改用户 AGENTS.md / settings**：简报只读记忆索引；剪枝只影响本插件注册的可选工具。
- **不调 judge 模型**：循环判定是确定性的；TokenEconomizer 的 judge 置信度机制没有照搬。
- **没有真实成本基准**：暂无“省了 X%”的实测数字，只有定义体积与注入预算的静态估算；等有稳定的真实会话样本再补。

## 验证

- `npm run test:economizer`：9 个纯逻辑用例（剪枝门槛/观察期/恢复、简报门槛/预算、循环归一化、截断边界）。
- 编排插件接入后，`npm run test:shell` / `verify:all -- --only=local` 仍全绿。
