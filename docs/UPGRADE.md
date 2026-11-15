# 升级 harness 运行手册（C1-04）

> 对应 PLAN §5.3、§14 红线。`scripts/upgrade-harness.mjs` 是升级 harness 的**唯一入口**。
> 原则：只跟最新 harness，不改 harness 源码、不 fork、不写兼容旧版的分支；
> 所有兼容代码只活在 `packages/harness-port/**`。

## 1. 两条路径不是一回事

`scripts/harness-paths.mjs` 统一解析，升级脚本与契约探针都复用它，不要另写一套：

| 变量 | 指向 | 用途 |
|---|---|---|
| `DSH_HARNESS_ROOT` | 源码检出（缺省 `D:\code\deepseek-harness`） | 契约探针、升级流水线：**纯源码只读扫描**，没有构建产物，不能启动宿主 |
| `DSH_DSH_MODULES` | 运行时 npm 安装（缺省 `spikes/p05-transport/node_modules`） | 启动宿主、`gen:remotes` 用 |

优先级：命令行显式参数 > 环境变量 > `.env` > 默认布局。显式配置无效时严格报错
（exit 2），不静默回退，否则探针会在不知情的情况下校验了另一份源码。

## 2. 前置条件

- Node v22.22.2（脚本用 `import.meta.dirname`、顶层 await 与内置 fetch）。
- 源码检出可读，且 `packages/`、`pnpm-workspace.yaml` 齐全。
- 基线全绿：`npm test`、`npm run typecheck`、`npm run check:ui`、
  `npm run verify:contract`、`npm run check:secrets` 都通过再动手。
- 工作区干净或清楚自己有哪些未提交改动：脚本默认**不自动提交**。

## 3. 三种用法

```sh
# 1) 只看计划（缺省 --dry-run）：不执行命令、不改任何文件
node scripts/upgrade-harness.mjs 0.2.3

# 2) 看结构化计划（供 CI / 脚本采集）
node scripts/upgrade-harness.mjs 0.2.3 --cordis 4.2.0 --json

# 3) 真正按序执行并落盘
node scripts/upgrade-harness.mjs 0.2.3 --apply

# 3b) 额外只提交 matrix.json 这一个文件（仍不 push）
node scripts/upgrade-harness.mjs 0.2.3 --apply --commit
```

注册到根 package.json 后等价命令是 `npm run upgrade:harness -- 0.2.3`。

**默认绝对安全**：不带 `--apply` 时，版本改写函数
（`lib-models.mjs` 的 `rewritePackageVersions`）只计算不写盘，8 步命令一条都不跑。
日常核对计划用 dry-run 即可。

## 4. 固定 8 步（顺序不可调）

顺序的唯一真相源是 `lib-models.mjs` 的 `buildUpgradePlan` / `UPGRADE_STEP_IDS`。
任一步失败即停，并打印「该改哪个 port 文件」。

| # | 步骤 | 做什么 | 失败先改哪里 |
|---|---|---|---|
| 1 | 改版本 | 把根 `package.json` 里 `@deepseek-ai/*` 依赖版本改成目标值（落盘，仅 `--apply`） | `packages/harness-port/src/remotes.generated.ts`（由 `gen:remotes` 重生成） |
| 2 | 提示 install | 打印 `pnpm install` / `npm install` 提示，脚本不自动装依赖 | `packages/harness-port/**` |
| 3 | 契约探针 | `scripts/verify-harness-contract.mjs --json`，131 项检查 | `harness-contract/contract.json`（漂移项在此登记，不改 harness） |
| 4 | typecheck | `npm run typecheck` | `packages/harness-port/src/**/*.ts` |
| 5 | test | `npm test` | `packages/harness-port/src/**/*.ts` 与对应 `tests/**` |
| 6 | 冒烟 | `npm run verify:plugin-boot`：起只装我们 bundle 的 profile，验插件装载 | `packages/harness-port/src/transport.ts` |
| 7 | 界面回归提示 | 只打印 L5 提示，不执行（L5 每日跑、不进 PR） | `apps/desktop/src/**` |
| 8 | 写矩阵 | 写 `harness-contract/matrix.json`，可选只提交该文件 | `harness-contract/matrix.json` |

### 关于第 1 步的 cordis

`@deepseek-ai/cordis` 是独立版本线（基线 4.1.0，而 dsh-* 是 0.2.2-rc.3），
缺省**保持不动**，只改其余 `@deepseek-ai/*` 键。要一起升就显式传 `--cordis <version>`。
这样避免把 cordis 误写成 dsh 的版本号。

### 关于第 6 步的「一条 Ticket」

`verify:plugin-boot` 是无 key、确定性的装载冒烟：启动 profile、确认我们的插件被
harness 加载。完整「开 Ticket → 改文件 → 出结果」需要真模型，用 `npm run ticket`
（读 `.env` 的 `WB_*`），由人工在发版前补跑；升级流水线为保持确定性只做装载冒烟。
这是本手册记录的边界，不是遗漏。

### 关于第 8 步的提交与 push

脚本**绝不执行 git push**。默认连 commit 都不做，只写文件并打印提示。
`--commit` 才用 `git add harness-contract/matrix.json` 加
`git commit ... -- harness-contract/matrix.json` 只提交这一个文件。
理由：本仓库多线并行开发，自动提交会裹挟其它人的未提交改动；只指定单文件可把
影响面收到最小。最终 push 由人工决定。

## 5. matrix.json 记什么

`harness-contract/matrix.json` 的 `entries[]` 每条记录：

| 字段 | 含义 |
|---|---|
| `harness` | 已验证的 harness 版本 |
| `date` | 验证日期（ISO 日期） |
| `cordis` | 当次 cordis 版本 |
| `probe` | `{ total, passed, errors }`，来自契约探针的 `--json` 输出 |
| `endpoints` | `harness-contract/remotes.json` 的端点总数（基线 224） |
| `result` | `pass` / 后续可由人工改判 |
| `note` | 说明，含「未 push」字样 |

同版本重复执行会覆盖旧条目，不会无限追加。

## 6. 常见故障

- `没找到 harness 检出`：设 `DSH_HARNESS_ROOT` 或 `--harness <dir>`；确认是源码检出
  而不是 node_modules 安装目录。
- 第 3 步报 error 级漂移：改 `contract.json` 登记 + `packages/harness-port/**` 适配，
  **不要去改 harness 源码**。warn 级漂移先跑 `npm run typecheck` 定性。
- 第 4/5 步红：多数是 RPC 参数名或类型变了，重跑 `npm run gen:remotes` 生成
  `remotes.generated.ts`，再修 port 层。
- 第 6 步起不来：确认 `DSH_DSH_MODULES` 指向有 `lib/bin.js` 的运行时安装，
  以及 `scripts/cordis.patch.template.yml` 未被改动（它是唯一真相源）。
- `版本号不合法`：只接受三段数字加可选预发布后缀，如 `0.2.3`、`0.2.3-rc.1`；
  不接受 `latest`、路径、空串。

## 7. 与门禁的关系

升级属于「harness 升级」时机（PLAN §13.3）：契约探针 + L0/L1/L2 + L3 冒烟做跨版本
行为对比。CI 里 PR 不跑升级，每日只跑 `verify:l3`；升级本身由人工按本手册执行。
`verify:gates` 汇总的门禁表可作为升级前后的对照基线。

## 8. 退出码

| 码 | 含义 |
|---|---|
| 0 | dry-run 计划打印完 / `--apply` 全流程通过 |
| 1 | 任一步失败，或版本号不合法 |
| 2 | 用法或环境错误（缺参数、未知参数、`--commit` 缺 `--apply`、检出缺失） |
