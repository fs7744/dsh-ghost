/**
 * ghost-memory：把记忆工具挂进 harness 的宿主插件。
 *
 * 这是本仓库第一个**宿主插件**，也是 `harness-port` 之外唯一允许 import `@deepseek-ai/*` 的地方
 * （宿主侧与客户端侧分开：客户端走 Remote，宿主侧只能直接调 ctx）。
 *
 * 注册的是**全局工具**（所有 agent 可见）；如果以后要做"按 agent 隔离的记忆"，
 * 改为在 agent 作用域上注册即可，工具定义本身不用动。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryStore, memoryTools } from '@dsh-ghost/memory';
/** 插件名，cordis 用它做去重与诊断。 */
export const name = 'ghost-memory';
/** 依赖的工具注册表。 */
export const inject = ['tools'];
const OUTPUT_SCHEMA = {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
    additionalProperties: false,
};
/**
 * 挂载插件。
 * @param ctx - cordis 上下文（必须已注入 `tools`）
 * @param config - 记忆根目录与形态
 */
export function apply(ctx, config) {
    const store = new MemoryStore({
        root: config.root,
        mode: config.mode ?? 'indexed',
        ...(config.maxResidentBytes === undefined ? {} : { maxResidentBytes: config.maxResidentBytes }),
    });
    for (const tool of memoryTools(store)) {
        ctx.effect(() => ctx.tools.register({
            name: tool.name,
            description: tool.description,
            // 我们的描述符用极简 JSON Schema；harness 的类型更宽，这里断言即可。
            parameters: tool.parameters,
            output: {
                schema: OUTPUT_SCHEMA,
                render: (_args, value) => [{ type: 'text', text: value.text }],
            },
            async execute(args) {
                return { text: await tool.execute((args ?? {})) };
            },
        }), `ghost-memory: ${tool.name}`);
    }
    // 自检文件：让"插件真的活着"可被外部观测（日志级别不可靠，文件不会骗人）。
    // 同时它是排障入口：谁在什么时候、以什么配置加载了哪些工具。
    try {
        mkdirSync(config.root, { recursive: true });
        writeFileSync(join(config.root, 'plugin-state.json'), JSON.stringify({
            plugin: name,
            tools: memoryTools(store).map(tool => tool.name),
            mode: config.mode ?? 'indexed',
            at: new Date().toISOString(),
            pid: process.pid,
        }, null, 2));
    }
    catch {
        // 自检文件写不了不该影响插件本身
    }
}
