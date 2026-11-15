# 图标与品牌资产占位说明

> 本目录（apps/shell）只放桌面壳代码与页面；真实图标文件在 `build/resources/`，
> 打包时由 electron-builder 的 `extraResources` 带进安装包。当前为占位说明，
> **仓库内不含任何真实图标二进制**，避免版权与体积问题。

## 需要的图标（待补，属外部依赖）

| 用途 | 文件 | 规格 | 状态 |
|---|---|---|---|
| Windows 应用图标 | `build/resources/icon.ico` | .ico，含 16/32/48/64/128/256 px，32 位 alpha | 占位，未提供二进制 |
| macOS 应用图标 | `build/resources/icon.icns` | .icns，含 16~1024 px | 占位 |
| Linux 应用图标 | `build/resources/icon.png` | 512×512 PNG，带 alpha | 占位 |
| macOS 托盘模板图 | `build/resources/trayTemplate.png` | 16/32 px 单色模板图，自动适配深浅色 | 占位 |
| Windows/Linux 托盘 | 同应用图标 | 16/20/24 px，暗色下清晰 | 占位 |
| NSIS 安装向导头图 | `build/resources/installerHeader.bmp` | 150x57 / 164x314 可选 | 占位 |
| 关于页品牌图 | 无 | 不使用任何上游标识 | 不做 |

## 品牌约束（见 docs/LICENSING.md §6）

1. 不使用 DeepSeek 的标识、官方素材或完整商标文字。
2. 品牌色为石墨中性 + 青绿强调，不复用 WorkBuddy 的紫色。
3. 描述可写 "Built on DeepSeek Harness"，不得暗示官方背书。
4. 图标须为原创；未补真实图标前，打包产物会使用 electron-builder 默认图标，
   因此**这一版不能作为正式发布物**，需补齐图标后再打正式安装包。

## 打包路径

主进程 `resolvePaths()` 按平台选择 `icon.ico` / `icon.icns` / `icon.png`
（`apps/shell/src/platform.ts`），托盘在 macOS 用 `trayTemplate.png`；
electron-builder 配置见 `build/electron-builder.yml`。若替换图标位置，
只需同步这些引用，不改纯模块逻辑。
