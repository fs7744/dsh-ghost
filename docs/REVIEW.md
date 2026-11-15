# Plan Review

> 对 [PLAN.md](../PLAN.md) 的挑刺。按严重度排序，每条给「为什么是问题 / 建议怎么改」。最后是必须改的清单。

## 先说做得对的（不然只剩唱衰）

1. **`harness-port` + 契约探针**是真机制，不是口号：128 项、能跑、抓到过我自己的两处判断错误。
2. **白拿/自建的分账**很清楚，203 项能被核对。
3. **剧本的两种表示有实测数据支撑**（8.7×），不是拍脑袋。

下面全是问题。

---

## R1（最高）契约面在 renderer 侧二次膨胀

**问题**：探针只覆盖 superagent **宿主侧**（128 项）。但现在界面自建，renderer 要消费 `api/*` 的 Remote 契约——约 28 个 api 包、几十个方法、几十个事件流。**真正的耦合点从宿主挪到了 renderer**，而那里一个检查都没有。

「只升级 harness 不改我们」的承诺，会在 UI 层第一个破功。

**建议**：把 Remote 方法/事件也纳入契约清单，且**从编译产物自动生成**（`ctx.typert.local` 的 descriptor），不要手写。探针扩到 300+ 项是正常的。

## R2（最高）`ctx.remote` 能否脱离 harness 的 client 运行时，没人验证过

**问题**：`api-gateway/client` 是 **Cordis client 环境**里的服务。我们的 renderer 要复用它，要么跑一个最小 Cordis client，要么只用它的传输层手写 RPC。这两条路差别巨大，但计划里当作"显然可行"。

**这是整个自建界面方案的地基**。它不成立，P3 的 25 项界面全部悬空。

**建议**：加 **P0.5 spike**（1 项，1–3 天）：不加载任何 `ui-*`，只用 gateway client 调一个方法（列出会话）并在窗口里渲染出来。成功才继续 P3；失败则退到"直接复用 Connection 传输 + 手写 RPC 客户端"。

## R3 P3 的 39 项被严重低估

**问题**：P1 = 64 项标 L，P3 = 39 项也标 L。但 P3 里 25 项是界面、3 项是剧本编辑器——工作量和 P1 完全不是一个量级。用同一个字母是自欺欺人。

**建议**：拆三段，各自可验收：
- **P3a** 最小闭环：壳 + 8 项界面（聊天流/工具卡片/审批/会话树/文件树/终端/面板/编辑器）。
- **P3b** 其余 17 项界面。
- **P3c** 剧本编辑器打磨（AI 生成、局部重写、试跑）。

## R4 测试分层缺一层：界面

**问题**：L0–L4 全是宿主侧。界面自建后，"面板白屏""卡片不渲染""拖拽连不上线"这类问题没有任何门禁。

**建议**：加 **L5 界面层**：Playwright 驱动 Electron，跑 3–5 条关键路径 + 截图基线。只进每日，不进 PR（太慢）。

## R5「剧本 = skill」和 harness 的 skill 目录会打架

**问题**：我们的 `.flow` 和编译产物 `SKILL.md` 要放在 `skills/<name>/` 下，而 `skill-filesystem` 会扫描这个目录。frontmatter 不合规、目录里有额外文件、命名冲突，都可能导致 skill 加载报错——**这是"升级就坏"的典型位置**。

**建议**：spike 里验证一格：手写一个最小 skill 目录 + `.flow` 同放，确认加载器只读 `SKILL.md` 且容忍同目录其他文件。若不容忍，`.flow` 移到 `playbooks/` 另存，编译期再投放。

## R6「唯一真相源是文本」在多人/多端下会变成冲突地狱

**问题**：用户只看图，git 里只有文本。两个人分别改，冲突落在文本上，而文本是机器生成的——人不会解。

**建议**：把 `.flow` 的行结构定成"**一节点一行**"，冲突大多落在不同行，git 能自动合并。已满足，但必须写进规范并加一条测试：两处改动合并后仍能通过校验。

## R7 界面 25 项的粒度不均，无法估工

**问题**：「聊天流」可能是 2 个月，「主题切换」可能是 2 天。放在同一张表里，25 项这个数字没有信息量。

**建议**：每项再拆到 **≤3 人日**，并对 5 项最大的单独列子任务。否则 P3 的排期只能靠感觉。

## R8 Windows 凭据方案写错了

**问题**：文档里写「安全存储（走系统钥匙串）」。Windows 没有 keychain——正确做法是 **DPAPI**（`CryptProtectData`，或 Electron `safeStorage`）。

**建议**：改成 `safeStorage`（Electron 内置，底层就是 DPAPI），并明确"明文永不落盘、永不进设置文件"。

## R9 界面文案没有归属

**问题**：空态、错误、引导、按钮——都要写文案，但 203 项里没有一项是"文案体系"。最后会散落在各组件里，风格不统一。

**建议**：加一项「文案与 i18n 词表」（中文先行，英文后补），并在 UI-STYLE 里定 tone（短句、动词开头、不卖萌）。

## R10 里程碑缺"能看见的中间态"

**问题**：P1 完成时用户看不到任何东西（只有宿主 + CLI）。要到 P3 才有界面。中间隔了很长一段"无法演示"的路。

**建议**：P1 结束就给一个**只读调试台**（一个网页/窗口，列出 Ticket 和事件流，不求样式），让每阶段都有可演示物。

---

## 必须改的六处（建议直接落到 PLAN）

| # | 改动 | 影响章节 |
|---|---|---|
| 1 | 新增 **P0.5 spike**：不加载 Web UI，只用 gateway client 列出会话并渲染 | §6 分期、§8.5 |
| 2 | 契约清单扩到 **Remote 方法与事件**，且从编译产物自动生成 | §5.1、§6 |
| 3 | P3 拆成 **P3a / P3b / P3c**，分别验收 | §6.2 |
| 4 | 测试加 **L5 界面层**（Playwright + Electron + 截图基线） | §11 |
| 5 | 凭据改 **Electron `safeStorage`（DPAPI）** | §8.3、FEATURES C5-13 |
| 6 | 界面 25 项拆到 **≤3 人日**，并新增「文案与 i18n 词表」1 项 | FEATURES C8 |

## 一句话结论

**架构是对的，风险全在"界面自建"这四个字上。** 把它拆成"先验证地基（P0.5）、再分三段交付（P3a/b/c）、并且给界面补上测试门禁（L5）"，这个计划就站得住了。

---

## 收尾核对（2026-11-15）

六处「必须改」全部落地，且都可跑命令验：

| # | 改动 | 现在在哪验 |
|---|---|---|
| 1 | P0.5 spike | `npm run verify:port`（取数 4/4 + 事件 `api-session/added`） |
| 2 | 契约清单扩到 Remote / 事件，自动生成 | `npm run gen:remotes`（224 端点）、`npm run gen:events`（31 事件）、`npm run verify:events`（漂移）、`npm run verify:contract`（131 项） |
| 3 | P3 拆 P3a/b/c | 26 项界面分三批：最小闭环 → 其余面板 → 剧本打磨，见 FEATURES §0.2 |
| 4 | L5 界面层 | `npm run verify:l5` + `tests/e2e/desktop-flow.spec.ts`（未装依赖时明确 SKIP） |
| 5 | Windows 凭据改 `safeStorage` / DPAPI | `apps/shell/src/credentials.ts`、`electron-safe-storage.ts`；`npm run verify:shell` 验降级与脱敏 |
| 6 | 界面拆细 + 文案词表 | `apps/desktop/src/i18n.ts`（中英词表 + 缺词回退）、每个面板 ≤3 人日粒度；`npm run test:panels` |

R1 的后半段（事件名自动生成）曾长期挂账，本轮用 `API_REMOTE_FORWARDED_EVENTS` 单一真相源补上；R8 的 keychain 错误写法已全部改成 DPAPI。R6 的「一节点一行」由 `edit.test.ts` 与 `verify:playbook-editor` 的重放确定性守着。

**仍未消除的是 §8.5 的两条 ABI 实测**（Electron 44 内置 Node ≥24.9、原生模块匹配）——它们需要真实 Electron 安装，不是文档能替代的。

---

## 代码复审（2026-11-16）

跑完 477 个用例、41 项验收之后，按「安全 → 正确性 → 打包 → 声明一致性」逐层读代码。下面只写**测试没覆盖到、但读代码能确认**的问题。

### 已修（都有回归用例）

| 级别 | 问题 | 位置 | 修法 |
|---|---|---|---|
| **高（安全）** | `read(name)` / `remove(name)` 直接拼路径，Remote 传 `..\..\x` 可读/删项目外 `.md` | `packages/memory/src/store.ts` | 所有入口统一校验收口 `isValidEntryName`；新增穿越测试 |
| **高（正确性）** | 已批准/已驳回的提案还能再次批准，重复写 L2；回滚只改状态、不删已写入的约束 | `packages/evolution/src/service.ts` | 人闸只允许 `pending`；回滚调用 `removeMemory` 真撤销；已决策提案不被再次 `propose` 重开 |
| 中（安全） | 提案 id 直接进文件名，`approve({id:'../x'})` 可读项目外 JSON | `packages/evolution/src/proposals.ts` | id 白名单 + `put` 拒绝非法 id |
| 中（运维） | GitHub 出口 4xx 永久失败仍每 10s 重试，永不停止 | `packages/sink-github/src/index.ts` | 4xx（除 408/429）立即 dropped；5xx 重试 `maxAttempts` 后 dropped |
| 中（发布） | Electron 里 `process.execPath` 是 electron.exe，直接 spawn 会把 `bin.js` 当第二个 Electron 应用；打包后 bin/icon 路径落在 asar 内 | `electron-host-launcher.ts` / `main.ts` | `ELECTRON_RUN_AS_NODE=1`；运行时与图标改走 `resources/`；新增 `prepare:runtime` 与 `build/runtime` 说明 |
| 中（正确性） | `runScript` 每次 Remote 调用都新建 runtime，幂等键永远不命中 | `packages/memory-plugin/src/index.ts` | 按 packageRoot 复用同一 runtime 实例 |
| 中（安全） | `ghostInit/draft` 接受任意 `root`，可扫全盘 | 同上 | 限定在 `repoRoot` 内；模板补 `repoRoot` |
| 中（健壮性） | 启动抛错（bin 缺失）时状态永远停在 `starting`；锁文件损坏时 `pid=-1` 会 `process.kill(-1)` | `runtime.ts` / `main.ts` | 启动失败走重试路径；非法 pid 直接判死 |
| 低（逻辑） | `@ghost` 用 `includes` 匹配，会误伤 `@ghostbusters` / `@ghost-bot` / 邮箱 | `packages/source-github/src/index.ts` | 加前后边界正则 |
| 中（功能） | 附件上传只发 `{name,size,type}`，**从来没传字节**；`receiptId` 也没进 prompt | `apps/desktop/src/attachments.ts` / `main.ts` | 读取 base64 → `fileUploads/upload` → receipt 作为 `file` part 进 `session/prompt` / `commands/execute` |

### 仍然存在（未修，按优先级）

**P0 发布阻断（需要外部环境，不是代码能否写完的问题）**

1. 安装包仍要真实打一次：`resources/runtime` 现在有配置与 `prepare:runtime`，但没跑过 electron-builder，也没在干净 Windows 上装过。
2. Electron 44 内置 Node 与 `node-pty` / `koffi` / `node:sqlite` 的 ABI 未实测；这决定 `ELECTRON_RUN_AS_NODE` 方案是否成立，失败就得改 sidecar Node。
3. 代码签名、NSIS 升级/卸载、真实 feed 与 `latest.yml` 未验证。

**P1 功能/一致性**

4. **剧本编辑不能写回文件**：只有「导出 .flow」；Electron 侧没有工作区写文件 IPC。README 已改成「回写文本」，但产品上还差最后一步。
5. **首启向导不收 API key**：向导只选模型来源，凭据要通过 `shellApi.setCredential`，GUI 里没有入口；首次启动可能无模型可用。
6. `settings_save` / `policy_sync` / `prompts_save` 的 `SettingsStore` 是内存实现，宿主重启即丢；模型库页的本机 `/api/models/*` 同样是内存 store。接口都留了 `CatalogStore` / 文件实现位。
7. **两套装配并存**：`packages/superagent/src/app/host` 的 `dsh-superagent` 入口没有被 cordis patch 加载，实际生效的是 orchestrator-plugin（现已注册 19 工具）。要么挂上它并去掉重复，要么明确它是备选方案。
8. 诊断包 `tickets()` 仍是空占位，未接 `ghostTickets/list`。
9. C2-02 的 Peer 角色级隔离、C4-07 的 L5 截图基线、C6 的 macOS/Linux 安装包：分别依赖 harness 访问控制、Playwright 依赖、平台环境，账本已改成「未完成/骨架」。

**P2 风险与债务**

10. `source-github` 无密钥时默认**跳过**签名校验（有测试固化该行为）。只允许本地调试；生产必须显式配置 `secret`，建议后续把默认改成拒绝。
11. 声明式映射的 `getPath` 允许 `__proto__` / `constructor` 路径，只读不写，风险低但建议加键黑名单。
12. GitHub 出口没有 429/Retry-After 处理；报告正文可能超过 GitHub 64KB 限制，现在会当 4xx 直接丢弃（不重试），但用户看不到失败提示。
13. 记忆 frontmatter 的 `title/source` 未转义换行，模型可以写坏索引格式（不会执行代码）。
14. `npm audit` 报 16 个漏洞（1 critical，多来自 electron-builder 依赖链）；未 `audit fix`，发版前必须处理或换构建链。
15. `check-port-discipline` 仍有 6 处白名单 WARN（插件必须用 `TypertRemoteService`），`--strict` 会失败；这是可接受的过渡态，但要写进升级检查单。
16. UI 大量 `innerHTML`，本次抽查的渲染点都做了 `escapeHtml`；但没有静态门禁防止以后漏写，建议加一条 lint 规则或 `escape` 封装。

### 复审结论

核心架构站得住：`harness-port` 是唯一适配层，领域核心零 harness 依赖，界面只消费 Remote，剧本文本是唯一真相源。测试深度在同类项目里算扎实（477 用例 + 41 项验收，且 L3 只断言结构）。**剩余风险集中在「真实打包/ABI」和「最后一段产品接线」**，不是核心正确性；这两类都不该用「已完成」三个字盖过去。
