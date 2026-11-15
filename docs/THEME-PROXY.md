# 皮肤与代理

## 1. 皮肤

### 内置：暗色 / 浅色 / 跟随系统

顶部工具栏的「主题」按钮循环切换：**暗色 → 浅色 → 跟随系统 → 暗色**。
选择记在 `localStorage.dsh-ghost.theme`，重启还在。

- 暗色是默认（`:root` 的变量就是暗色）；
- 浅色是 `body.theme-light` 的覆盖；
- 跟随系统监听 `prefers-color-scheme`，系统切了界面也跟着切。

### 自定义：放一份 CSS 就能换肤

把 CSS 放到 `.ghost/ui/custom.css`，覆盖 CSS 变量即可：

```css
:root {
  --accent: #7aa2f7;
  --accent-hover: #a6c1ff;
  --surface-lowest: #0b0d12;
  --surface-low: #12141b;
  --on-surface: #e6e8ef;
}
```

可覆盖的变量（见 `apps/desktop/src/style.css`）：

| 组 | 变量 |
|---|---|
| 表面 | `--surface-lowest` `--surface-low` `--surface-mid` `--surface-high` |
| 文字 | `--on-surface` `--on-surface-variant` |
| 描边 | `--outline` |
| 主色 | `--accent` `--accent-hover` `--accent-container` `--on-accent` |
| 语义色 | `--danger` `--warn` `--ok` |
| 形状 | `--font-ui` `--radius-md` `--radius-lg` |

设置页「自定义皮肤」区会列出**你实际覆盖了哪些变量**，并有「重新加载皮肤」按钮
（不用重启程序；文件改动即时生效）。

> 约定：自定义皮肤也用 `html:root` 开头写（和内置预设同特异度）。
> 同特异度时**后加载的生效**，而自定义皮肤永远在预设之后注入 → 你的自定义压得住预设。

实现：宿主插件 `ghost-ui` 读 `.ghost/ui/custom.css` → `ghostUI/customCss` →
桌面端注入成一个 `<style id="custom-skin">`。

### 内置预设：赛博朋克

设置页「自定义皮肤」区顶部就是**内置预设**：

| 预设 | 说明 |
|---|---|
| 默认 | 不注入任何 CSS，跟随内置的暗色/浅色变量 |
| **赛博朋克** | 霓虹青 × 酸性绿 × 深渊底 |

点「应用」即刻生效（保存在 `localStorage.dsh-ghost.skin`）；点「复制为可编辑皮肤」
则把整套 CSS 落到 `.ghost/ui/custom.css`，可以随便改。

赛博朋克的配色表：

| 变量 | 值 | 用意 |
|---|---|---|
| `--surface-lowest` | `#07070f` | 深渊底（页面最底层） |
| `--surface-low` | `#0d0d1c` | 面板底 |
| `--surface-mid` | `#14142a` | 输入框 / 中层 |
| `--surface-high` | `#1d1d3a` | 卡片 / 悬浮 |
| `--on-surface` | `#e8e6ff` | 冷白正文 |
| `--on-surface-variant` | `#9a96d6` | 次要文字 |
| `--outline` | `#34325f` | 描边 |
| `--accent` | `#00f0ff` | 霓虹青（主色） |
| `--accent-hover` | `#9dfbff` | 青色高亮 |
| `--accent-container` | `#052a33` | 青色容器（选中项、用户气泡） |
| `--on-accent` | `#001316` | 主色上的文字 |
| `--danger` | `#ff2e88` | 霓虹品红（失败） |
| `--warn` | `#ffe45e` | 琥珀（警告） |
| `--ok` | `#3dff9e` | 酸性绿（完成） |

除了变量，预设还带了一点**赛博朋克质感**（都是克制版的，别过度）：

- 品牌名霓虹辉光 + 字距（`text-shadow: 0 0 10px rgba(0,240,255,.55)`）；
- 主按钮发光、悬停时更亮（`0 0 16px` → `0 0 22px`）；
- 输入框聚焦时青边 + 内发光；
- 页签选中项是「青色电池」（内嵌青色描边）；
- 用户消息左边一道青光；
- 状态徽标各自带一点辉光（跑动=青、完成=绿、失败=品红）；
- 滚动条压暗，不抢戏。

预设源码在 `apps/desktop/src/themes/cyberpunk.ts`（另存一份
`apps/desktop/src/themes/cyberpunk.css` 方便直接拷给用户改）。

## 2. 网络代理

### 之前：完全不支持

宿主其实自带 `dsh-http-proxy`（按 `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` 解析，
装成 undici 的全局 dispatcher），但**我们的 profile 里没启用它**，所以出站请求
（模型请求、web_fetch 等）不走代理。

### 现在：界面里登记 → 重启宿主生效

1. **profile 启用代理插件**：`scripts/cordis.patch.template.yml` 里插入
   `@deepseek-ai/dsh-http-proxy`。
2. **界面登记**：设置页「网络代理」区填 `http` / `https` / `noProxy` →
   校验（只认 `http(s)://` 地址）→ 写 `.ghost/ui/proxy.json`。
3. **启动时注入**：开发走 `scripts/lib-driver.mjs`，打包走 `apps/shell/src/proxy-env.ts`；
   两边都会把配置翻译成宿主进程要用的 env：

   ```text
   HTTP_PROXY = http://127.0.0.1:7890
   http_proxy = http://127.0.0.1:7890
   HTTPS_PROXY / https_proxy = …
   NO_PROXY / no_proxy = localhost,127.0.0.1
   ```

   宿主启动后 `dsh-http-proxy` 就会装好全局 dispatcher。

### 两条路，任选

- **界面登记**（本节）：在本程序里填，落盘、可复查；
- **操作系统环境变量**：直接设 `HTTP_PROXY` 等，宿主的插件同样会读。
  两者同时存在时，**界面登记的值优先**（更具体）。

### 边界

- 只影响**宿主的出站 HTTP**；界面与宿主之间是本地回环通信，本来就直连
  （宿主内置回环豁免，不会出现代理把流量绕回自己）。
- 改完代理要**重启宿主**才生效——代理是在进程启动时解析并安装的。
- 代理不解决 TLS 证书问题（自签证书需要额外的信任配置，不在范围内）。

## 3. 验证

- `npm run verify:ui-extensions`：7 项——面板、插槽、LLM 服务、自定义皮肤、代理写入、
  代理→env 翻译、provider 进模型目录，全过。
- `npm run test:ui-plugin`：代理校验（只认 http(s)）、代理读写、自定义皮肤读取。
- `npm run test:shell`：壳侧代理 env 映射。
- `npm run test:panels`：主题三态循环（暗 → 亮 → 跟随系统）。
