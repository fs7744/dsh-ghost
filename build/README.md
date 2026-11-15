# 发布链（build/）

> 本目录只放 **electron-builder 配置、NSIS 脚本与 resources 占位说明**。
> 当前交付的是「配置 / 脚手架已就绪」；Windows 已产出未签名 NSIS 与 asar 目录，macOS/Linux 需在对应 runner 构建，均未发布。

## 范围（硬边界）

- **Windows x64 / macOS x64+arm64 / Linux x64+arm64**。
- 产物：Windows NSIS；macOS dmg + zip；Linux AppImage + deb。
- 每个平台在自己的 runner 上构建；不在 Windows 上交叉打 mac/linux 包。
- 不做云同步、账号体系、多窗口。

## 目录

| 文件 | 作用 |
|---|---|
| `electron-builder.yml` | win/mac/linux 目标、文件关联、dsh-ghost 协议、更新通道占位、签名/公证占位 |
| `installer.nsh` | NSIS 自定义安装/卸载宏（本地优先、不写凭据、卸载保留用户数据） |
| `resources/README.md` | 图标与许可文件占位说明 |

## 根脚本名映射（由集成者登记到根 package.json）

| 根脚本名 | 实际命令 | 说明 |
|---|---|---|
| `test:shell` | `node --test --experimental-transform-types apps/shell/tests/*.test.ts` | 纯模块单测 |
| `verify:shell` | `node --experimental-transform-types scripts/verify-shell.mjs` | 不启动 Electron 的静态自检 |
| `build:shell` | `tsc --noEmit` + `esbuild` bundle | 主进程单文件 bundle 到 `apps/shell/dist/main.js` |
| `release:check` | `node --experimental-transform-types scripts/verify-shell.mjs --only=version` | 版本一致性核对 |

`apps/shell/package.json` 内也提供等价的 `test` / `verify` / `build` / `release:check` 脚本。

## 构建顺序（CI 见 .github/workflows/release.yml）

1. `npm ci`（安装发布期依赖：electron / electron-builder / electron-updater，本地不执行）。
2. `release:check`：核对根 package.json、apps/shell/package.json、docs/RELEASE.md 的版本标记一致。
3. `build:shell`：类型检查 + esbuild bundle 主进程到 `apps/shell/dist/main.js`。
4. `npm run build:ui`：生成 `apps/desktop/dist`（已存在 Vite 产物，CI 重新构建保证一致）。
5. `electron-builder --<platform> --<arch> --config build/electron-builder.yml --publish never`。

## 签名 / 公证（外部依赖，尚未具备）

- Windows：`CSC_LINK`（PFX 的 base64）、`CSC_KEY_PASSWORD`；或证书 store 的 `WIN_CSC_*`。
- macOS：Developer ID 证书 + `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`。
- Linux：无签名，AppImage 由用户自行校验哈希。
- 配置与脚本里**不硬编码**任何证书路径、指纹或口令；未注入时产出未签名/未公证包，仅内部测试。

## 更新通道与灰度（外部依赖，尚未发布）

- 判定逻辑在 `apps/shell/src/updater.ts`：stable 只收 stable、beta 收 stable+beta、
  `none` 关闭、按 `installId` 确定性分桶灰度。
- feed 地址由 secret `SHELL_UPDATE_FEED_STABLE` / `SHELL_UPDATE_FEED_BETA` 注入；
  灰度比例由 `SHELL_ROLLOUT_PERCENT` 注入，默认 0（不放量）。
- `--publish never` 表示本地/CI 只产出安装包，**不真的发布** `latest*.yml` 或上传更新。
