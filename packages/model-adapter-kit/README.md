# @dsh-ghost/model-adapter-kit

对外稳定的 `ModelAdapter` 契约（C3-04）。许可证 **Apache-2.0**（见包内 `LICENSE` 与根 `LICENSE-APACHE`）；
源码可复制到自己的插件仓库。仓库其余部分默认专有，只有本包与剧本格式规范按 Apache-2.0 开放。

## 为什么需要这一层

harness 自带 `LlmAdapter` 公开抽象类和 `ctx.llm.registerAdapter`，能力很强，但它是 **pre-stable**：
一次 harness 升级就可能改签名，让所有第三方插件同时失效。用户写一个自定义后端
（自有推理服务、公司内网网关、本地小模型）不应该被 harness 的内部节奏绑住。
所以我们在 `harness-port` 之上再收一层：**插件只实现 3 个方法，只依赖本包，
永远不 import 任何 `@deepseek-ai/*` 包**。宿主侧负责把这层适配到最新 harness。

## 契约（只有 3 个方法）

```ts
import type { ModelAdapter, ChatRequest, ChatResponse, ModelInfo } from '@dsh-ghost/model-adapter-kit'

interface ModelAdapter {
  listModels(): Promise<readonly ModelInfo[]> | readonly ModelInfo[]
  chat(request: ChatRequest): Promise<ChatResponse> | ChatResponse
  close(): Promise<void> | void
}
```

方法可同步可异步，宿主一律 `await` 消费。`ModelInfo` 带能力标注
（`contextWindow` / `maxTokens` / `reasoningEfforts`），能力由路由声明、用户可覆盖。

## 契约版本与兼容

插件清单里声明 `contractVersion`（当前 `MODEL_ADAPTER_CONTRACT_VERSION = 1.0.0`）。
宿主用 `isCompatible(pluginVersion, hostVersion)` 或 `checkContract(plugin)` 自检：

- major 必须相同；
- 插件声明的 minor 不得高于宿主（宿主向后兼容旧插件）；
- patch 与预发布后缀不影响判断；格式非法一律不兼容。

## 生成脚手架

```ts
import { generateAdapterScaffold } from '@dsh-ghost/model-adapter-kit'

const source = generateAdapterScaffold({ name: 'my-gateway', modelIds: ['gw-large', 'gw-small'] })
// 把 source 写进自己的 .ts 文件即可；它只 import 本契约包
```

`name` 必须是 kebab-case，非法值直接抛错。`examples/echo-adapter.ts` 是一份完整的
回显 / 静态模型列表示例，可直接复制改造。

## 参考实现

`createEchoAdapter()` 返回一个零网络、零 DOM 的参考适配器，用于单测与本地演示：
`listModels` 给静态列表，`chat` 回显最后一条 user 文本，`close` 空实现。

## 边界

- 不自己实现 provider 协议栈（harness 已有 4 种）；
- 不做模型聚合 / 负载均衡；
- 不自动爬取模型能力；
- 凭据只允许环境变量引用名，不落明文（见 `@dsh-ghost/model-manager`）。
