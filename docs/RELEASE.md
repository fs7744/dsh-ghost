<!-- SHELL_VERSION: 0.0.0 -->
# 发布说明（RELEASE）

> 当前版本 `0.0.0` 为占位。**三处版本必须一致**：根 `package.json`、
> `apps/shell/package.json`、本文件顶部的 `SHELL_VERSION` 标记，
> 由 `release:check`（`scripts/verify-shell.mjs --only=version`）核对，不一致直接失败。

## 1. 范围（硬边界）

- **Windows x64 / macOS x64+arm64 / Linux x64+arm64**。
- 安装包形态：Windows NSIS；macOS dmg + zip（zip 给 Squirrel.Mac 更新）；Linux AppImage + deb。
- 每个平台在**自己的 CI runner** 上构建（原生依赖与运行时架构必须匹配），不在 Windows 上交叉打 mac/linux 包。
- 未签名/未公证的产物只能内部测试，不能作为正式发布物。
- 不做云同步、账号体系、多窗口；界面全部自建（`apps/desktop`）。
- 不改 harness 源码；只通过 `127.0.0.1` + 一次性 token 的 Typert Remote 契约取数。

## 2. 四个根脚本名（由集成者登记到根 package.json）

| 根脚本名 | 实际命令 | 用途 |
|---|---|---|
| `test:shell` | `node --test --experimental-transform-types apps/shell/tests/*.test.ts` | 桌面壳纯模块单测（139 用例） |
| `verify:shell` | `node --experimental-transform-types scripts/verify-shell.mjs` | 不启动 Electron 的静态自检 |
| `build:shell` | `tsc --noEmit` + `esbuild` bundle | 主进程单文件 bundle 到 `apps/shell/dist/main.js` |
| `release:check` | `node --experimental-transform-types scripts/verify-shell.mjs --only=version` | 版本一致性核对 |

`apps/shell/package.json` 内也提供等价的 `test` / `verify` / `build` / `release:check` 脚本。
基线 `npm test` / `npm run typecheck` / `npm run check:ui` 不受影响（未改动其 include 的文件）。

## 3. 交付覆盖映射

| ID | 落点 |
|---|---|
| C5-01 | `electron-window.ts`（CSP / ready-to-show / 窗口状态）/ `static-server.ts` |
| C5-02 | `runtime.ts`（起停、健康检查、退避重启、OS 分配端口）/ `electron-host-launcher.ts` |
| C5-03 | `single-instance.ts` / `electron-app.ts`（单实例锁、dsh-ghost 协议） |
| C5-04 | `electron-tray.ts`（托盘、三类通知、点击恢复） |
| C5-05 | `electron-app.ts` 的 `setLoginItemSettings`（设置里可开关） |
| C5-06 | `single-instance.ts` argv / open-file 解析 + builder `fileAssociations` |
| C5-07 | `electron-menu.ts`（系统级快捷键，不碰渲染层 Ctrl+1..9） |
| C5-08 | `updater.ts`（通道 + 灰度判定）/ `electron-updater.ts`（只配置不发布） |
| C5-09 | `runtime.ts` 状态锁 + 崩溃恢复 / `main.ts` 生命周期 |
| C5-10 | `diagnostics.ts`（脱敏 + 纯 JS zip）/ `electron-ipc.ts` |
| C5-11 | `onboarding.ts` / `onboarding.html` |
| C5-12 | `i18n.ts`（中/英，跟随系统，可覆盖） |
| C5-13 | `credentials.ts` / `electron-safe-storage.ts`（Windows DPAPI / macOS Keychain / Linux libsecret；不可用时只留内存，不写明文） |
| C2-03 | 凭据安全落点同上（密钥扫描脚本既有，加密存储由壳补齐） |
| C6 | `build/**`、`.github/workflows/release.yml`、版本核对 |
| C7 | `telemetry.ts`、`docs/PRIVACY.md`、`docs/THIRD-PARTY.md`、`about.html` |

## 4. 发布流水线

`.github/workflows/release.yml`：打 `v*` tag 或手动触发 -> 平台矩阵
（`windows-latest` / `macos-13` x64 / `macos-14` arm64 / `ubuntu-22.04` x64）->
`npm ci` -> `release:check` -> `build:shell` -> `build:ui` -> `verify:shell` ->
`prepare:runtime --apply` -> `electron-builder --<platform> --<arch> --publish never`
-> 上传各平台产物 -> 单个 release job 汇总上传到 GitHub Release。

每个平台在自己的 runner 上构建，原生依赖与运行时架构才匹配；**不在 Windows 上交叉打 mac/linux 包**。
`--publish never` 表示只产出安装包，**不真的发布** `latest*.yml` 或更新。

产物形态：Windows NSIS；macOS dmg + zip（zip 给 Squirrel.Mac）；Linux AppImage + deb。

### 4.1 非安装版（本地反复验证用）

CI 出的是**安装版**（要写注册表、占卸载项）。本地反复验证要的是**免安装包**：
`scripts/pack-win-portable.mjs`（`npm run pack:win` / `pack:win:fast` / `pack:win:exe`），
产物在 `out/win-portable/`，不碰注册表、不碰更新 feed、不污染 `out/shell-release/`。

三处与 CI 不同，是为了让本地能反复跑（细节见 [build/README.md](../build/README.md)）：

- **图标/版本信息自己写。** electron-builder 默认用 `winCodeSign` 里的 rcedit 改 exe 资源，
  那套要联网下载，且解压要求「创建符号链接」权限（非管理员/未开开发者模式必失败）。
  脚本关掉 `win.signAndEditExecutable`，改用缓存里已解压的 `rcedit-x64.exe` 补图标与版本信息。
- **zip / 便携版从打好图标的目录出。** 先打 `dir` -> rcedit 补图标 -> 再用 `--prepackaged`
  出 zip 与单文件便携版，避免压缩包里是 Electron 默认图标。
- **运行时按需复制。** `prepare-runtime.mjs` 记住来源，来源没变就不重拷那 580MB，
  只同步我们的插件层。

### 4.2 打包态的宿主 profile（C7 补齐）

打包态原本**起不来宿主**：`--profile desktop` 既不在 `$DSH_HOME/profiles/` 里、
也不在 harness 的内置模板表（只有 acp / web / headless / sdk / sdk-minimal），
harness 直接抛 `profile "desktop" does not exist` 退出；壳一直等 `healthy`，
`ensureWindow` 永不执行 —— **一个窗口都不弹**，用户只看到后台进程。

现在：

- 壳在启动宿主前**物化 profile**（`apps/shell/src/host-profile.ts`）：写 manifest
  （base + web-app 两个 bundle）+ 渲染我们自己的插件层 `cordis.patch.yml`；
- 插件包同步进 **profile 的 node_modules** —— harness 的运行时分��表里插件属于
  profile 作用域，只放在运行时 node_modules 里会被当成「读不到的 bundle」跳过；
- profile 名用 `ghost`：`desktop` 是 harness 留给自家 Electron 载体的保留名，
  从 CLI 启动会被直接拒绝；
- 宿主彻底起不来时，壳会**弹出错误窗口**并带上日志尾巴，不再静默装死。

## 5. 更新通道与灰度

- `updater.ts`：`none` 关闭；stable 只收 stable；beta 收 stable+beta；
  版本新旧比较；按 `installId` 做 FNV-1a 确定性分桶灰度（同一安装结果稳定）。
- feed 由 secret `SHELL_UPDATE_FEED_STABLE` / `SHELL_UPDATE_FEED_BETA` 注入；
  灰度比例 `SHELL_ROLLOUT_PERCENT` 默认 `0`（不放量）。
- `configureUpdater()` 只设 feed 与关闭自动下载/安装，**不触发下载或发布**。

## 6. 明确属于「配置 / 脚手架已就绪，但需真实外部条件才能验证」的依赖

这些项目本期只交付代码与配置，**没有真实运行验证**，不能当成已发布能力：

1. **代码签名 / 公证**：Windows 需 PFX（`CSC_LINK` / `CSC_KEY_PASSWORD` 或 `WIN_CSC_*`）；
   macOS 需 Developer ID + 公证（`APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`）。
   未注入时产出**未签名/未公证**包，仅内部测试。
2. ✅ **Electron 内置 Node / ABI 已实测**：Electron **44.7.0**（自带 Node 24.21.0）下
   `node-pty` / `koffi` / `node:sqlite` 均可加载；真实壳启动到 `healthy`。
   ⚠️ harness 有 Electron 指纹白名单：44.x 只认 44.0.0 / 44.7.0，44.11.x 会被拒绝；
   升级 Electron 必须重跑 `docs/RELEASE.md §6` 的冒烟。
3. **真实安装包与安装/卸载**：Windows `--dir` 与 NSIS 已产出并校验 asar 启动；Linux
   `--dir` 已产出（Windows 上只验证了 asar 结构，未运行 ELF）。**macOS 打包必须在 macOS
   runner 上做**（dmg 工具链），本机未构建。文件关联、协议唤醒、开机启动、干净机器仍需实测。
   本地打包用 `CSC_IDENTITY_AUTO_DISCOVERY=false` 跳过签名；未签名包不能作为正式发布物。
4. **图标与许可文件**：图标已按「赛博朋克熊猫幽灵」生成（见 `apps/shell/ASSETS.md`），
   三平台格式齐全；仍需补齐 `LICENSE.electron.txt`、`LICENSES.chromium.html`、
   `THIRD_PARTY_NOTICES` 等发布随附文件。
5. **自动更新真实放量**：需要真实 feed 服务、各平台签名后的 `latest.yml` / `latest-mac.yml` / `latest-linux.yml` 与灰度配置；本期不发布。
6. **宿主启动参数（已按真实 CLI 修正）**：`dsh --profile <name> [--patch <yml>]
   --host 127.0.0.1 --port N --no-open`；`DSH_HOME` 走环境变量；token 由宿主打印、
   从 stdout 解析（不再自造 token）。子进程用 `ELECTRON_RUN_AS_NODE=1` 以 Node 模式运行。
   打包态仍需把插件同步进 profile（开发态复用 `spikes/p05-transport/.dsh-home`）。
7. **宿主运行时打包**：`@deepseek-ai/dsh` 与原生依赖不能进 asar。`build/electron-builder.yml`
   的 `extraResources` 会把 `build/runtime` 拷到 `resources/runtime`，入口按
   `resources/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js` 解析。
   目录由 `npm run prepare:runtime -- --apply` 生成（默认 dry-run，1.3GB 量级，不进 git）；
   正式发版应改成 `npm ci --omit=dev` 的裁剪产物。开发态直接复用 `spikes/p05-transport/node_modules`。
8. **诊断包里的真实票状态**：当前 `tickets()` 为空占位，需接宿主 Remote 后才有数据。

## 7. 文档站骨架（C7 产品化，占位）

- 站点骨架建议：一个静态站点（可由 `apps/desktop` 同源或独立 Vite 构建），
  栏目为「快速开始 / 首启向导 / 模型与审批档位 / 剧本格式 / 隐私与数据 / 第三方许可 / 更新日志」。
- 内容来源直接复用 `docs/*.md`（CC BY 4.0），不在本期实现构建与部署。
- 关于页（`about.html`）已显示版本、Electron/Chromium/Node 版本、上游声明与三段许可。

## 8. 崩溃上报与反馈入口（C7，默认关闭）

- `config.ts` 的 `crashReportsEnabled` / `telemetryEnabled` 默认均为 `false`。
- `telemetry.ts` 提供本地缓冲、可导出可删除；导出强制脱敏。
- 反馈入口只在用户于设置里显式开启后才生效，默认不采集、不上传。详见 `docs/PRIVACY.md`。
