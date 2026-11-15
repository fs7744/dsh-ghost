# 许可证：事实与选择

> 结论先行：**两个上游项目都是 MIT，我们可以闭源发布；义务只有"保留版权声明"和"不relicense"**。我们自己的代码选 **专有**，对外插件契约选 **Apache-2.0**。

## 1. 事实（已核对）

| 对象 | 许可证 | 证据 |
|---|---|---|
| `deepseek-harness` | **MIT** | `LICENSE`：`MIT License / Copyright (c) 2026 DeepSeek` |
| `dsh-superagent-prototype` | **MIT** | `LICENSE`：`MIT License / Copyright (c) 2026 DeepSeek Harness Team` |
| harness 的 382 个包 | 全部 `"license": "MIT"` | 逐个 `package.json` 统计 |
| harness 官方 bundle 的发布配置 | `publishConfig.access: public` | 说明它本就是按公开发布设计的 |

**MIT 允许什么**：商业使用、修改、再分发、闭源、收费。**要求什么**：在所有副本或实质部分中保留版权声明与许可文本，且不得给上游代码换许可证。

## 2. 第三方依赖里的非宽松许可（已核对 `THIRD_PARTY_NOTICES.md`）

| 包 | 许可 | 何时才影响我们 | 处置 |
|---|---|---|---|
| `@deepseek-ai/libreoffice-kit*` | **MPL-2.0** | **只有做了 Office 转换功能才会打进安装包** | MVP **不做** Office 转换；要做得提供对应源码与 NOTICE |
| `lightningcss` | MPL-2.0 | 构建期工具，**不进产物** | 无义务 |
| `dompurify` | MPL-2.0 **OR** Apache-2.0 | 若随前端发布 | 选 **Apache-2.0** 分支 |
| `eslint-plugin-sonarjs` | LGPL-3.0 | **仅开发期**，不发布 | 无义务 |
| Electron / Chromium | BSD 系 + 各类第三方 | 一定会随安装包分发 | 见下面第 4 节第 3 条 |

> 一句话：**MVP 不碰 Office 转换，非宽松许可就都与我们无关。**

## 3. 我们的选择

| 范围 | 许可证 | 理由 |
|---|---|---|
| `apps/desktop`（壳 + 界面） | **专有（All rights reserved）** | 商业产品本体 |
| `packages/superagent`（改写自 MIT 项目） | **专有**，但**文件头保留上游版权声明** | MIT 允许闭源衍生，但必须留声明 |
| `packages/playbook`、`harness-port` | **专有** | 内部实现 |
| **对外插件契约**（`model-adapter-kit`、剧本格式规范） | **Apache-2.0** | 含明确专利授权与专利报复条款，比 MIT 更适合"让别人写插件"的生态 |
| 示例剧本包 `playbooks/*` | **MIT** | 鼓励复用；也是生态展示 |
| 文档（`docs/*`） | **CC BY 4.0** | 允许转载，须署名 |

**为什么不整体开源**：我们要做的是产品（对标 Claude / WorkBuddy），核心价值在界面、剧本库与记忆/进化的闭环——这些是资产，不是引流工具。**为什么插件契约要开源**：用户要能自己写模型适配器与剧本，契约不开源就没人写。

## 4. 必做的合规动作（P4 清单）

1. **`THIRD_PARTY_NOTICES.md`**：随安装包发布，含 harness / superagent 的 MIT 全文 + 全部依赖许可。可从 harness 的 `THIRD_PARTY_NOTICES.md` 派生（它已是完整的依赖清单）。
2. **关于页**：显示产品版本、Electron/Chromium 版本、上游项目链接与"built on DeepSeek Harness"表述。
3. **Electron / Chromium 许可文件**：安装目录放 `LICENSE.electron.txt` 与 `LICENSES.chromium.html`（WorkBuddy 的安装目录就是这么做的，可直接照抄这个做法）。
4. **不 relicense 上游代码**：我们改写的 superagent 文件保留原版权行，另加"Modifications Copyright (c) 2026 …"。
5. **商标**：项目名**不使用** "DeepSeek Harness"（官方品牌准则明确要求）；描述里可写 "built on DeepSeek Harness" 或 "compatible with DeepSeek Harness"，也可用缩写 "DSH"。不得暗示官方背书。
6. **EULA**：Windows 安装包需要一份自己的终端用户协议（数据本地存储、无云同步、BYOK 责任划分）。

## 5. 两个容易踩的坑

1. **"MIT 就可以随便用名字"是错的**。MIT 只给版权许可，不给商标许可。品牌准则单独约束项目命名。
2. **把 `apps/desktop` 的代码拷进来**：它虽然在同一仓库、同样 MIT，但它是 `private: true` 的产品装配——拷代码合规，**拷架构等于长期追内部实现**（已在 REVIEW R3/§8.4 记为不做）。

## 6. 产品名：`dsh-ghost`

**结论：可以用，且合规。**

- 官方品牌准则明确写："若希望项目名体现与 DSH 生态的关联，**推荐使用缩写 'DSH'**"；禁止的是直接使用完整商标 "DeepSeek Harness"。`dsh-ghost` 用的是缩写，符合指引。
- npm 名可用：`dsh-ghost` 与 `@dsh-ghost/harness-port` 均为 404（未被占用）。
- 包作用域：内部包统一 `@dsh-ghost/*`；产品名 `dsh-ghost`。

**必须配的三件事**：

1. 一句话免责声明，出现在 README、关于页、安装包元数据：
   *"Built on DeepSeek Harness. Not affiliated with or endorsed by DeepSeek."*
2. 图标与品牌资产**不使用** DeepSeek 的标识或官方素材。
3. 描述里可以写 "built on DeepSeek Harness" / "compatible with DeepSeek Harness"，但不得暗示官方背书。

## 7. 决策记录

- **2026-11-15**：产品名定为 **dsh-ghost**（符合官方"用 DSH 缩写"指引，npm 名可用）；确定「应用专有 + 插件契约 Apache-2.0 + 示例剧本 MIT」三分法；MVP 不做 Office 转换，规避 MPL-2.0 源码可得义务。复核触发条件：① 要发第一版安装包；② 要接 Office 转换；③ 要引入新的非宽松依赖。
