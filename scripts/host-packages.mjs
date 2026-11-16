/**
 * 宿主要加载的 workspace 包（单一真相源）。
 *
 * 两处用它，口径必须一致：
 * - `scripts/prepare-runtime.mjs` / `scripts/sync-host-plugins.mjs`：把这些包的编译
 *   产物复制进运行时与 profile 的 node_modules，打包后的壳才能按包名解析到它们；
 * - `scripts/lib-driver.mjs`：开发态把它们同步进 profile 的 node_modules。
 *
 * 列表是「宿主插件依赖闭包」：插件之间的运行时 import 也算依赖
 * （例如 ui-plugin 运行时要 @dsh-ghost/model-manager），漏一个宿主就会报
 * `Cannot find package '@dsh-ghost/xxx'`。
 *
 * 只同步 `package.json` + `lib` + `src` + `examples`：
 * 宿主按包名 require 入口（lib），src/examples 让插件内的相对引用仍能工作。
 */
export const HOST_PACKAGES = [
  'orchestrator-plugin',
  'memory-plugin',
  'memory',
  'economizer',
  'ui-plugin',
  'ui-extensions',
  'automation-plugin',
  'automation',
  'peer-agent-plugin',
  'peer-agent',
  'superagent',
  'sink-github',
  'source-github',
  'source-hub',
  'playbook',
  'playbook-runtime',
  'evolution',
  // 下面三个是被上面那些包在运行时 import 的，漏了会直接加载失败。
  'model-manager',
  'model-adapter-kit',
  'git-view',
  'harness-port',
]
