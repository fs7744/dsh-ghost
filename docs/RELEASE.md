<!-- SHELL_VERSION: 0.0.0 -->
# 发布说明（RELEASE）

> 当前版本 `0.0.0` 为占位。**三处版本必须一致**：根 `package.json`、
> `apps/shell/package.json`、本文件顶部的 `SHELL_VERSION` 标记，
> 由 `release:check`（`scripts/verify-shell.mjs --only=version`）核对，不一致直接失败。

## 1. 范围（硬边界）

- **只支持 Windows x64**（Windows 10 1903+ / 11），安装包形态为 NSIS。
- **macOS dmg + 公证、Linux AppImage 不在本期范围**：配置里没有这两个 target，
  不预留抽象层，也**不假装已支持**。`build/electron-builder.yml` 只有 `win / nsis / x64`。
- 不做云同步、账号体系、多窗口；界面全部自建（`apps/desktop`）。
- 不改 harness 源码；只通过 `127.0.0.1` + 一次性 token 的 Typert Remote 契约取数。

## 2. 四个根脚本名（由集成者登记到根 package.json）

| 根脚本名 | 实际命令 | 用途 |
|---|---|---|
| `test:shell` | `node --test --experimental-transform-types apps/shell/tests/*.test.ts` | 桌面壳纯模块单测（117 用例） |
| `verify:shell` | `node --experimental-transform-types scripts/verify-shell.mjs` | 不启动 Electron 的静态自检 |
| `build:shell` | `npx tsc -p apps/shell/tsconfig.build.json` | 主进程编译到 `apps/shell/dist` |
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
| C5-13 | `credentials.ts` / `electron-safe-storage.ts`（DPAPI，降级不写明文） |
| C2-03 | 凭据安全落点同上（密钥扫描脚本既有，加密存储由壳补齐） |
| C6 | `build/**`、`.github/workflows/release.yml`、版本核对 |
| C7 | `telemetry.ts`、`docs/PRIVACY.md`、`docs/THIRD-PARTY.md`、`about.html` |

## 4. 发布流水线

`.github/workflows/release.yml`：打 `v*` tag 或手动触发 -> `windows-latest` -> `npm ci`
-> `release:check` -> `build:shell` -> `npm run build:ui` -> `verify:shell`
-> `electron-builder --win --x64 --publish never` -> 上传 `.exe` 到 GitHub Release。

`--publish never` 表示只产出安装包，**不真的发布** `latest.yml` 或更新。

## 5. 更新通道与灰度

- `updater.ts`：`none` 关闭；stable 只收 stable；beta 收 stable+beta；
  版本新旧比较；按 `installId` 做 FNV-1a 确定性分桶灰度（同一安装结果稳定）。
- feed 由 secret `SHELL_UPDATE_FEED_STABLE` / `SHELL_UPDATE_FEED_BETA` 注入；
  灰度比例 `SHELL_ROLLOUT_PERCENT` 默认 `0`（不放量）。
- `configureUpdater()` 只设 feed 与关闭自动下载/安装，**不触发下载或发布**。

## 6. 明确属于「配置 / 脚手架已就绪，但需真实外部条件才能验证」的依赖

这些项目本期只交付代码与配置，**没有真实运行验证**，不能当成已发布能力：

1. **代码签名**：证书（PFX）与口令需 CI secret `CSC_LINK` / `CSC_KEY_PASSWORD`（或
   `WIN_CSC_*`）。未注入时产出**未签名**安装包，仅内部测试。
2. **Electron 内置 Node / ABI**：harness 要求 Node >= 24.9 且用 node-pty / koffi /
   node:sqlite。Electron 44 内置 Node 版本、原生模块 ABI 匹配需按 PLAN §8.5 实测；
   本机 node 为 v22.22.2、electron 包未安装，故**未运行 electron、未 npm install**。
3. **真实安装包与 NSIS 安装/卸载**：需 `npm ci` 安装 electron / electron-builder 后构建，
   并在干净 Windows 机器上跑安装、文件关联、协议唤醒、开机启动。
4. **真实图标与许可文件**：`build/resources/` 目前是占位说明（见 `apps/shell/ASSETS.md`），
   发第一版安装包前必须补齐原创图标、`LICENSE.electron.txt`、`LICENSES.chromium.html`、
   `THIRD_PARTY_NOTICES`。
5. **自动更新真实放量**：需要真实 feed 服务、签名后的 latest.yml 与灰度配置；本期不发布。
6. **宿主启动参数**：`electron-host-launcher.ts` 已按 `bin.js --host/--port/--state-dir/
   --permission-mode` 接线，并用 `ELECTRON_RUN_AS_NODE=1` 以 Node 模式跑 Electron 可执行文件
   （否则会当成第二个 Electron 应用启动）。真实参数仍需按宿主版本核对。
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
