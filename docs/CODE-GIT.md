# 看代码、看差异、处理合并

> 回答「能像 VSCode 那样看代码、看 git 差异、处理合并吗？」
> 结论：**能，但分工不同**——看代码在界面里完成，差异与合并由**壳侧**调真 git 完成。

## 0. 三件事的现状

| 能力 | 之前 | 现在 |
|---|---|---|
| 看代码 | 工作区面板能预览纯文本，**无高亮、无行号、单文件** | **多标签 + 语法高亮 + 行号 + 超长保护 + 冲突横幅** |
| 看 git 差异 | **没有**（宿主有 `workspaceFiles/changes`，但它是 stream 方法，渲染层调不到） | 新增「**变更**」页：文件列表 + 增删行数 + 逐行差异 |
| 处理合并 | **没有** | 冲突文件可一键「**用我方 / 用对方**」，并自动 `git add` 标记已解决 |

## 1. 为什么差异与合并放在壳侧

宿主确实有 `dsh-workspace-changes`（按 git 工作树快照记录每轮变更，带结构化 diff），
但它的对外端点 `workspaceFiles/changes` 是 **stream 方法**：

```
workspaceFiles/changes 失败：gateway/signature-invalid
typert gateway: workspaceFiles/changes: stream Remote methods must be opened through the stream carrier
```

渲染层用普通 `transport.call` 调会被 gateway 拒。而差异与合并本质上需要**真 git**
（`git status` / `git diff` / `git checkout --ours`），所以放到壳（Node）里做：

```
渲染层  ──IPC(workspace:git)──▶  壳  ──execFile('git', [参数数组])──▶  仓库
```

安全上：只用 `execFile` + **参数数组**，不经过 shell，路径作为独立参数 → 没有命令拼接、没有注入面；
并且**只暴露四个固定操作**（`changes` / `diff` / `conflicts` / `resolve`），不接受任意子命令。

## 2. 看代码

工作区面板的预览区升级成「编辑器」：

- **多标签**：点开多个文件，顶部标签切换；
- **语法高亮**：自己写的极简词法（关键字 / 字符串 / 注释 / 数字 / 标签），
  支持 ts / js / json / css / html / py / md / sh；**不引第三方高亮库**（界面自建的东西越少依赖越少）；
- **行号**：左侧对齐行号，选中复制时会带上——自己写高亮的代价我们认了。
- **超长保护**：默认只渲染前 1200 行，并提示总行数（避免一次把十万行灌进界面与上下文）。
- **冲突横幅**：文件里有 `<<<<<<<` / `=======` / `>>>>>>>` 就在顶部亮红条，指去「变更」页处理。

高亮做了**转义**：文件里的 `<script>` 只会显示成文本，不会变成真标签。

## 3. 看差异

新增「变更」页（工作区旁边）：

- 左列：变更文件（新增 / 修改 / 删除 / 重命名 / 未跟踪 / 冲突 徽标）+ `+N / -N`；
- 右列：选中文件的 unified diff，增删行分色、行号对齐；
- 顶部：变更文件总数。

数据来自 `git status --porcelain=v1` + `git diff --numstat HEAD`。

## 4. 处理合并

- 冲突文件列表来自 `git diff --name-only --diff-filter=U`；
- 每个冲突文件给两个按钮：**用我方**（`git checkout --ours`）/**用对方**（`--theirs`），
  写回后自动 `git add` 标记为已解决；
- **安全**：只允许操作 git 自己报告的冲突文件（别的路径直接拒），且不接受任意命令。

`git-view` 包里的纯逻辑（找冲突块、按我方/对方/两者都留解决冲突）也有测试，
未来做「三方合并编辑器」时可以直接复用。

## 5. 边界

- **浏览器里没有 git 通道**：`window.shellApi.git` 只在桌面端（Electron）存在；
  浏览器里打开「变更」页会明确提示「需要桌面端」，不假装有数据。
- **不替代 VSCode**：没有 LSP、没有跳转定义、没有多光标编辑。
  我们的定位是「不用离开界面就能看清代码与改动」，真要重度编辑仍然该用专业编辑器。
- **不自动提交**：只到「解决冲突并标记已解决」为止，`git commit` 仍然交给人或模型。
- 差异只覆盖**工作树**（未提交改动），不含暂存区与分支之间的比较。

## 6. 相关文件

| 文件 | 作用 |
|---|---|
| `packages/git-view/` | 纯解析：porcelain 状态、numstat、unified diff、冲突块与解决 |
| `apps/shell/src/git-view.ts` | 壳侧执行 git（execFile，无 shell） |
| `apps/shell/src/electron-ipc.ts` | `workspace:git` IPC（四个固定操作） |
| `apps/shell/preload.cjs` | 暴露 `shellApi.git` |
| `apps/desktop/src/changes-panel.ts` | 变更与合并面板 |
| `apps/desktop/src/code-view.ts` | 高亮 / 行号 / 超长保护 / 冲突检测 |
| `apps/desktop/src/workspace.ts` | 工作区面板（多标签 + 代码视图） |

## 7. 验证

- `npm run test:git-view`：状态映射、numstat、diff 行号、冲突块与解决（4 个）。
- `npm run test:code-view`：语言识别、HTML 转义、行号与超长、冲突标记、变更归一化与差异渲染（6 个）。
- `npm run check:shell` / `check:ui` / `build:ui` 全过；557 个用例、门禁 7/7。
