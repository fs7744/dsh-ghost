# Skill / MCP / 插件市场 / 信息源：宿主给了什么，我们接了什么

> 依据：宿主安装包源码 + 真实宿主调用（`skills/list`、`pluginManager/*`、`pluginMarket/*`、
> `mcpManager/*`、`session/projections`）。本文的结论都带实测来源，不靠猜。

## 0. 四个问题速答

| 问题 | 答案 |
|---|---|
| 有 skill / MCP / harness 插件市场页面吗？ | **有，三个界面**：技能页、插件页（bundles / plugins / 市场）、设置页里的 MCP 服务区。但**本机没配市场索引**（`pluginMarket/listIndexes` → 404），所以市场区现在是「未配置索引 + 可填 URL」而不是空白。 |
| 能直接添加到我们程序吗？ | **能**。这些都是宿主 Remote，我们直接调：安装走 `pluginManager/installBundle`，启停走 `setBundleEnabled` / `setPluginEnabled`，MCP 走 `mcpManager/*`，技能走 `skills/list`。 |
| 有内置常用高质量 skill 吗？ | **有**：宿主自带 `office` / `office-docx` / `office-pptx` / `dsh-doc` / `diagnose-windows-sandbox-acl` 等，`modelInvocable: true`，模型可以直接调（工具表里有 `skill`）。 |
| 信息源有内置 API 或 MCP 模式吗？ | 原来**只有推送型**（webhook）。本轮**新增 API 拉取模式**；**MCP 拉取还没接**，原因与方案见 §4.3。 |

## 1. Skill

- 端点：`skills/list { request: { sessionId } }`
- 我们的界面：`apps/desktop/src/runtime-panels.ts` 的技能页；本轮补了 **「模型可直接调用」标记**
  与技能文件路径（宿主返回 `modelInvocable` / `path`）。
- 实测返回（节选）：

  ```json
  { "skills": [
    { "name": "diagnose-windows-sandbox-acl", "modelInvocable": true },
    { "name": "dsh-doc", "path": ".../dsh-agent-preset/skills/dsh-doc/SKILL.md", "modelInvocable": true },
    { "name": "office", "description": "Create or edit Office files; …", "modelInvocable": true },
    { "name": "office-docx", "modelInvocable": true },
    { "name": "office-pptx", "modelInvocable": true }
  ] }
  ```

- **模型怎么用**：宿主把技能注册成 `skill` 工具，模型调用即加载（工具表实测里有 `skill`）。
- **Claude/Anthropic 官方 skills 怎么接**：环境里**没有**直接打包 Anthropic 的官方仓库；
  宿主自带的是同名的 `office-*` 系列。想要官方原版，把
  `skills/<name>/SKILL.md` 放进项目的 `skills/` 目录（`dsh-skill-filesystem` 默认扫描
  project 根的 `skills/`，也支持自定义根目录），或通过 MCP 接入。
  我们**不把第三方仓库内容打进产物**——许可与更新都不在我们手里。

## 2. MCP

- 宿主能力：`dsh-mcp-client` 把 MCP 服务器的**工具注册到 `ctx.tools`**（模型可见），
  `dsh-mcp-manager` 管理连接。
- 我们的界面：设置页的 MCP 服务区（`mcpManager/watch`），本轮补了
  **探测（`mcpManager/probe`）** 与 **重启（`mcpManager/restart`）** 按钮。
- MCP 服务器的配置归宿主（profile / MCP 管理器），我们程序**只读状态 + 触发探测/重启**，
  不托管 MCP 配置。

## 3. 插件市场

- 端点：`pluginManager/listBundles|listPlugins|setBundleEnabled|setPluginEnabled|installBundle`、
  `pluginMarket/listIndexes|search|setIndexes|readEntryDetail`、`pluginInventory/list`。
- 实测：`listBundles` 与 `listPlugins` 可用（能列 bundle 与插件、能启停）；
  **`listIndexes` 返回 404**——本机没配索引。
- 本轮改动：市场区改为**自动查索引 → 自动搜索 → 展示可安装项**；没有索引时明说
  「还没配置市场索引」，并给一个输入框 → `pluginMarket/setIndexes` 添加索引后再搜。
  之前这里永远是一块空白（只写了 `<div class="empty">`）。

## 4. 信息源

### 4.1 现状（推送型）

`packages/source-hub` 的四种来源全是**别人推给你**：

| kind | 用途 |
|---|---|
| `github` | GitHub webhook（签名校验） |
| `generic` | 声明式 webhook（`mapping` 模板，不需要写代码） |
| `custom` | 用户 `.mjs` mapper |
| `passthrough` | 归一化事件直投 |

### 4.2 新增：API 拉取模式（本轮）

很多数据源只给查询接口（Jira 搜索、Issues 列表、内部工单），没人来推 webhook。
所以 `SourceSpec` 加了 `pull` 配置：

```yaml
- id: issues
  kind: api
  pull:
    url: https://api.example.com/issues?state=open
    method: GET
    headers:
      authorization: env:ISSUES_TOKEN      # 值写 env:NAME，不落明文
    listPath: data.items                   # 数组在响应里的路径
    intervalMinutes: 5
  mapping:
    fields:
      threadId: '{{id}}'
      text: '{{title}}'
```

实现要点：

- 拉到的响应被包装成 `SourceRequest`，**走同一套 mapping 与鉴权校验**，
  产出同样的 `NormalizedEvent` → 开票。所以「怎么把一条数据变成票」只写一次。
- 凭据只认 `env:NAME`，明文密钥被拒（与配置块同一把尺子）。
- 插件按 `intervalMinutes` / `intervalSeconds` 轮询；拉取失败只记日志，不打断其他来源。
- 测试：`packages/source-hub/tests/pull.test.ts`（5 个：env 取值、整段/列表拆分、失败给原因、
  鉴权头）+ `packages/orchestrator-plugin/tests/plugin.test.ts`（真拉一次 → 真的变成票）。

### 4.3 MCP 拉取：还没做，原因与方案

宿主的 MCP 能力是「**把 MCP 工具注册给模型**」（`dsh-mcp-client` → `ctx.tools`），
**没有**给插件「按名字调用某个 MCP 服务器的工具」的服务通道。
所以想做「MCP 模式的信息源」，得自己实现一个 MCP 客户端（stdio / streamable http）
并引入 SDK，还要处理工具结果的归一化。

结论：**这轮不做**。理由是它会引入一个新依赖与一套连接生命周期管理，
而当前需求（Jira/工单/Issues 轮询）用 HTTP 拉取已经覆盖；
要做时应作为独立任务，带连接池、超时与失败退避，而不是顺手塞进来源适配器。

## 5. 验证

- `npm run test:skills-market`（2 个）：技能行保留 `path` / `modelInvocable`；市场行保留版本与地址。
- `npm run test:hub`（含 pull 5 个）、`npm run test:orchestrator`（拉取 → 票）。
- 真实宿主：`skills/list` 返回内置技能；`pluginManager/listBundles` 可用；`pluginMarket/listIndexes` 404（已据此改界面）。
