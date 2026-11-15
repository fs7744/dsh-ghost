# 用户扩展：加页面、改界面、加 LLM 服务（不改我们的代码）

> 回答「用户能通过制作配置插件在我们的 UI 加页面、改已有 UI、添加 LLM 服务吗？」
> 结论：**现在可以了**，做法是**放配置**（JSON），不是改代码、也不是塞脚本。

## 0. 三个能力与对应做法

| 能力 | 用户做什么 | 落点 |
|---|---|---|
| **加页面** | 在 `.ghost/ui/panels/<名字>.json` 放一份面板清单 | 桌面端多出一个页签，数据来自清单声明的宿主端点 |
| **改已有 UI** | 在 `.ghost/ui/slots/<名字>.json` 放一份插槽清单 | 注入聊天工具栏按钮 / 设置页分区 / 统计页附加行 |
| **加 LLM 服务** | 在设置页「LLM 服务」区填表，或写 `.ghost/ui/providers.json` | 校验通过后落盘；**下次启动宿主**写进 profile，宿主就能用这个 provider |

## 1. 为什么不做成「插件塞 JS」

扩展**不能**往界面里注入任意代码——那等于给每个装了我们程序的人开一个远程执行入口。
所以扩展只能声明两件事：

- 「数据去哪个宿主端点取」（`source.endpoint`）
- 「点了调哪个端点」（`endpoint`）

端点名必须是 `命名空间/方法` 形式；清单里的所有字段都要过
`@dsh-ghost/ui-extensions` 的校验，**非法项直接丢弃并给原因**，不静默生效。

## 2. 面板清单（加页面）

`.ghost/ui/panels/my-panel.json`：

```json
{
  "id": "my-panel",
  "title": "我的面板",
  "order": 20,
  "description": "一句话说明",
  "source": { "endpoint": "myPlugin/rows", "args": { "limit": 50 } },
  "columns": ["stage", "updated"]
}
```

- `id`：kebab-case，页签 id 用 `ext-<id>`，不与内置页冲突。
- `title`：页签上的字面标题（不经过 i18n，因为是用户自己写的）。
- `source.endpoint`：宿主 Remote 端点，返回数组或 `{items:[...]}` / `{rows:[...]}`。
- `columns`：行里显示哪些字段；不给就用 `name` / `description` 兜底。

端点返回一行数据长这样就会渲染成一行：

```json
{ "name": "票 A", "stage": "working", "updated": "2026-11-16" }
```

## 3. 插槽清单（改已有 UI）

`.ghost/ui/slots/my-slot.json`：

```json
{
  "slot": "chat.toolbar",
  "label": "打开我的面板",
  "description": "点一下打开面板",
  "endpoint": "myPlugin/open",
  "args": { "panel": "my-panel" }
}
```

允许的插槽只有三个（写错了会被丢弃并提示）：

| 插槽 | 出现在哪 |
|---|---|
| `chat.toolbar` | 聊天页上方的工具条 |
| `settings.sections` | 设置页的分区列表 |
| `stats.extra` | 统计页的附加内容 |

不写 `endpoint` 的条目就是纯展示（只出现，不触发）。

## 4. LLM 服务

### 界面路径
设置页 →「LLM 服务」区 → 填表 → 「登记服务」。

- 凭据字段填的是 **env 变量名**（如 `OLLAMA_KEY`），**不填明文密钥**——
  校验层直接拒绝疑似明文的值。
- 写的是 `.ghost/ui/providers.json`。

### 生效路径
`scripts/lib-driver.mjs` 渲染宿主 profile 时，会把 `providers.json` 注入
`llm-pi-ai.providers`（`{{PROVIDERS}}` 占位符），**下次启动宿主**生效。

证据（`npm run verify:ui-extensions`）：

```
PASS  ghostUI/panels 读到了用户放的面板
PASS  ghostUI/slots 读到了用户放的插槽
PASS  ghostUI/providers 读到了登记的 LLM 服务
PASS  新登记的 provider 已经进了宿主的模型目录（下次启动生效的链路打通）
```

顺带一个宿主行为：**凭据 env 不存在的 provider 不会出现在模型目录里**——
这正好说明「凭据只认 env 名」是端到端生效的，不是我们嘴上说说。

## 5. 也能用代码注册（给插件作者）

宿主插件可以直接调：

```ts
import { registerPanel, registerSlot } from '@dsh-ghost/ui-plugin'
registerPanel({ id: 'from-code', title: '代码注册的面板', source: { endpoint: 'myPlugin/rows' } })
```

配置与代码注册**合并**（同名去重，配置优先）。

## 6. 边界与现状

- 扩展只能调用**宿主 Remote 端点**；宿主没有的端点自然也调不到。
- 面板是**表格型**（标题 + 行 + 列），不是任意布局——任意布局等于任意代码。
- 「改已有 UI」目前只支持三个插槽；要改页面内部结构，仍要改我们的代码。
- 扩展清单**不做热重载**：改完 JSON 后刷新界面即可（面板与插槽在启动时读一次，
  设置页每次刷新会重读插槽）。
- LLM 服务登记**需要重启宿主**；这是宿主 provider 配置的位置决定的。

## 7. 相关文件

| 文件 | 作用 |
|---|---|
| `packages/ui-extensions/` | 契约与校验（纯逻辑）：面板 / 插槽 / 行归一化 |
| `packages/ui-plugin/` | 宿主插件：读 JSON、暴露 `ghostUI/panels` `ghostUI/slots` `ghostUI/providers` `ghostUI/providersSave` |
| `apps/desktop/src/extensions.ts` | 桌面端：动态页签、插槽渲染、通用面板 |
| `apps/desktop/src/admin-panels.ts` | 设置页：LLM 服务区 + 扩展插槽区 |
| `scripts/cordis.patch.template.yml` | `{{PROVIDERS}}` 占位符 + `ghost-ui` 插件插入 |
| `scripts/lib-driver.mjs` | 渲染 profile 时注入用户登记的 provider |
| `scripts/verify-ui-extensions.mjs` | 端到端验收 |
