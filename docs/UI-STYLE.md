# UI 与交互风格规范

> 适用：`apps/desktop/renderer`（Windows 优先）。目标：**鼠标可达一切、不要求记任何东西、看起来像一个成熟工具而不是一个网页**。

## 1. 对标分析：WorkBuddy 的设计系统（实测）

从本机安装包 `app.asar` 里直接提取到的设计变量（不是猜的）：

| 维度 | WorkBuddy 的实际取值 |
|---|---|
| 字号阶 | 12 / 14 / 16 / 18 / 20 / 24 / 28 / 35 / 60 px，全部乘 `--scaling`（用户可调） |
| 圆角阶 | 3 / 4 / 6 / 8 / 12 / 16 px，全部乘 `--radius-factor`（预设 0 / .75 / 1 / 1.5） |
| 表面（亮） | `#fff` → `#f2f2f7` → `#ececf4` → `#f1f0ff` |
| 表面（暗） | `#121212` → `#18181b` → `#232329` → `#31303b` |
| 正文色 | `#1b1b1f`（亮）/ `#e3e3e8`（暗） |
| 描边 | `#767680` / `#8e8d9c`，弱描边 `#c5c5d0` / `#46464f` |
| 品牌紫 | `#5753d0` hover · `#5b57d1` · `#4a47b1` · 按下 `#4440bf`；暗色 `#bbb8ff` / `#b2aeff` / `#d0ccff` |
| 主容器 | `#e0dfff` / `#403e6a` |
| 危险 | `#db6965` / `#ffa8a5`，底 `#fff0f0` / `#fbcbcc` |
| 半透明面板 | `#ffffffb3`（带 vibrancy） |

**读出来的三件事**：

1. 它用的是 **Material 3 语义命名**（surface / on-surface / outline / outline-variant / container），不是随手写的色号。这套命名值得照抄——交接和实现都没有歧义。
2. 它把 **字号** 和 **圆角** 做成用户可调系数。这是很少人做的正确决定，我们照做。
3. 品牌是**紫色**。我们不复用——撞色等于自我降级成"另一个 WorkBuddy"。

## 2. 我们的选择

| 项 | 决定 | 理由 |
|---|---|---|
| 语义命名 | 照抄 M3 那套 | 零歧义 |
| 品牌色 | **石墨中性 + 青绿强调**（不用紫） | 与 WorkBuddy 区分；青绿在暗色下不刺眼，符合"少打扰" |
| 密度 | 正文 14 / 辅助 12 / 标题 20，行高 1.5 | 与对标同级，专业工具手感 |
| 主题 | **暗色优先**，亮色同权 | agent 常驻后台，暗色是主场景 |
| 可调 | 字号 0.9/1.0/1.1/1.25；圆角 0.75/1/1.25 | 学它的正确做法 |

## 3. 设计 token

```css
:root[data-theme="dark"] {
  --surface-lowest:#141412; --surface-low:#1c1c1a; --surface-mid:#222220;
  --surface-high:#2c2c2a;  --surface-highest:#35332f;
  --on-surface:#eceae4;    --on-surface-variant:#b4b2a9;
  --outline:#8a8880;       --outline-variant:#45443f;
  --accent:#5dcaa5;        --accent-hover:#9fe1cb; --accent-press:#1d9e75;
  --on-accent:#04342c;     --accent-container:#0f3d31; --on-accent-container:#c9f2e2;
  --danger:#f09595; --warn:#fac775; --ok:#97c459;
}
:root[data-theme="light"] {
  --surface-lowest:#fff;   --surface-low:#f7f6f3; --surface-mid:#f1efe8;
  --surface-high:#eae7de;  --surface-highest:#e0ddd3;
  --on-surface:#2c2c2a;    --on-surface-variant:#5f5e5a;
  --outline:#888780;       --outline-variant:#d3d1c7;
  --accent:#0f6e56;        --accent-hover:#1d9e75; --accent-press:#04342c;
  --on-accent:#fff;        --accent-container:#e1f5ee; --on-accent-container:#04342c;
  --danger:#a32d2d; --warn:#854f0b; --ok:#3b6d11;
}
:root {
  --font-ui: "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
  --font-mono: "Cascadia Code", Consolas, ui-monospace, monospace;
  --text-xs:calc(12px * var(--scaling)); --text-sm:calc(13px * var(--scaling));
  --text-md:calc(14px * var(--scaling)); --text-lg:calc(16px * var(--scaling));
  --text-xl:calc(20px * var(--scaling)); --text-2xl:calc(24px * var(--scaling));
  --radius-sm:calc(6px * var(--radius-factor));  --radius-md:calc(8px * var(--radius-factor));
  --radius-lg:calc(12px * var(--radius-factor)); --radius-xl:calc(16px * var(--radius-factor));
  --scaling:1; --radius-factor:1;
  --dur-fast:120ms; --dur-base:160ms; --ease:cubic-bezier(.2,0,0,1);
}
```

规则：

- **只有两级字重**：400 / 500。禁止 600/700。
- **数字一律 `font-variant-numeric: tabular-nums`**（用量、耗时、行号、token 数）。
- **卡片不用阴影**，用 `--surface-*` 层级差 + 0.5px `--outline-variant`。阴影只给浮层（菜单、弹窗、拖拽预览），最多两级。
- 间距只用 4 的倍数：4 / 8 / 12 / 16 / 24 / 32。组件内边距 8/12，区块之间 16/24。

## 4. 布局

```
┌──────────────────────────────────────────────────────────┐
│ 顶栏 44px  ← 返回/前进 · 当前工作区 · 命令入口 · 窗口操作   │
├──────────┬───────────────────────────┬───────────────────┤
│ 左栏 260 │ 中栏 flex（对话流）        │ 右栏 360（结果）   │
│ 可拖 200 │                           │ 可折叠             │
│  -360     │                           │ 概览 / 产物 / 变更 │
├──────────┴───────────────────────────┴───────────────────┤
│ 状态条 24px  ← 模型 · 上下文占用 · 队列 · 连接状态          │
└──────────────────────────────────────────────────────────┘
```

- 左栏：任务/会话树，按文件夹分组（对标它），搜索在顶部常驻。
- 右栏可折叠，折叠后中栏撑满；**折叠状态要记住**。
- 面板分隔线支持拖拽改宽，双击回到默认宽度。
- 剧本编辑器是**全屏模式**（从右栏或命令入口进），不是嵌在右栏——流程图需要面积。

## 5. 组件规范（要点）

| 组件 | 规范 |
|---|---|
| 按钮 | 三档：主要（`--accent` 底）、次要（描边）、文字。高度 28 / 32；圆角 `--radius-md`；图标左置 16px，间距 6px |
| 输入 | 高 32，内边距 8×10，1px `--outline-variant`，聚焦 2px `--accent` 外描边 + 2px offset |
| 卡片（工具调用/结果块） | `--surface-low` 底 + 0.5px 描边 + `--radius-lg`，内边距 12×14 |
| 列表行 | 高 32，悬停 `--surface-high`，选中 `--accent-container` + 左侧 2px `--accent` 竖条 |
| 标签/状态点 | 状态点 6px 圆点 + 12px 文案；不用大面积色块 |
| 弹窗 | 宽 480/640 两档，`--radius-xl`，遮罩 `rgba(0,0,0,.45)`；ESC 关闭；**焦点默认落在主按钮** |
| Toast | 右下角，最多 3 条，4 秒自动消失，可悬停暂停 |
| 空态 | 一句话说明 + 一个主按钮，居中，不配插画 |
| 加载 | 骨架屏（保持行高一致）；禁止全屏转圈 |
| 错误 | 就地显示在该组件内，人话 + 一个动作按钮（重试/查看详情） |

## 6. 交互规范（这一节是纪律）

1. **鼠标可达一切，≤2 次点击**。快捷键只做加速，且必须同时出现在菜单或右键里。
2. **不要求记忆**。没有"按 `Shift+Alt+K` 才能做到"的功能。
3. **拖拽优先**：重排、连线、分栏宽度、文件拖入，都用拖的。
4. **破坏性操作一律可撤销**，不堆确认弹窗。撤销同时提供 `Ctrl+Z` 和界面按钮。
5. **右键菜单是功能发现的主入口**：任何对象右键都要能看到"对它还能做什么"。
6. **悬停才出现的控件，必须另有一个常驻入口**（无鼠标/触屏/辅助技术可用）。
7. **流式输出不平滑滚动**：贴底时自动跟随，用户上滚即停止跟随，出现"回到最新"按钮。
8. **动效只用两种**：淡入（`--dur-fast`）和位移 ≤8px 的展开（`--dur-base`）。禁止弹簧、禁止弹跳、流式文字不做动画。
9. **任何操作都要 400ms 内有反馈**（骨架、按钮态、进度点），超过就放不确定进度。

## 7. 无障碍与可调

- 字号与圆角可调（同 WorkBuddy 的思路），设置里三档，即时生效。
- 正文对比度 ≥ 7:1（AAA），次要文字 ≥ 4.5:1。
- 焦点环始终可见（不允许 `outline:none` 无替代）。
- 所有图标按钮必须有 `aria-label`。
- 尊重系统"减少动态效果"：开启后位移改为纯淡入。

## 8. 落地

```
apps/desktop/renderer/
├── styles/tokens.css      # 上面的变量
├── styles/base.css        # reset + 排版 + 焦点
└── components/            # button / input / card / list / modal / toast / empty / skeleton
```

约束：组件**只允许**用 `styles/tokens.css` 里的变量，禁止写死色值。CI 加一条 grep 检查 `#[0-9a-f]{3,8}` 出现在 `components/` 就报错。

## 9. 不做

- 不做玻璃拟态、渐变、发光、大圆角卡片堆叠。
- 不做主题市场（亮/暗两套足够）。
- 不做移动端适配（Windows 桌面优先）。
- 不为了"好看"牺牲密度——这是工具，不是官网。
