# 隐私与遥测策略（C7）

> 一句话：**本地优先、默认关闭、可导出可删除**。dsh-ghost 没有云同步、
> 没有账号体系，所有数据留在用户本机。

## 1. 默认状态

| 项 | 默认值 | 配置字段 |
|---|---|---|
| 匿名遥测 | **关闭** | `config.telemetryEnabled` |
| 崩溃上报 | **关闭** | `config.crashReportsEnabled` |
| 云同步 / 账号 | 不做 | 无 |
| 诊断包上传 | 无（只本地导出） | 无 |

用户必须在设置里显式开启，遥测/崩溃上报才会工作；关闭时缓冲会被清空。

## 2. 数据存在哪里（本地优先）

- 配置：`%APPDATA%/dsh-ghost/settings.json`（`app.getPath('userData')`）。
- 会话 / 票 / 剧本 / state：由 harness 宿主写在本地 state 目录。
- 窗口状态：合并进 `settings.json` 的 `window` 字段。
- 凭据：`settings.json` 里**只有 safeStorage（Windows 即 DPAPI）加密后的密文**，
  绝不写明文；加密不可用时降级为「仅内存、不落盘」（见 `docs/DIAGNOSTICS.md`）。

## 3. 遥测收集什么、不收集什么

- 收集：匿名事件类型、时间戳、可选的非敏感描述（经脱敏后存入本地缓冲）。
- **不收集**：一次性 token、API key、Cookie / Authorization、对话内容、票正文、
  工作区文件路径、用户身份标识。
- `installId` 是随机生成的本地标识，只用于更新灰度分桶，不含个人信息，可随数据删除。

## 4. 可导出、可删除

- `telemetry.export(knownSecrets)` 输出 JSON，detail 强制脱敏。
- `telemetry.clear()` 清空缓冲；关闭开关也会清空。
- 删除本地数据：删除 `%APPDATA%/dsh-ghost/` 即可，应用不保留云端副本。
- 菜单「导出诊断包」只写用户选择的本地路径，不自动上传。

## 5. 诊断包脱敏

诊断包（见 `docs/DIAGNOSTICS.md`）在写入前对 token / API key / Cookie 做双重脱敏，
`verify:shell` 与 `test:shell` 用假敏感串断言输出零命中，**绝不带出凭据**。

## 6. 第三方与网络

- 应用只连本机 `127.0.0.1` 的宿主与静态服务；不加载远程页面（CSP `default-src 'self'`）。
- 自动更新默认关闭；开启后才会访问配置的 feed（见 `docs/RELEASE.md`）。
- 模型请求由用户自带密钥（BYOK）直连用户配置的端点，本产品不经手、不存储密钥明文。

## 7. 责任划分

- BYOK：密钥由用户提供与保管，责任在用户；本产品只用 safeStorage 加密存储。
- 无云同步意味着跨设备数据由用户自行迁移，本产品不提供托管。
