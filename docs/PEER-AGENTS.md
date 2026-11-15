# 外部 agent 协作（agent-to-agent）

> 回答「能做到 agent to agent 吗？比如 Claude / Codex / 豆包 / WorkBuddy 当成一个 agent 程序与它一起做事情」
> 结论：**能**。它们被登记成「同事」（peer），模型可以把任务交给它们，拿回产出再自己判断。

## 0. 三种接法

| 接法 | 适合谁 | 怎么接 |
|---|---|---|
| **cli** | Claude Code、Codex CLI 这类命令行程序 | 填 `command` + `args`（可用 `{prompt}` 占位）或走 stdin |
| **http** | 自建/第三方的 JSON 服务 | 填 URL；请求体 `{prompt, context}`，响应认 `output`/`text`/`reply`/`result`/`content` |
| **a2a** | 讲 Google **Agent2Agent** 协议的对端 | 填 URL；我们发 `message/send`，解析 `artifacts` / `status.message` 的文本部分 |

## 1. 怎么登记

界面：**设置 → 外部 agent（同事）** → 填 id / 显示名 / 接法 / command 或 URL / args / 「擅长什么」。

也可以直接写 `.ghost/peers.json`：

```json
[
  {
    "id": "claude",
    "label": "Claude Code",
    "kind": "cli",
    "command": "claude",
    "args": ["-p", "{prompt}"],
    "description": "擅长读代码库并给出改动建议。"
  },
  {
    "id": "codex",
    "label": "Codex CLI",
    "kind": "cli",
    "command": "codex",
    "args": ["exec", "{prompt}"],
    "promptVia": "argv"
  },
  {
    "id": "peer-http",
    "label": "内部 HTTP agent",
    "kind": "http",
    "url": "http://127.0.0.1:9000/tasks"
  },
  {
    "id": "peer-a2a",
    "label": "A2A 对端",
    "kind": "a2a",
    "url": "http://127.0.0.1:9001/",
    "cardUrl": "http://127.0.0.1:9001/.well-known/agent.json"
  }
]
```

## 2. 模型怎么用

两个工具：

| 工具 | 作用 |
|---|---|
| `agent_peers()` | 列出有哪些同事可用（id、名称、接法、擅长什么） |
| `agent_delegate(peer, task, context?)` | 把一件事交给某个同事，返回他的产出 |

**同事的产出只是参考材料**——主 agent 自己判断要不要采纳、要不要验证、要不要再跑一遍。
我们不替同事做决定，也**不会自动执行同事建议的动作**（那等于让别人替我们动手，用户没授权过）。

典型用法：
- 「让 Claude Code 也看看这个 bug 怎么修」→ delegate 一次，比较两边的结论；
- 「用 Codex 跑一遍测试」→ delegate 后拿它的结论，再由我们决定是否采信；
- 「请 A2A 对端复核这份结果」→ delegate 到 a2a peer。

## 3. 边界与安全

- **不内置任何厂商端点**：命令与地址都由**用户自己配**（本机）。我们不预置 Claude/Codex/豆包的接入细节，
  因为它们的 CLI 参数会变，我们不替它们背书。
- **执行用 `execFile`（参数数组，不经 shell）**：提示词作为独立参数或 stdin 传入，
  **不做字符串拼接** → 没有注入面。
- **超时**：默认 5 分钟，超时给的是人话原因（不是挂死）。
- **peer 的输出会进入会话上下文**：所以 peer 的产出可能很长时会被截断（8000 字）。
- **不是双向协议**：我们目前是「单次委托 → 一次产出」的**一问一答**；
  真正的多轮 agent 协议（双方都能主动发消息、共享任务状态）需要实现 A2A 的 task 生命周期，
  那是更大的工程（见 §6）。

## 4. 和宿主自带的多 agent 什么关系

宿主有自己的 `subagents`（开子会话）与 `agentTeams`（开团队模式）——那是**我们自己这条模型栈**
的分工；本文件说的是**外部 agent 程序**。两者可以叠加：主 agent 既能派活给自己的子 agent，
也能派活给外部同事。

## 5. 验收

`npm run verify:peers`（真实宿主 + 假 peer）：

```
PASS  登记 peer 成功
PASS  宿主里能读到登记的 peer
PASS  模型侧看到了 agent_peers 工具
PASS  模型侧看到了 agent_delegate 工具
PASS  peer 执行成功：同事产出:做一件事
```

`npm run test:peer-agent`：8 个用例——配置校验、CLI 参数拼装（`{prompt}` 占位/追加/stdin）、
HTTP 输出解析、A2A 输出解析、真跑 CLI peer（用 node 当假 agent）、真跑 HTTP peer、失败给原因。

## 6. 还没做的（如实登记）

- **多轮 A2A**：我们只做了 `message/send` 的一问一答，没有实现 task 生命周期
  （`tasks/get` 轮询、流式部分结果、双方共享任务状态）。
- **peer 主动推送**：外部 agent 不能主动给我们发消息（我们不会监听它的回调地址）。
- **peer 发现**：不会去扫端口找 A2A 对端；要手动填地址（或用 `cardUrl` 拉一次卡片看能力）。
- **内置厂商预设**：没有预置 Claude/Codex/豆包的参数模板——它们的 CLI 形态变化快，
  预置了反而误导；文档里给了例子，用户照着填即可。

## 7. 相关文件

| 文件 | 作用 |
|---|---|
| `packages/peer-agent/src/peers.ts` | 三种接法的适配与解析（纯逻辑 + 执行） |
| `packages/peer-agent-plugin/src/index.ts` | 宿主插件：`agent_peers` / `agent_delegate` 工具 + `ghostPeers/*` |
| `apps/desktop/src/admin-panels.ts` | 设置页「外部 agent」分区 |
| `scripts/verify-peers.mjs` | 端到端验收 |
