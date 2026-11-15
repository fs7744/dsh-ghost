# 信息源：可插拔、可配置、可自定义

> 配套 [PLAN.md](../PLAN.md)。这里回答：**外部事件怎么进来，以及用户怎么接自己的系统。**

## 1. 为什么不写死

主动引擎的输入来自四面八方：GitHub issue/PR、GitLab、企业 IM、邮件、工单系统、
自建 webhook、定时脚本……每家的 payload 结构、事件名、签名方式都不一样。
把它们硬编码进引擎，等于每接一家就改一次核心代码。

所以引擎只认一个**归一化事件**：

```ts
interface NormalizedEvent {
  source: string      // 来源名
  threadId: string    // 同一讨论串的事件聚到一张票
  text: string        // 正文
  human?: boolean     // 是否人写的
  addressed?: boolean // 是否点名了 agent
  url?: string
  actor?: string
  channel?: { source: string; thread: string; address: Record<string, string> }
}
```

`channel` 很关键：票跑完后 Outbox 据此把结果**回写到原会话**（例如 GitHub issue 编号）。
不带 channel 的事件照样能开票，只是不会自动回复。

链路一句话：**原始投递 → 签名校验 → 适配器归一化 → `ghostTickets/accept` → 票**。
适配器之上是注册表，注册表由配置生成，引擎完全不知道来源是谁。

## 2. 三种自定义方式

| 方式 | `kind` | 适用 | 要不要写代码 |
|---|---|---|---|
| 内置适配器 | `github` / `passthrough` | 已有现成映射 | 不要 |
| 声明式映射 | `generic` | 任意 JSON webhook | **不要，只写配置** |
| 用户 mapper | `custom` | 结构复杂、要计算/查表/多事件拆分 | 写一个 `.mjs` 文件 |

### 2.1 内置适配器

- `github`：复用 `packages/source-github` 的 `toTriggers`，支持 issue / PR / 评论 / review，
  机器人标 `human:false`，被 @ 标 `addressed`，并带出 `channel.address.number`。
- `passthrough`：上游已经归一化好，直接收 `NormalizedEvent` 或它的数组。

### 2.2 声明式映射（最常用）

任何返回 JSON 的 webhook，只要字段能取到，就能只靠配置接进来：

```yaml
- id: forum
  kind: generic
  auth:
    type: token
    header: x-forum-token
    valueEnv: HUB_FORUM_TOKEN        # 令牌从环境变量读，不写进配置
  mapping:
    eventHeader: x-source-event      # 事件名从哪个头取（省略用 request.event）
    events: [message.created]        # 只处理这些事件
    where:                           # 全部满足才产出
      - path: payload.kind
        equals: question
    fields:
      threadId: '{{payload.conversation}}#{{payload.id}}'
      text: '{{payload.body}}'
      actor: '{{payload.sender}}'
      human: '{{payload.isHuman}}'   # 渲染结果等于 "true" 即为真
      addressed:
        contains: ['@ghost']         # 正文含任一别名即算点名
      channel:
        thread: '{{payload.conversation}}'
        address:
          number: '{{payload.id}}'
```

模板语法：

| 写法 | 取什么 |
|---|---|
| `{{a.b.c}}` | body 的点路径，支持嵌套 |
| `{{headers.x-foo}}` | 请求头（小写） |
| `{{event}}` | 事件名 |
| 取不到 | 渲染成空串；对象渲染成 JSON |

`threadId` 或 `text` 为空时不产出事件，避免空票。

### 2.3 用户自定义 mapper

写一个 `.mjs`，默认导出函数，把路径填进 `mapper`：

```js
export default function map({ headers, rawBody, body, event, options }) {
  if (body.type !== 'im.message') return []
  return [{
    source: 'my-im',
    threadId: `im:${body.room}:${body.thread ?? 'main'}`,
    text: String(body.text ?? ''),
    human: body.from?.bot !== true,
    addressed: String(body.text ?? '').includes(options.mention ?? '@ghost'),
    actor: String(body.from?.name ?? 'unknown'),
    channel: { source: 'my-im', thread: `im:${body.room}`, address: { room: String(body.room) } },
  }]
}
```

```yaml
- id: mine
  kind: custom
  options: { mention: '@ghost' }
  mapper: 'D:/code/dsh-ghost/packages/source-hub/examples/im.mjs'
```

返回 0~n 条事件：一个 webhook 可以拆成多张票，也可以整批忽略。
宿主在第一次用到该来源时 `import()` 这个文件，改文件后重启宿主即可生效。
完整可改的示例在 `packages/source-hub/examples/im.mjs`。

## 3. 签名与鉴权

`auth` 三种，头名、算法、前缀全部可配：

| type | 行为 |
|---|---|
| `hmac` | 用 `rawBody` 算 HMAC，与指定头比对（恒定时间比较）；`secretEnv` 或 `secret` |
| `token` | 指定头的值与 `valueEnv` / `value` 比对 |
| `none` / 省略 | 不校验（仅限内网/本地调试） |

> **必须传 `rawBody`**：HMAC 校验的是原始字节，重新序列化 JSON 必然失配。
> `ghostSources/ingest` 的 `rawBody` 省略时会用 `JSON.stringify(body)` 兜底，
> 只适合不校验签名的来源。

密钥一律用 `*Env` 指向环境变量（`GH_WEBHOOK_SECRET`、`HUB_FORUM_TOKEN`…），
`cordis.patch.yml` 里不出现明文；`npm run check:secrets` 会守这一条。

## 4. 对外接口

| Remote | 参数 | 返回 |
|---|---|---|
| `ghostSources/list` | 无 | `{ items: [{ id, kind, description, auth }] }`，不含密钥 |
| `ghostSources/ingest` | `{ sourceId, rawBody, body, headers?, event? }` | `{ accepted, ticketIds, reason? }` |
| `ghostTickets/accept` | 已归一化事件 | `{ ticketId }`（低层入口，保留兼容） |

`ingest` 拒绝时 `accepted:0` 并给 `reason`：`unknown-source`、`missing-signature`、
`digest-mismatch`、`missing-token`、`secret-not-configured` 等。

## 5. 加一个新内置适配器

只有「多家都要用、且映射逻辑复杂到声明式写不出来」才需要：在
`packages/source-hub/src/adapters.ts` 里加一个 `SourceAdapter`（实现
`normalize(request, spec, context) → NormalizedEvent[]`），在 `adapterFor()` 注册，
`SourceSpec['kind']` 加一个字面量，补一个单测。其余链路零改动。

## 6. 安全边界

- **无人值守**：headless 验收会设 `DSH_PERMISSION_MODE=danger-full-access`，
  把审批策略变成 `never`，否则模型调用需审批的工具时会停在 `approval/asked` 永远不结束。
  桌面 UI 走 `workspace-write`，保留人工审批闸门——不要在生产桌面端照抄这个设置。
- 外部正文是**不可信数据**：只作为票标题/正文，绝不拼进命令或配置。
- `human:false` 的机器人消息与 `addressed:false` 的旁观消息由上游策略决定是否挡在门外。

## 7. 验收

```bash
npm run test:hub           # 模板、签名、四种适配器、注册表（9 个用例）
npm run verify:source-hub  # 同一宿主挂三种来源，真实 Remote 投递
```

标准配置模板在 `scripts/cordis.patch.template.yml`，由 `scripts/lib-driver.mjs`
每次启动前落盘；不要直接改 `.dsh-home` 里的副本。
