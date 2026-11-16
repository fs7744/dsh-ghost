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
| `resources/README.md` | 图标产物与许可文件说明 |

## 根脚本名映射（由集成者登记到根 package.json）

| 根脚本名 | 实际命令 | 说明 |
|---|---|---|
| `test:shell` | `node --test --experimental-transform-types apps/shell/tests/*.test.ts` | 纯模块单测 |
| `verify:shell` | `node --experimental-transform-types scripts/verify-shell.mjs` | 不启动 Electron 的静态自检 |
| `build:shell` | `tsc --noEmit` + `esbuild` bundle | 主进程单文件 bundle 到 `apps/shell/dist/main.js` |
| `release:check` | `node --experimental-transform-types scripts/verify-shell.mjs --only=version` | 版本一致性核对 |

`apps/shell/package.json` 内也提供等价的 `test` / `verify` / `build` / `release:check` 脚本。

## 非安装版（本地反复验证用）

`scripts/pack-win-portable.mjs` 打的是**免安装包**：不写注册表、不建快捷方式、不进卸载项，
产物落在 `out/win-portable/`，和 CI 的 `out/shell-release/` 互不干扰。

```bash
npm run pack:win          # dir（免安装目录）+ zip（解压即用），带 harness 运行时
npm run pack:win:fast     # 同上但不带运行时：只验证 UI 层，产物小很多
npm run pack:win:exe      # 额外产出单文件便携 .exe
```

| 选项 | 作用 |
|---|---|
| `--skip-runtime` | 不打包 harness 运行时（`resources/runtime`），跑不起宿主，只看界面 |
| `--skip-build` | 不重编译 packages / shell / ui，沿用现有 `dist` |
| `--force-runtime` | 强制重新复制 harness 运行时 |
| `--exe` / `--no-zip` | 控制产物形态 |
| `--no-brand` | 不改 exe 图标/版本信息 |
| `--out-dir <dir>` | 换产物目录 |
| `--json` | 机器可读结果 |

两处和 CI 不同，都是为了**本地能反复跑**：

- **图标/版本信息自己写。** electron-builder 默认靠 `winCodeSign` 里的 rcedit 改 exe 资源，
  那套东西要从 GitHub 下载，且解压要求「创建符号链接」权限（非管理员/未开开发者模式必失败）。
  脚本关掉 `win.signAndEditExecutable`，改用缓存里已解压的 `rcedit-x64.exe` 补图标与版本信息：
  零下载、零特权。缓存里没有 rcedit 时会跳过，exe 保留 Electron 默认图标。
- **压缩级别用 normal。** `maximum` 对 580MB 的运行时太慢，收益几乎为零。

打包顺序：packages → `build:shell` → `build:ui` → `prepare-runtime`（首次复制，来源没变就只同步插件层）
→ electron-builder → rcedit 补图标 → `--prepackaged` 出 zip/便携版。

图标来源只有一个：`apps/desktop/src/brand-image.ts` 里内嵌的品牌图（界面显示的也是它）。
`npm run icons` 从它生成 `icon.png` / `icon.ico` / `icon.icns`，不会再出现
「界面是新品牌、exe 还是旧图标」的分裂。

宿主能在打包态起来，靠的是壳在启动前**物化 profile**（manifest + 我们自己的插件层），
细节见 [docs/RELEASE.md](../docs/RELEASE.md)。

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
