# 第三方许可与声明（C7）

> 事实依据见 `docs/LICENSING.md`。结论：**两个上游都是 MIT，可闭源发布；
> 义务是保留版权声明、不 relicense 上游代码**。本页随安装包与「关于」页分发。

## 1. MIT 上游

| 对象 | 许可 | 版权 |
|---|---|---|
| `deepseek-harness` | MIT | Copyright (c) 2026 DeepSeek |
| `dsh-superagent-prototype` | MIT | Copyright (c) 2026 DeepSeek Harness Team |
| harness 的 382 个包 | 全部 MIT | 各包声明 |

MIT 允许：商业使用、修改、再分发、闭源、收费。
MIT 要求：在所有副本或实质部分中保留版权声明与许可文本，且不得给上游换许可证。

## 2. Electron / Chromium（随安装包分发）

- Electron：BSD 系许可 + 各类第三方组件。
- Chromium：BSD 系及大量第三方许可。
- 必做：安装目录放 `LICENSE.electron.txt` 与 `LICENSES.chromium.html`
  （占位状态见 `build/resources/README.md`，发第一版安装包前补齐）。

## 3. 本仓库三段许可

| 范围 | 许可 |
|---|---|
| 应用（`apps/desktop`、`apps/shell`） | 专有，All rights reserved |
| 对外插件契约（`model-adapter-kit`、剧本格式规范） | Apache-2.0 |
| 示例剧本包 `playbooks/*` | MIT |
| 文档 `docs/*` | CC BY 4.0 |

- 改写的 superagent 文件保留原版权行，另加 `Modifications Copyright (c) 2026`。
- 不 relicense 上游代码；不把 `apps/desktop`（private 产品装配）的架构照搬进来。

## 4. 非宽松依赖的处置（已规避）

| 包 | 许可 | 何时影响 | 处置 |
|---|---|---|---|
| `@deepseek-ai/libreoffice-kit*` | MPL-2.0 | 只有做 Office 转换才打进安装包 | MVP **不做** Office 转换 |
| `lightningcss` | MPL-2.0 | 构建期，不进产物 | 无义务 |
| `dompurify` | MPL-2.0 OR Apache-2.0 | 随前端发布时 | 选 Apache-2.0 分支 |
| `eslint-plugin-sonarjs` | LGPL-3.0 | 仅开发期 | 无义务 |

一句话：**MVP 不碰 Office 转换，非宽松许可就都与我们无关**。

## 5. 商标与免责

- 项目名 `dsh-ghost` 用缩写 DSH，符合官方品牌指引；不直接使用完整商标 "DeepSeek Harness"。
- 不使用 DeepSeek 标识或官方素材作图标/品牌。
- 必带免责声明：*"Built on DeepSeek Harness. Not affiliated with or endorsed by DeepSeek."*
  （出现在 README、关于页、安装包元数据）。

## 6. 合规动作清单（P4 / 发第一版安装包前）

1. 随包 `THIRD_PARTY_NOTICES`：harness / superagent MIT 全文 + 全部依赖许可。
2. 关于页：产品版本、Electron/Chromium/Node 版本、上游链接、免责声明（已由 `about.html` 提供）。
3. 安装目录：`LICENSE.electron.txt` + `LICENSES.chromium.html`。
4. EULA：数据本地存储、无云同步、BYOK 责任划分（`build/installer.nsh` 注释占位）。
5. 复核触发：发第一版安装包 / 接 Office 转换 / 引入新的非宽松依赖。
