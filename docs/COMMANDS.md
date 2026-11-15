# 命令与上下文管理（对齐 Claude）

> Claude 里那些"天天用"的东西——斜杠命令、压缩、回退、导出——我们必须有。好消息是**底层 harness 几乎全给了**，我们要做的是**自己的命令面板 + 接线**，不是重写能力。

## 1. 命令通道：harness 已暴露成 Remote

`@deepseek-ai/dsh-commands` 是"人类斜杠命令"注册表，**执行不产生模型消息**（不浪费 token），并且已经通过 Remote 暴露：

| 端点 | 用途 |
|---|---|
| `commands/list` | 列出某个 agent 的有效命令（含参数提示、是否接收附件） |
| `commands/execute` | 执行一行 `/cmd args`，返回 settled 结果 |

两条重要性质：

1. **不产生模型消息**：命令与结果只进 session 日志，UI 在模型历史之外渲染。
2. **生命周期可审计**：`command/run` → `command/done` 两条日志，失败了也留下 `kind:'error'`。

## 2. 命令对照表（Claude → 我们）

| Claude | 用途 | 我们的实现 | 状态 |
|---|---|---|---|
| `/compact [焦点]` | 手动压缩上下文 | `dsh-command-compact`（走 `commands/execute`） | 白拿 |
| 自动压缩 | 接近上限时自动触发 | `dsh-compaction-basic`（阈值可配） | 白拿 |
| 工具结果裁剪 | 大结果不进正文 | `dsh-compaction-tool-result-pruner`（thresholdChars / head / tail） | 白拿 |
| 图片离位 | 老图片转引用 | `dsh-compaction-image-offload` | 白拿 |
| `/clear` | 开新会话 | `session/create` | 白拿 |
| `/resume` | 回到旧会话 | `session/list` + `session/page` | 白拿 |
| `/rewind`（checkpoint） | 回退到某条消息 | `session-checkpoint-policy` + `session/fork` | 白拿 + **UI 自建** |
| `/model` | 换模型 | `session/selectModel` + `session/modelCatalog` | 白拿 |
| `/status` | 会话状态 | `session/projections` | 白拿 |
| `/cost` | token 与花费 | `token-meter` + `session-stats` | 白拿 + UI 自建 |
| `/export` | 导出会话 | `session-query` / `session-log-export` | 白拿 + UI 自建 |
| `/init` | 生成项目说明 | **我们自建**：扫描仓库生成 `GHOST.md` 草案（= 项目记忆 L2 的种子） | 自建 |
| `/memory` | 查看/编辑记忆 | **我们自建**（见 [MEMORY.md](MEMORY.md)） | 自建 |
| `/review` | 代码评审 | **剧本**（playbook），不是命令 | 自建 |
| `/agents` | 子代理管理 | `tool-subagent` + `agent-preset` | 白拿 + UI 自建 |
| `/hooks` | 钩子 | `hooks-*`（Claude Code / Codex 兼容） | 白拿 |
| `/mcp` | MCP 管理 | `mcp-manager` | 白拿 + UI 自建 |
| `!` bash 直通 | 直接跑命令 | bash/pwsh 工具；建议做成"命令面板里的一个动作" | 白拿 |
| `@` 文件引用 | 引用文件/目录 | `file-reference` + `session/attachment` | 白拿 |
| TodoWrite | 待办 | `tool-todo` | 白拿 + 卡片自建 |
| Plan mode | 先出计划再执行 | `plan-mode` | 白拿 + UI 自建 |
| 子代理 / Task | 派生执行 | `tool-subagent` | 白拿 + 视图自建 |
| Skills | 技能 | `skill` + 我们的剧本包 | 白拿 + 编辑器自建 |

**结论：能力全在，缺的是"我们的入口"。** 所以 C 类要补的是命令面板与几个视图，不是重写压缩算法。

## 3. 上下文管理：三层策略

| 层 | 何时 | 由谁 | 我们的可控点 |
|---|---|---|---|
| 裁剪 | 每条工具结果过大 | `compaction-tool-result-pruner` | 三个阈值（正文阈值 / 头部保留 / 尾部保留） |
| 压缩 | 上下文接近窗口上限 | `compaction-basic` | 触发阈值、保留策略、压缩后注入什么 |
| 离位 | 老图片/大附件 | `compaction-image-offload` | 保留最近几张 |

**压缩必须"看得见"**：UI 上要有一条上下文占用条，标出"这里压缩过一次"，点开能看到被压掉的原文——否则用户永远不敢让它长跑。这条是我们的**产品差异**，不是 harness 能力。

## 4. 我们要建的 7 项（进 FEATURES C11）

1. 命令面板与斜杠输入（列表、搜索、参数提示、附件）
2. 命令执行通道（接 `commands/list` + `commands/execute`）
3. 压缩策略配置（阈值、保留、手动 `/compact` 带焦点）
4. 上下文占用条 + 压缩点标记（可展开看原文）
5. Checkpoint / rewind UI（回退到某条消息）
6. 会话导出（Markdown / JSONL）
7. `/init` 等价物：扫描仓库生成 `GHOST.md` 草案

## 4.1 已落地的 MVP（C11-01 / C11-02）

**C11-02 命令通道**：`commands/list` + `commands/execute` 已验通（本地宿主返回 6 条命令，`/compact` 返回 `success`）。

**C11-01 命令面板基础版**：纯逻辑在 `apps/desktop/src/palette.ts`，UI 在 `apps/desktop/src/command-palette.ts`。

- 输入 `/` 浮出候选，搜索按「精确 → 前缀 → 包含 → 子序列 → 描述命中」排序；↑↓ 选择、Enter / Tab 执行、Esc 关闭。
- 命令清单来自 `commands/list`（切换会话时刷新），**不在前端硬编码命令名**；带 `input.hint` 的命令先把 `/name ` 留在输入框让用户补参数。
- 参数提示、是否接收附件、附件提交接口（`submittedAttachments`）都已接；附件选择 UI 待补。
- **斜杠输入绝不进模型消息**：`send()` 识别 `/` 开头后改走 `commands/execute`。验收实测执行 `/compact` 前后 `user/message` 数量 `0 → 0`。

验收命令：`npm run test:palette`（12 个用例）、`npm run verify:command-palette`（真实宿主：6 条命令 → 过滤 → 执行 → 无模型消息）。

**C11-06 会话导出**：`apps/desktop/src/session-log.ts` 把 `toBubbles` 从 `main.ts` 抽成纯模块（界面、导出、验收共用一份解析），`export.ts` 提供 Markdown / JSONL，顶栏两个按钮直接下载。Markdown 从视图模型生成（与界面看到的完全一致），JSONL 保留 `session/page` 原始记录、一行一条不丢字段；代码围栏长度自适应，正文里的 ``` 不会撑破格式。斜杠命令的 `command/run` 也渲染成 note，导出里看得见执行过什么。验收：`npm run verify:session-export`（真实宿主 5 条记录 → 两种格式落盘）、`npm run test:session-log` + `npm run test:export`（15 个用例）。

**边界**：`!` shell 直通与 `@` 文件引用目前只做**识别与提示**——完整直通要终端面板、文件选择要文件树，都属 P3；不在 MVP 里假装支持。

## 5. 不做

- 不做自定义命令 DSL 让用户写脚本（先只支持插件注册与剧本）。
- 不做 `/cost` 的账单级计费（只显示 token 与估算成本）。
- 不复制 Claude 的命令名——用中文/英文双语显示名，内部仍用 harness 的命令名。
