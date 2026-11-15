/**
 * 赛博朋克预设的 CSS（霓虹青 × 酸性绿 × 深渊底）。
 *
 * 为什么放在 TS 里而不是 .css 文件：桌面端的纯逻辑测试跑在 Node 下，
 * Node 不认识 Vite 的 `?raw` 导入；放成字符串模块两边都能用。
 * 源文件见 apps/desktop/src/themes/cyberpunk.css（同一份内容，可直接拷给用户改）。
 */
export const cyberpunkCss = `/* 赛博朋克预设：霓虹青 × 酸性绿 × 深渊底。
 *
 * 用法（内置预设，设置页点「应用」即可）：
 *   也可以复制到 .ghost/ui/custom.css 自行改造。
 *
 * 写法说明：变量挂在 html:root 而不是 :root —— 我们的浅色主题用
 * 'body.theme-light' 覆盖同一批变量（特异度更高），只有用 html:root
 * 才能保证这套配色在浅色模式下也完整生效。
 */
html:root {
  --surface-lowest: #07070f;
  --surface-low: #0d0d1c;
  --surface-mid: #14142a;
  --surface-high: #1d1d3a;
  --on-surface: #e8e6ff;
  --on-surface-variant: #9a96d6;
  --outline: #34325f;
  --accent: #00f0ff;
  --accent-hover: #9dfbff;
  --accent-container: #052a33;
  --on-accent: #001316;
  --danger: #ff2e88;
  --warn: #ffe45e;
  --ok: #3dff9e;
  --radius-md: 4px;
  --radius-lg: 8px;
}

/* 品牌与标题：霓虹辉光 + 字距 */
html:root header .brand {
  color: var(--accent);
  text-shadow: 0 0 10px rgba(0, 240, 255, .55);
  letter-spacing: .14em;
  text-transform: uppercase;
}
html:root header {
  border-bottom: 1px solid var(--outline);
  box-shadow: 0 1px 0 rgba(0, 240, 255, .16);
}

/* 页签：选中项是「青色电池」 */
html:root #tabs button.on {
  background: var(--accent-container);
  color: var(--accent);
  box-shadow: inset 0 0 0 1px rgba(0, 240, 255, .45);
}

/* 主按钮：发光 */
html:root #composer button,
html:root .flowbar button.primary {
  background: var(--accent);
  color: var(--on-accent);
  box-shadow: 0 0 16px rgba(0, 240, 255, .45);
}
html:root #composer button:hover {
  background: var(--accent-hover);
  box-shadow: 0 0 22px rgba(0, 240, 255, .7);
}

/* 次要按钮：暗底 + 青边，悬停时发光 */
html:root .panelbar button,
html:root .marketbar button,
html:root .lrow button,
html:root .toolbar button {
  border-color: rgba(0, 240, 255, .25);
}
html:root .panelbar button:hover,
html:root .marketbar button:hover,
html:root .lrow button:hover,
html:root .toolbar button:hover {
  box-shadow: 0 0 12px rgba(0, 240, 255, .35);
}

/* 输入：聚焦时青边 + 内发光 */
html:root #composer textarea:focus,
html:root .fefield input:focus,
html:root .fedge input:focus,
html:root .medit textarea:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent), 0 0 18px rgba(0, 240, 255, .22) inset;
}

/* 消息与卡片：用户消息左边一道青光 */
html:root .msg.user .body {
  background: var(--accent-container);
  box-shadow: inset 2px 0 0 var(--accent);
}
html:root .tcard {
  border-color: var(--outline);
}
html:root .tcard.result {
  border-color: rgba(0, 240, 255, .4);
}

/* 状态徽标：跑动的青、完成绿、失败品红 */
html:root .lstate.running { color: var(--accent); text-shadow: 0 0 8px rgba(0, 240, 255, .5); }
html:root .lstate.done { color: var(--ok); text-shadow: 0 0 8px rgba(61, 255, 158, .4); }
html:root .lstate.failed { color: var(--danger); text-shadow: 0 0 8px rgba(255, 46, 136, .45); }
html:root .tstage.person { background: rgba(255, 46, 136, .18); color: #ff9dc6; }

/* 滚动条：暗一点，别抢戏 */
html:root ::-webkit-scrollbar { width: 10px; height: 10px; }
html:root ::-webkit-scrollbar-thumb { background: var(--surface-high); border-radius: 6px; }
html:root ::-webkit-scrollbar-thumb:hover { background: var(--outline); }
`
