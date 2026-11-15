# dsh-ghost

一个以 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 为内核的**主动型 agent 工作台**：它在你不在的时候干活，只在该有人动手时才说话。

> Built on DeepSeek Harness. Not affiliated with or endorsed by DeepSeek.

## 现在是什么状态

骨架期。**技术地基已全部验通**（不加载 harness 的任何 Web UI 也能取数、订阅事件、调用 224 个端点），产品代码刚刚开始。

| 已完成 | 说明 |
|---|---|
| 契约探针 | 131 项检查，`contract.json`，0.2.2-rc.3 全绿 |
| 通路 spike | 5/5：启动 → 换 Cookie → `POST /api/session/list` → 拿到真实数据 |
| 事件流 | `/api/remote.mux` + `$events` → `api-session/added` |
| 端点生成 | 39 个包 / **224 个 Remote 端点** → 类型化调用表 |
| `harness-port` | 传输层（调用 + 事件），零 `@deepseek-ai` 依赖 |
| `playbook` | `.flow` 解析 / 校验 / 编译成 skill 包（10 个测试全绿） |

## 文档

按这个顺序读：

1. [PLAN.md](PLAN.md) — 总纲：架构、分期、已定与待定
2. [docs/FEATURES.md](docs/FEATURES.md) — 227 项功能账本（白拿 / 移植 / 自建）
3. [docs/PLAYBOOK.md](docs/PLAYBOOK.md) — 剧本：图给人、文本给模型
4. [docs/MEMORY.md](docs/MEMORY.md) — 记忆与进化
5. [docs/COMMANDS.md](docs/COMMANDS.md) — 命令 / 压缩 / 回退 / 导出
6. [docs/UI-STYLE.md](docs/UI-STYLE.md) — UI 与交互规范
7. [docs/REVIEW.md](docs/REVIEW.md) — 评审：10 个风险与必改项
8. [docs/LICENSING.md](docs/LICENSING.md) — 许可证与商标

## 开发

```sh
npm install                       # 根依赖（typescript / ws / @types/node）
npm run verify:contract           # 契约探针，需要一份 harness 检出
npm run gen:remotes               # 重新生成 224 个端点的类型表
npm run verify:port               # harness-port 验收：取数 + 事件
npm run typecheck                 # tsc --noEmit

# 剧本
node --test --experimental-strip-types packages/playbook/tests/playbook.test.ts
node --experimental-strip-types scripts/compile-playbook.mjs packages/playbook/examples/ticket-flow.flow
```

`spikes/p05-transport/` 里有一份已安装的 `@deepseek-ai/dsh`（1.3GB，已被 gitignore），
供 `verify:port`、`gen:remotes` 与事件探针使用。

## 两条硬边界

1. **不改 harness**：harness 只升级；所有适配只发生在 `packages/harness-port`。
2. **界面自建**：不加载 harness 的 Web UI，也不用 superagent 原来的面板；只复用它的 Remote 契约。

## 许可

应用与内部包为专有；对外插件契约为 Apache-2.0；示例剧本为 MIT。详见 [docs/LICENSING.md](docs/LICENSING.md)。
上游 `deepseek-harness` 与 `dsh-superagent` 均为 MIT，其版权声明随分发保留。
