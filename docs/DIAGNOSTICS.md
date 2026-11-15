# 诊断包（C5-10）

> 用途：用户排障时一次性导出本机信息。**必须先脱敏再落盘**，
> token / API key / Cookie 一律不打进包。导出只写用户选择的本地路径，不自动上传。

## 1. 收集内容

`apps/shell/src/diagnostics.ts` 组装以下文件（均经脱敏）：

| 文件 | 内容 |
|---|---|
| `versions.json` | 产品 / 壳 / Electron / Chromium / Node 版本 |
| `host-health.json` | 宿主健康状态、runtime 状态、端口、重启次数 |
| `tickets.json` | 票状态（当前为空占位，需接宿主 Remote 后才有数据，属外部依赖） |
| `environment.json` | 平台 / 架构 / locale / 遥测与崩溃开关等白名单信息 |
| `logs-tail.txt` | 日志尾（当前会话内存缓冲） |
| `README.txt` | 清单与「已脱敏」说明 |

环境信息只取白名单键，**不导出 `process.env` 全量**（避免把 WB_KEY 之类带出去）。

## 2. 脱敏规则（`redactText` / `redactValue`）

双重处理，保证零命中：

1. 已知敏感值（当前一次性 token 等）按长度降序精确替换为 `[REDACTED]`，
   避免「短串是长串子串」先替换导致残留。
2. 正则兜底覆盖常见形态：
   - `token=...` URL 参数
   - `Authorization: Bearer ...`
   - `Cookie: ...` 整行
   - JSON 里 `"token" / "apiKey" / "secret" / "password" / "cookie" / "authorization"` 字段
   - `sk-...` 形式密钥
3. `redactValue` 对敏感字段名**整值替换**，并递归处理对象与数组。

## 3. 安全存储降级（C5-13 / C2-03）

- `safeStorage`（Windows 即 DPAPI）可用：settings 里只存 `{v:1, items}` 的 base64 密文。
- 不可用：**明确降级**为「仅内存、不落盘、重启失效」，`CredentialVault.set` 返回
  `unavailable` 且不写任何文件。**任何情况下都不把凭据明文写进 settings**。

## 4. zip 生成（无第三方依赖）

`buildDiagnosticZip` 用纯 JS 手写 ZIP（store 模式，无压缩）：
本地文件头 + 数据 + 中央目录 + EOCD，CRC32 自建表，文件名 ASCII、内容 UTF-8。
不引入必须联网安装的依赖。

## 5. 导出方式

- 菜单「文件 -> 导出诊断包」或设置项，经 `contextBridge` 的最小 API 调
  `ipcMain` handler；用系统保存对话框选路径后写 `.zip`。
- 不联网、不自动上传、不打包用户工作区文件正文。

## 6. 自检

- `test:shell` 的 `diagnostics.test.ts`：用假 token / key / cookie 断言文件内容与
  zip 字节零命中，并解析 ZIP 本地头校验文件名与数据可还原。
- `verify:shell` 的 `diagnostics-redaction` 项用同样口径做静态自检（可脱离测试框架运行）。

## 7. 用户须知

- 诊断包仍可能包含本机路径、版本号与日志文本，分享前请自行过目。
- 删除诊断包即删除本地副本；本产品不保留云端副本（见 `docs/PRIVACY.md`）。
