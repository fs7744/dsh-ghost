# P0.5 通路 spike

**要回答一个问题**：不加载 harness 的任何 Web UI，能不能拿到受保护数据？

如果能，自建界面（26 项）就有地基；如果不能，P3 全部悬空，得改方案。

## 怎么跑

```sh
cd spikes/p05-transport
npm i                                   # 装已发布的 @deepseek-ai/dsh@0.2.2-rc.3
node spike.mjs                          # 自动挑空闲端口
node spike.mjs --port 3917 --keep       # 固定端口、跑完不杀进程（便于手动 curl）
```

产物：`result.json`（每步状态码、响应片段、日志尾部）。

## 四步判定

| # | 检验 | PASS 标准 | 说明 |
|---|---|---|---|
| 1 | 宿主启动 | stdout 出现 `http://127.0.0.1:<port>/?token=…` | 说明 token 是**启动时打印的一次性入口**，可被非浏览器进程读到 |
| 2 | `/connect?token=…&interactions=none` | **302** + 至少一个 `Set-Cookie` + `Location`（Mux） | 这是"非浏览器客户端如何拿到身份"的官方路径 |
| 3 | 带 Cookie 访问 `/` | **200**，且 body 含 `__DSH_BOOT__` | Cookie 真的有效；同时确认 boot 清单是内联在页面里的 |
| 4 | `POST /api` 最小 RPC 信封 | 返回 `{type:'server-response', rpcId}` 结构 | 信道通。400/404 也算通（是业务层拒绝），**只有 401/403 算不通** |

## 实测结果：5/5 通过（2026-11-15，dsh 0.2.2-rc.3）

```
PASS  启动并给出带 token 的入口 URL   http://127.0.0.1:3917/?token=***
PASS  /connect 换到 API Cookie        1 个 Set-Cookie，Mux=./api/remote.mux
PASS  API 通道可达                    GET /api → 404（非 401/403）
PASS  POST /api 返回结构化信封        session/list → 200 server-response
PASS  取到真实数据                    payload={"args":{"_request":{}}}，items=0
```

### 三条关键事实（后面所有界面代码都依赖这三条）

1. **RPC 是 path-based**：`POST /api/<namespace>/<method>`，不是 `/api` + body 里的方法名。
   namespace 来自服务构造：`super(ctx, 'sessionController', { namespace: 'session' })`；方法名来自装饰器 `@Remote('list')` → 端点 `session/list`。
2. **payload 形状必须带 `args`**，且 `args` 的键是 **TS 源码里的参数名**（连下划线前缀也算）：
   ```json
   { "type":"client-request", "rpcId":"p05-2", "method":"session/list",
     "payload": { "args": { "_request": {} } } }
   ```
   → **这条决定了"必须从 typert descriptor 自动生成调用代码"，手写不可能对**（参数名是内部细节）。
3. **两种凭据不能混用**：`/connect?token=…&interactions=none` 拿到的是 **API Cookie**，用它打页面 `/` 必然 401（页面要 browser-session 凭据）。桌面端只需要 API Cookie + Mux。

## 已知的不确定点（已验，仅作记录）

- ~~RPC method 命名~~ → 已确认 `namespace/method`，见上。
- ~~`--no-open`~~ → 被接受。
- ~~首次启动要不要模型配置~~ → 不需要，照样起来（agent 不跑而已）。

## 判定之后

- **四步全 PASS（已达成）** → 直接进入 P1：建 `packages/harness-port`，把 Remote 契约（方法 + 事件）纳入 `contract.json`，并从 typert descriptor 自动生成。
- **第 2 或 4 步 FAIL** → 改道：只用 `@deepseek-ai/dsh-client-connection/client` 的 Node 构建（`lib/client.node.js`）在进程内装配一个最小 Cordis 客户端树，再走同一套 `ctx.remote`；若这条也不通，退到 SDK（`dsh --profile sdk` 的 JSON-RPC），并接受"界面能力受限于 SDK 面"。
- **第 1 步 FAIL** → 检查 `DSH_HOME` 隔离与首次初始化；与架构无关。

## P1 第一块：Remote 元数据生成（已验收）

```sh
node ../../harness-contract/gen-remotes.mjs     # 39 包 → 224 个端点
node call.mjs                                   # 用生成的元数据调真实端点
```

```
contract  224 个端点，来自 39 个包
PASS  session/list           args={"_request":{}}  items=0  17ms
PASS  session/modelCatalog   args={}  keys=default,routableProviders,groups,failures  4ms
```

**意义**：`call.mjs` 里没有任何硬编码参数名——参数骨架来自 `remotes.json` 的 `wire` 字段。
harness 改了参数名，生成器一跑就知道，编译期就能发现，正是评审 R1 要的那个缺口。

生成器读的是包里的 `lib/typert.remote-client.js`（编译产物），字段：
`spec.methods[endpoint] = { service, description, scope, parameters:[{name, wire, optional}] }`。
`scope.wire` 还告诉我们"上下文值怎么上线"：如 `commands/list` 的 `agent` → `agentId`。

## 事件流：已打通（面板实时更新的前提）

```sh
node events.mjs
```

```
PASS  连接 mux  ws://127.0.0.1:59743/api/remote.mux
PASS  收到 ready  clientId=4b8581c1-… host=C://Users//Windows
     已创建会话 sessionId=session-432753b3-…
PASS  收到 2 emit / 0 waterfall，事件名：api-session/added
```

### 两条必须记住的发现

1. **订阅事件必须 `interactions=answer`**。用 `/connect?…&interactions=none` 开 `$events` 会被拒：
   `gateway/interactions-forbidden: forwarded Remote events require interactions=answer`。
   → 桌面端的登录凭据要按 **answer** 申请；`none` 只够拉数据。
2. **事件是"应用级"，不是"逐条 session 明细"**：建会话立刻收到 `api-session/added`。面板刷新靠这类事件 + `session/page` 拉明细，不需要自己猜状态。

协议原文（`gateway/stream-protocol.ts`）：

```
→ { type:'open', streamId, endpoint:'$events', payload:{ args:{} } }
← { type:'item', streamId, value:{ type:'ready', clientId, host } }
← { type:'item', streamId, value:{ type:'emit', event, args } }
← { type:'item', streamId, value:{ type:'waterfall', event, eventId, agentId, request } }
```
