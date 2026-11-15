/**
 * B2 三个插件入口的聚合导出。
 *
 *  - B2-01 dsh-superagent：装配层（19 工具 / 7 视图 / Remote 清单）
 *  - B2-02 dsh-superagent/github-watch：GitHub 触发源
 *  - B2-03 dsh-superagent/feishu-watch：飞书触发源（默认关闭）
 */
export { name as mainName, inject as mainInject, apply as applyMain, createAssembly, } from './main.js';
export { name as githubWatchName, inject as githubWatchInject, apply as applyGithubWatch, createGithubWatchAssembly, } from './github-watch.js';
export { name as feishuWatchName, inject as feishuWatchInject, apply as applyFeishuWatch, createFeishuWatchAssembly, } from './feishu-watch.js';
export { INJECT_SERVICES, MANAGEMENT_REMOTES, DIVISION_NOTE, buildViewReader, createToolContext, install, } from './assembly.js';
