# 浏览器扩展：在任意页面里直接和 agent 对话

> 回答「支持直接在浏览器插件 AI 会话吗」——**支持**：一个 Chrome/Edge MV3 扩展，
> 侧栏里就能和本机 dsh-ghost 对话，不用切回应用。

## 0. 怎么用（三步）

1. **应用里出码**：设置 → 浏览器扩展 → 「生成配对码」，记下 6 位码；
   同一页有「应用地址」（如 `http://127.0.0.1:51234`）。
2. **加载扩展**：Chrome/Edge → `chrome://extensions` → 打开「开发者模式」→
   「加载已解压的扩展程序」→ 选仓库里的 **`apps/extension`** 目录。
3. **侧栏配对**：点扩展图标打开侧栏 → 填「应用地址 + 配对码」→ 配对成功后直接聊天。

## 1. 配对为什么这么设计

- **设备码式**：应用显示 6 位码，用户手动输入扩展。**本地任何进程都不能凭空配上**——
  不能因为「在 localhost 上」就默认信任。
- **一次性 + 5 分钟过期**：码用过即废。
- **token 不进扩展**：壳用自己的 token 跟宿主换 Cookie，只把 **Cookie 名值**给扩展，
  由扩展写进浏览器（`chrome.cookies`），之后所有请求用 `credentials:'include'`。
  扩展里**永远拿不到宿主 token**。

## 2. 扩展里能做什么

- 在任意页面旁边开侧栏，与**本机**的 agent 对话（跑的是你本机的模型与工具链，不是云端）；
- 会话是扩展自己建的（`session/create`），与主界面互不干扰；
- 发送后轮询 `session/page` 取回复（宿主没有给扩展推消息的通道，轮询简单可靠）。

## 3. 文件与端点

| 文件 | 作用 |
|---|---|
| `apps/extension/manifest.json` | MV3 清单（侧栏 + `cookies` + `storage` 权限） |
| `apps/extension/background.js` | 配对、调用宿主 API（typert 网关的 client-request 形状） |
| `apps/extension/sidepanel.html/.js/.css` | 侧栏界面 |
| `apps/shell/src/extension-pairing.ts` | 配对码（一次性、5 分钟） |
| `apps/shell/src/electron-static.ts` | `POST /extension/pair` 路由（换地址 + Cookie） |
| `apps/shell/src/main.ts` | 用宿主 token 换 Cookie |

宿主侧用到的端点只有三个：`session/create`、`session/prompt`、`session/page`。

## 4. 安全边界

- 扩展**只能**调本机宿主 API，且必须先配对；
- 配对码一次性、5 分钟过期；
- 宿主 token 不出壳、不进扩展；
- 扩展只请求 `http://127.0.0.1/*`（`host_permissions` 限定回环）；
- 扩展不注入页面、不改页面 DOM——它只是侧栏里的一个聊天口。

## 5. 已知边界

- **只支持 Chrome/Edge 114+**（侧栏 API 要求）；
- 扩展与主界面是**两个会话**（各自的 `sessionId`），不是同一个上下文的两个窗口；
- 宿主重启后端口会变，扩展需要**重新配对**（地址与 Cookie 都要换）；
- 没有做「把当前页面内容自动带进会话」——那属于页面注入，需要额外的权限与明确授权，
  暂时不做。
