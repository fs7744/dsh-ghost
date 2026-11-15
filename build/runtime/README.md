# runtime 占位说明

electron-builder 的 `extraResources` 会把本目录复制到安装包的 `resources/runtime/`。
桌面壳按这个布局找宿主入口：

```
resources/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js
```

## 为什么放在 asar 外

`bin.js` 要按包名解析 `@deepseek-ai/*` 依赖，其中 `node-pty` / `koffi` / `node:sqlite`
是原生模块；asar 内的相对路径解析不了它们。所以运行时必须是真实目录。

## 怎么生成

```sh
node scripts/prepare-runtime.mjs          # 默认 dry-run：只检查来源与体积
node scripts/prepare-runtime.mjs --apply  # 真复制（1.3GB 量级，不进 git）
```

来源由 `DSH_DSH_MODULES` 决定（缺省 `spikes/p05-transport/node_modules`）。
开发态不复制也能跑：`apps/shell` 会直接指向该目录。

## 仍是外部依赖

- 运行时是**本机 npm 安装**，不是针对 Electron ABI 重新构建的产物。
  发版前必须按 PLAN §8.5 实测 `node-pty` / `koffi` / `node:sqlite` 在 Electron
  内置 Node 下可用，否则先走 sidecar Node 方案。
- 正式发版应改成 `npm ci --omit=dev` 的裁剪产物，而不是整份复制。
- 本目录只有说明文件，不应提交任何 `node_modules`。
