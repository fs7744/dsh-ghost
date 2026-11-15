# 与 harness 的能力对照（审计）

> 审计时间：2026-11-16。方法：读宿主安装包源码（`spikes/p05-transport/node_modules/@deepseek-ai/*`）
> + 在真实宿主里拉 `session/projections` 与 `commands/list`。
> 结论先行：**宿主已经把 token 这块做得很完整，我们之前有 3 处是重复造轮子，已收敛。**

## 宿主实测到的能力

`session/projections` 的 `values` 里直接给出：

```jsonc
{
  "tokenUsage": { "uncachedInputTokens": 0, "outputTokens": 0, "cacheReadTokens": 0, "cacheWriteTokens": 0 },
  "contextPressure": { "projectedTokens": 0, "contextWindow": 0 },
  "contextBreakdown": { "systemTokens": 0, "toolsTokens": 0, "messageTokens": 0 },
  "sessionStats": { "turns": 0, "steps": 0, "ttftMs": 0, "decodeTokens": 0 },
  "turnOutline": [], "todos": null, "plan": { "active": false }, "goal": null,
  "subagentCatalog": [], "agentTeam": { "enabled": false }, "permissions": { "currentValue": "…" }
}
```

`commands/list` 实测：`compact, export, feedback, goal, permission, plan`。

宿主 base bundle 里与 token 直接相关的插件（**默认全部启用**）：

| 宿主插件 | 作用 | 默认参数 |
|---|---|---|
| `dsh-token-meter` | 真实 token 计量（含缓存读写） | — |
| `dsh-compaction-basic` | 自动就地压缩 | `thresholdRatio 0.8` / `retainRatio 0.16` |
| `dsh-command-compact` | 人工 `/compact` | — |
| `dsh-compaction-tool-result-pruner` | 裁剪超长工具结果 | `thresholdChars 8192` / `head 4096` / `tail 1024` |
| `dsh-compaction-image-offload` | 图片超预算换成占位 | — |
| `dsh-spill-policy` + `dsh-spill-local` | 大输出落盘，不进上下文 | `maxInlineTokens 12500` |
| `dsh-repeat-tool-reminder` | 重复工具调用提醒 | `thresholds [3,5,8]` |
| `dsh-fs-observation-policy` | 文件观察/读后再写策略 | **默认 disabled** |

## 我们之前重复造的部分（已收敛）

| 我们原来的实现 | 宿主已有 | 现在的取舍 |
|---|---|---|
| 工具结果截断（12000 字符） | `tool-result-pruner`（8192/4096/1024） | **已删除自造实现**，只留宿主 |
| 自动触发 `/compact` | `compaction-basic` 已在 80% 自动压 | **不再自动触发**，改读真实压力，90% 才提醒（重复触发 = 多花一次模型调用） |
| 启发式 `estimateTokens` | `token-meter` 给真实 token | **改用真实投影**，估算只做兜底 |
| 失败循环提示 `LoopGuard` | `repeat-tool-reminder` 覆盖重复调用 | **已删除自造实现**，统一走宿主 |

## 仍然是我们独有的（宿主没有）

1. **工具定义剪枝**：宿主只裁结果，不裁**定义**；我们剪掉 8 个长期未用的可选工具
   （5 次启动 + 7 天观察 + 0 调用才剪，`npm run economizer -- prune` 可查可恢复）。
2. **动态记忆索引前置**：宿主 `dsh-agent-instructions` 只读静态 `AGENTS.md` / `CLAUDE.md`；
   我们按会话把动态的 `MEMORY.md` 索引压成小段前置（`ghostMemory/brief`）。
3. **缓存感知成本换算**：`estimateCost(usage, pricing)` 把宿主的 `cacheReadTokens` /
   `cacheWriteTokens` 换算成钱；价格由调用方给，**不猜**（没给价格就显示 token 不显示钱）。

## 明确不做

- 不自研就地压缩：宿主没暴露改写历史的接口（`session/page` 只读、`session/prompt` 只追加），
  「替换旧消息」物理上只有宿主能做。
- 不自研 token 计量：宿主 `token-meter` 已经是真实值。
- 不默认打开 `fs-observation-policy`：它会改变读写行为（读后再写、版本守卫），
  需要单独评估，不该顺手塞进省 token 改动里。

4. **凭据护栏**：配置拒写明文密钥 + 视图/审批卡统一脱敏（宿主有 `dsh-client-ui-secret-mask`，
   但那管的是它自己的凭据，管不到我们插件的配置块）。

## 仍然缺失（下一步候选）

- **成本看板**：桌面「统计」页现在只有 token 数，`estimateCost` 还没接进去。
- **会话历史的节省**：请求固定开销已有实测（`npm run measure:tokens`：剪枝省 ≈902 token/请求），
  但「历史压缩省了多少」仍无真实模型样本。
- **spill 阈值**：宿主 `maxInlineTokens 12500` 是否适合我们的场景，待用真实会话校准。
