/**
 * 记忆：四层里由我们实现的两层（项目 L2 / 用户 L3）+ 写入闸门。
 *
 * 不变量：一切皆文件、常驻有硬预算、覆盖前留 `.bak`、写入原子。
 * 会话层（L1）与团队层（L4）分别由 harness 与 git 负责，不在这里重造。
 */
export { MemoryStore, isValidEntryName } from './store.ts'
export type { EntryMeta, MemoryMode, MemoryStoreOptions, WriteOutcome } from './store.ts'
export { candidates, gate } from './gate.ts'
export type { GateResult, MemoryWrite } from './gate.ts'
export { memoryTools } from './tools.ts'
export type { JsonSchema, ToolDescriptor } from './tools.ts'
