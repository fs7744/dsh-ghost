# 图标与品牌资产设计说明

> 本目录（apps/shell）只放桌面壳代码与页面；真实图标文件在 `build/resources/`，
> 打包时由 electron-builder 的 `extraResources` 带进安装包。当前为占位说明，
> 图标已按「赛博朋克 + 熊猫幽灵」设计并生成；矢量源在 `build/resources/src/`，可复现重建。

## 图标产物

| 用途 | 文件 | 规格 | 状态 |
|---|---|---|---|
| Windows 应用图标 | `build/resources/icon.ico` | .ico，16/24/32/48/64/128/256 px，32 位 alpha | ✅ 已生成 |
| macOS 应用图标 | `build/resources/icon.icns` | .icns，16~1024 px，7 个 PNG 块 | ✅ 已生成 |
| Linux 应用图标 | `build/resources/icon.png` | 512×512 PNG，带 alpha | ✅ 已生成 |
| macOS 托盘模板图 | `build/resources/trayTemplate.png` / `@2x` | 16/32 px 纯黑剪影 + 透明眼睛孔，自动适配深浅色 | ✅ 已生成 |
| Windows/Linux 托盘 | 同应用图标 | 16/20/24 px，暗色下清晰 | ✅ 已生成 |
| NSIS 安装向导头图 | `build/resources/installerHeader.bmp` | 150x57 / 164x314 可选 | 占位 |
| 关于页品牌图 | 无 | 不使用任何上游标识 | 不做 |

## 品牌约束（见 docs/LICENSING.md §6）

1. 不使用 DeepSeek 的标识、官方素材或完整商标文字。
2. 品牌色为石墨中性 + 青绿强调，不复用 WorkBuddy 的紫色。
3. 描述可写 "Built on DeepSeek Harness"，不得暗示官方背书。
4. 图标为原创矢量设计，不含任何上游标识；仍不能作为正式发布物的原因是
   **未签名 / 未公证**，不是图标缺失。

## 打包路径

主进程 `resolvePaths()` 按平台选择 `icon.ico` / `icon.icns` / `icon.png`
（`apps/shell/src/platform.ts`），托盘在 macOS 用 `trayTemplate.png`；
electron-builder 配置见 `build/electron-builder.yml`。

## 设计与重建

- 风格：石墨黑瓦片（`#141412`）+ 米白熊猫幽灵（`#ECEAE4`）+ 青绿信号线（`#5DCAA5`），
  与 `apps/desktop/src/style.css` 的 UI 变量一致。
- 熊猫特征：白色耳廓 + 黑色内耳、倾斜黑眼斑 + 白点眼、黑色鼻；幽灵特征：圆头 + 三个 V 形缺口。
- 赛博朋克靠**左眼青色植入环 + 直角信号线 + 数据尾迹**，不用大面积霓虹。
- 源文件：`build/resources/src/icon.svg`（大尺寸）、`icon-small.svg`（16/24/32 光学变体）、
  `trayTemplate.svg`（macOS 托盘）。
- 重建：`npm run icons`；校验：`npm run icons:check`。
- ICO/ICNS 由 `scripts/build-icons.mjs` 直接打包 PNG 块，不依赖 ImageMagick / iconutil。
