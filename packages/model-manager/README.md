# @dsh-ghost/model-manager

provider / 模型目录的纯逻辑（C3-01/02/03/05）。仓库默认专有，许可证见 `docs/LICENSING.md`。

## 边界

零网络、零 DOM、零文件系统。所有配置读写走可注入的 `CatalogStore`，缺省
`createMemoryStore()`（内存）。界面（`apps/desktop/models.html`）与验收脚本
（`scripts/verify-models.mjs`）各自注入自己的 store，纯逻辑不关心数据从哪来。

## 提供什么

| 能力 | 入口 | 说明 |
|---|---|---|
| 能力标注 | `validateCapabilities` | `contextWindow` / `maxTokens` / `reasoningEfforts` 校验 |
| 目录增删改 | `createCatalog(store)` | `addProvider` / `removeProvider` / `listModels` / `list` |
| 角色路由 | `parseRole` / `resolveRole` / `defaultModelForRole` / `validateRoleBindings` | router / worker 绑定默认模型 |
| 本地预设 | `generateLocalRoute('ollama' \| 'vllm', options)` | route 形状对齐 `cordis.patch.template.yml`，非法值直接抛 |
| 连通性自测 | `runConnectivityProbe(provider, probeFn)` | probe 可注入，结果经 `normalizeProbeResult` 归一化 |
| 凭据引用 | `validateCredentialRef` / `looksLikePlaintextKey` / `findPlaintextCredentials` | 拒绝明文 key，只认 `apiKeyEnv` 形式的环境变量名 |

## 凭据规则（C2-03）

配置里只允许写 env 引用名（如 `WB_KEY`、`OLLAMA_API_KEY`）：大写字母开头，
其余大写字母 / 数字 / 下划线。任何疑似明文密钥（`sk-` / `wbk_` 前缀、
Authorization 头值、长混合串）在 `validateProviderSpec` 与
`generateLocalRoute` 阶段就被拒绝，不会带进宿主 patch。

## 与对外契约的关系

本包是宿主导向的产品逻辑；用户自写插件请用 `@dsh-ghost/model-adapter-kit`
（Apache-2.0）的稳定 `ModelAdapter` 契约，不要直连 harness。两者不互相依赖。
