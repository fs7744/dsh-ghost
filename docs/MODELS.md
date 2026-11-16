# 模型层：任何模型都能接（C3）

> 对应 PLAN §12、FEATURES C3-01～05、REVIEW R8（凭据）、docs/LICENSING.md。
> 结论先行：接模型这件事 harness 已经解决了 80%，本仓库做产品面 + 一个对外契约，
> **不自己实现 provider 协议栈**；模型列表可从服务方自动拉取（结果可编辑），
> 多个服务由壳内的轻量本地代理做负载均衡与故障转移，但协议转换仍交给 harness。

## 1. 三层分账

| 层 | 归属 | 说明 |
|---|---|---|
| 协议栈 | harness 白给 | `LlmAdapter` + `ctx.llm.registerAdapter`；`dsh-llm-pi-ai` 一条插件覆盖 4 种线协议 |
| 模型管理面 | 我们新建 | provider/模型目录、能力标注、角色路由、连通性自测、本地预设、凭据策略 |
| 对外 adapter 契约 | 我们新建 | `ModelAdapter` 稳定契约 + 脚手架 + 示例，供第三方插件使用 |

关键理由写在 `packages/model-adapter-kit/src/index.ts` 的注释里：harness 的
`LlmAdapter` 是 **pre-stable**，第三方插件不能直连，否则一次 harness 升级就把
所有插件打翻。用户自写后端只需实现 3 个方法，永远不 import 任何 `@deepseek-ai/*` 包。

## 2. 两个包

### packages/model-adapter-kit（Apache-2.0，C3-04）

- 稳定契约 `ModelAdapter`：**只 3 个方法** `listModels` / `chat` / `close`，可同步可异步。
- 类型：`ModelInfo`（含能力标注）、`ChatMessage`、`ChatRequest`、`ChatResponse`、`ToolCall`。
- `MODEL_ADAPTER_CONTRACT_VERSION = 1.0.0`；`isCompatible` / `checkContract` 做版本兼容：
  major 必须相同，插件 minor 不得高于宿主，patch 与预发布后缀不影响判断。
- `generateAdapterScaffold({ name, modelIds })` 生成可复制的插件源码（纯函数，不写盘）。
- `createEchoAdapter()` 参考实现 + `examples/echo-adapter.ts` 完整示例（回显 / 静态模型列表）。
- 许可证：包内 `LICENSE`（根 `LICENSE-APACHE` 的副本），源码带 `SPDX-License-Identifier: Apache-2.0`。

### packages/model-manager（专有，C3-01/02/03/05）

纯逻辑，**零网络、零 DOM、零文件系统**。所有配置读写走可注入 `CatalogStore`，
缺省 `createMemoryStore()`（内存）。模块：

| 文件 | 职责 |
|---|---|
| `core.ts` | 类型、`PROVIDER_APIS`、`createMemoryStore`、`validateCapabilities` |
| `credentials.ts` | 凭据引用校验（C2-03） |
| `presets.ts` | `generateLocalRoute('ollama' \| 'vllm')` 本地预设 route |
| `roles.ts` | `parseRole` / `resolveRole` / `defaultModelForRole` / `validateRoleBindings` |
| `catalog.ts` | `validateProviderSpec` / `createCatalog(store)` |
| `probe.ts` | `runConnectivityProbe` / `normalizeProbeResult` / `describeProbe` |
| `discovery.ts` | `discoveryUrl` / `discoveryHeaders` / `parseDiscoveredModels`（自动拉取模型列表） |
| `balancing.ts` | `selectBalanceTarget` / `BALANCE_STRATEGIES`（5 种分发策略的纯选路） |

## 3. 能力标注与角色路由

- 能力标注 `contextWindow` / `maxTokens` / `reasoningEfforts` 由路由声明，用户可覆盖；
  `validateCapabilities` 拒绝非正整数、输出上限大于上下文、空的档位名。
- 角色 `router` / `worker` 各绑定一个默认模型（`RoleBinding`）。`resolveRole` 把绑定
  解析到具体 `provider + model`，失效返回 undefined 不猜；`validateRoleBindings` 检出
  重复角色与指向不存在模型的绑定。
- `createCatalog(store)` 提供 `addProvider` / `removeProvider` / `bindRole` / `listModels` /
  `resolve`；删 provider 会连带清理其绑定。

## 4. 本地预设（C3-05）

`generateLocalRoute(preset, options)` 生成的形状对齐
`scripts/cordis.patch.template.yml` 的 `providers` 段：

| 预设 | 默认端点 | 默认模型 | 默认 env 引用 |
|---|---|---|---|
| ollama | `http://127.0.0.1:11434/v1` | `llama3.1` | `OLLAMA_API_KEY` |
| vllm | `http://127.0.0.1:8000/v1` | `local-model` | `VLLM_API_KEY` |

`host` / `port` / `modelId` / 能力标注 / `apiKeyEnv` 全部在生成阶段校验，
非法值直接抛，绝不把脏配置带进宿主。

## 5. 连通性自测（C3-02）

`runConnectivityProbe(provider, probeFn)` 的探测函数由调用方**注入**：
可以是真 fetch、L1 假端点、或测试里的同步 stub。`normalizeProbeResult` 把
`{ ok }` / `{ success }` / `{ status }` / `Error` / 字符串 / null 统一成
`{ ok, status?, error?, models? }`，并丢弃耗时、时间、id 等易变字段。
`describeProbe` 给界面与 CLI 一份统一文案。

## 6. 凭据安全（C2-03）

配置里**只允许 env 引用名**（`apiKeyEnv`），形如 `WB_KEY`、
`OLLAMA_API_KEY`：大写字母开头，其余大写字母 / 数字 / 下划线。

- `validateCredentialRef` / `looksLikePlaintextKey` 拒绝明文 key（`sk-` / `wbk_`
  前缀、Authorization 头值、长混合串）；
- `findPlaintextCredentials` 批量挑出配置里的明文字段；
- `validateProviderSpec` 与 `generateLocalRoute` 在入口就拒绝非法凭据；
- 界面 `credentialRefLabel` 只渲染 `env:WB_KEY`，非 env 名统一显示 `[凭据引用无效]`，
  **绝不在 UI 上回显明文**。

明文永不落 settings、永不进配置文件。Windows 上的加密存储（Electron `safeStorage`
/ DPAPI）属于桌面壳排期，不在本层；本层只保证「配置里没有明文」。

## 7. UI 页（设置 → 模型）

模型配置的主入口是左侧导航「设置 → 模型」分类，右上角「⋮ → 模型」直达；
`apps/desktop/models.html` 保留为独立页，两处共用同一套组件与 host：

- `models-view.ts`：纯逻辑零 DOM（demo 数据、能力格式化、角色解析与编辑、
  凭据标签、本地预设预览、状态摘要）。
- `models-panel.ts`：DOM 渲染 + 事件委托，依赖可注入 `ModelsHost`。
- `models-host.ts`：默认 host 通过 `fetch('/api/models/...')` 走同源；
  连不上后端时降级到内置 `DEMO_STATE` 并标 **demo**，页面仍可完整演示。
- `models-app.ts`：独立页薄入口；设置页在 `admin-panels.ts` 里挂同一个面板。
- 组件样式在全局 `style.css`（选择器都带 `#models-root` 前缀），两页共用；
  `models.html` 只保留独立页布局样式。

> 设置页按通用 / 模型 / MCP / 连接 / 智能体 / 高级分类组织（左侧二级导航）。
> 老的「设置 → LLM 服务」简版表单已移除，统一到这里的增强版面板，避免出现两套配置入口。

页面提供**可编辑**的服务管理：

- 「+ 新增服务」表单——协议下拉（按业界标准：OpenAI Chat Completions / Responses /
  Anthropic Messages / Google Gemini）、接口地址、API Key、以及可增删行的「支持的模型」
  （id / 显示名 / 上下文 / 输出上限 / 思考档位）；编辑页对已有服务可改可删。
- API Key 填**原文**即可，保存时经 `window.shellApi.setCredential`（Electron safeStorage /
  Windows DPAPI）加密落系统安全区，`models.json` 里只留派生出的 `apiKeyEnv` 引用名
  （如 `MY_LLM_KEY`）；浏览器 demo 模式无安全存储，会明确拒绝保存而不落明文。
- 「职责 → 模型」：按职责（规划/路由、执行/干活）选模型，每个职责旁有按能力标注生成的
  「推荐」按钮，顶栏「职责自动推荐」一键给全部职责分配；「自动推荐」是纯函数
  `autoBindRoles`（规划优先推理档位多 / 上下文大的，执行选剩余里上下文大的）。
- 连通性自测按钮、Ollama / vLLM 一键生成预设。

- 「↓ 自动获取模型」：按服务的协议去拉标准 `/models` 端点，解析后把模型 id / 显示名
  填进表单；**已填的行保留用户的修改，只追加新模型**，能力标注给保守默认值仍可逐项改。
  密钥由壳按 `apiKeyEnv` 从安全存储取出注入请求头，明文不经过 API、不落日志。
- 「多服务负载均衡」：每个服务有「参与负载均衡」开关与权重，全局可选
  `单服务直连 / 轮询 / 随机 / 加权 / 故障转移` 五种策略。

后端 API 契约：`GET/POST /api/models/state`、`POST /api/models/probe`、
`POST /api/models/discover`、`POST /api/models/preset`；未接后端时全部走 demo 降级。

## 8. 许可证划分

依 docs/LICENSING.md：

- `packages/model-adapter-kit/**` → **Apache-2.0**（对外插件契约，鼓励别人写适配器）；
- `packages/model-manager/**`、`apps/desktop/**` → **专有**；
- 文档 `docs/*` → CC BY 4.0。

两个包都带 `package.json`（`@dsh-ghost/*`、`type: module`）与
`tsconfig.build.json`（`outDir: lib`），不依赖根 build 脚本改动。

## 9. 验收

```sh
node --experimental-transform-types scripts/verify-models.mjs
node --test --experimental-transform-types packages/model-adapter-kit/tests/contract.test.ts
node --test --experimental-transform-types packages/model-manager/tests/catalog.test.ts
node --test --experimental-transform-types packages/model-manager/tests/credentials.test.ts
```

`verify-models.mjs` 不用真模型：纯逻辑用可注入 store / probe，真实 HTTP 那一段
用 L1 假端点。集成后等价命令是 `npm run verify:models` 与 `npm run test:model`。

## 10. 界面接线（不是 demo 了）

模型配置面板挂在「设置 → 模型」（`admin-panels.ts`）或独立页 `apps/desktop/models.html`（Vite 多页构建进 `dist/`）；右上角「⋮ → 模型」直达设置分类。它走同源 `/api/models/state|probe|preset|discover`：

- **Electron 生产**：`apps/shell/src/electron-static.ts` 把这一小段路径留在本机，`apps/shell/src/models-api.ts` 用 `model-manager` 的纯逻辑处理（校验、能力标注、职责路由、本地预设、连通性自测），其余 `/api/*` 照旧反代给 harness。配置只认 env 引用名；自测经注入的 `getCredential` 从安全存储取值，宿主启动时 `main.ts` 用 `modelCredentialEnv()` 把各服务的密钥按引用名注入宿主进程环境，明文绝不落配置或日志。
- **Vite 开发**：没有本机 handler，页面自动降级到内置示例数据并标 `demo`，仍可演示完整交互。
- 测试：`apps/shell/tests/models-api.test.ts`（8 用例：路由归属、状态往返、明文凭据拒绝、非法能力标注、探测归一化、预设去重），随 `npm run test:shell` 一起跑。

配置持久化到用户数据目录的 `models.json`（文件版 `CatalogStore`，tmp + rename 原子写，坏文件回退空目录），壳重启不丢；密钥本身不在其中。

## 11. 配置如何真正生效 + 多服务负载均衡

模型配置页保存后，`models-api.ts` 会把 providers 同步写到 harness 真正读取的
`<userData>/ghost/ui/providers.json`，下次启动宿主的 `renderProvidersYaml` 就把它们
渲染进 `cordis.patch.yml` 的 `llm-pi-ai.config.providers`。首次打开模型配置页时若
`models.json` 为空，会从旧的 `providers.json` 一次性导入，兼容「设置 → LLM 服务」里
登记过的服务。

harness 一次调用只能指定一个 provider/model，**多个服务本身不会被自动分摊**。因此
壳内 `apps/shell/src/llm-balancer.ts` 起一个只监听 127.0.0.1 的聚合代理：

- 代理地址作为 `wb` provider 的 `baseURL` 注入 `{{BASE_URL}}`，agent 侧无需改动；
- 按选中的策略从启用的 OpenAI 兼容服务里挑一个，转发 `/v1/chat/completions`，
  **流式响应逐块透传**；目标服务没有 agent 当前模型时改写成它自己的第一个模型；
- 上游 429 / 5xx 或网络错误会**换下一个候选重试**（任何策略都有故障转移兜底）；
- 没有可用服务时 `baseURL` 留空，patch 仍直连原来的 `WB_BASE_URL`，行为与旧版一致；
- Anthropic / Gemini 线协议不同，不参与本代理分发，仍由 harness 按各自协议注册使用。

策略、启用开关、权重都存在 `models.json` 里，**改完重启宿主生效**（patch 只在启动时渲染）；
代理每次请求都重读配置，策略切换后重启即可。密钥仍只从 safeStorage 按 `apiKeyEnv` 取，
只在出站请求里用一次，不写配置、不进日志。

测试：`packages/model-manager/tests/discovery-balancing.test.ts`（协议端点/鉴权头、
3 种响应形状的解析去重、5 种策略的确定性选路）、`apps/shell/tests/llm-balancer.test.ts`
（真 HTTP 打假服务：轮询分发、模型 id 改写、500 故障转移、模型聚合、无服务透传），
分别随 `npm run test:model` 与 `npm run test:shell` 跑。
