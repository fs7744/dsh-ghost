# resources 占位说明

> 本目录是 electron-builder `extraResources` 的来源，打包后位于安装目录 `resources/`。
> **当前不含任何真实二进制资源**，均为占位说明，属外部依赖。

| 期望文件 | 用途 | 状态 |
|---|---|---|
| `icon.ico` | 应用 / 任务栏 / 托盘图标（16~256 px，32 位 alpha） | 占位，待补原创图标 |
| `installerHeader.bmp` | NSIS 安装向导头图（150x57） | 占位，待补 |
| `LICENSE.electron.txt` | Electron 许可全文，随安装包分发 | 占位，待由 electron 发行包拷贝 |
| `LICENSES.chromium.html` | Chromium 第三方许可汇总 | 占位，待由 electron 发行包拷贝 |
| `THIRD_PARTY_NOTICES` | harness / superagent MIT 全文 + 全部依赖许可 | 见 docs/THIRD-PARTY.md，打包时拷入 |

## 约束

- 图标与品牌资产必须原创，不使用 DeepSeek 标识或官方素材（docs/LICENSING.md §6）。
- 未补齐图标前，electron-builder 使用默认图标，产物**不能作为正式发布物**。
- 许可文件为 MIT 合规的必做动作（docs/LICENSING.md §4），发第一版安装包前必须补齐。
