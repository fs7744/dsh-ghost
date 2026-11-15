/** 验证脚本共用的启停与登录（薄封装，避免每个脚本重复实现）。 */
export { boot, stop, WORKSPACE } from '../spikes/p05-transport/lib/harness-client.mjs'
export { login, createTransport } from '../packages/harness-port/src/index.ts'
