# 模型层：任何模型都能接（C3）

> 对应 PLAN §12、FEATURES C3-01～05、REVIEW R8（凭据）、docs/LICENSING.md。
> 结论先行：接模型这件事 harness 已经解决了 80%，本仓库做产品面 + 一个对外契约，
> **不自己实现 provider 协议栈、不做聚合、不自动爬取能力**。

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

## 7. 独立 UI 页

`apps/desktop/models.html` 是独立页面，不碰 `main.ts` / `style.css`：

- `models-view.ts`：纯逻辑零 DOM（demo 数据、能力格式化、角色解析与编辑、
  凭据标签、本地预设预览、状态摘要）。
- `models-panel.ts`：DOM 渲染 + 事件委托，依赖可注入 `ModelsHost`。
- `models-app.ts`：默认 host 通过 `fetch('/api/models/...')` 走同源；
  连不上后端时降级到内置 `DEMO_STATE` 并标 **demo**，页面仍可完整演示。

页面提供：模型库列表、能力标注、角色路由编辑（下拉选模型）、连通性自测按钮、
Ollama / vLLM 一键生成预设。后端 API 契约：`GET/POST /api/models/state`、
`POST /api/models/probe`、`POST /api/models/preset`；未接后端时全部走 demo 降级。

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

`apps/desktop/models.html` 是独立的模型库页，Vite 多页构建会把它打进 `dist/`；主界面顶栏「模型」链接直达。它走同源 `/api/models/state|probe|preset`：

- **Electron 生产**：`apps/shell/src/electron-static.ts` 把这一小段路径留在本机，`apps/shell/src/models-api.ts` 用 `model-manager` 的纯逻辑处理（校验、能力标注、角色路由、本地预设、连通性自测），其余 `/api/*` 照旧反代给 harness。凭据只认 env 引用名，探测时从进程环境取值且绝不写日志。
- **Vite 开发**：没有本机 handler，页面自动降级到内置示例数据并标 `demo`，仍可演示完整交互。
- 测试：`apps/shell/tests/models-api.test.ts`（8 用例：路由归属、状态往返、明文凭据拒绝、非法能力标注、探测归一化、预设去重），随 `npm run test:shell` 一起跑。

配置目前存内存（壳重启即清空）——要持久化时给 `createModelsApi` 注入一个文件版 `CatalogStore` 即可，接口已经留好。
