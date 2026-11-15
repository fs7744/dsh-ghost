/**
 * B2 宿主装配层（公共部分）。
 *
 * 定位：这是「装配层」，不是第二个引擎宿主。
 *   - 唯一 new Engine 的是 packages/orchestrator-plugin（ghost-orchestrator），
 *     它负责票持久化、ghost_ticket 工具、自动执行器、Outbox 与 ghostTickets/* / ghostSources/* Remote；
 *   - dsh-superagent 不 new Engine，接收 orchestrator-plugin 常驻的 Engine / Repositories 实例（可注入），
 *     把 B3 的 19 个工具、B4 的 7 个视图、B5 的触发源接成一份完整清单，并暴露 ghostViews/* / ghostTools/* Remote。
 *
 * 零 harness 依赖：HostContext 是鸭子类型接口，apply/install 只调用它的方法；
 * 真实 cordis 适配由宿主侧（harness-port）完成，这里不 import 任何 @deepseek-ai/* 包。
 */
import { TOOL_DESCRIPTORS, TOOL_NAMES, invokeTool, SettingsStore, StaticViewReader, } from '../../tools/index.js';
import { VIEW_BUILDERS, VIEW_NAMES, renderViewText } from '../views/index.js';
/** B2-01 声明的 11 个逻辑服务依赖；真实 ctx 键名映射由 harness-port 收口。 */
export const INJECT_SERVICES = [
    'tools', 'sessions', 'agents', 'typert', 'remotes', 'settings',
    'logger', 'events', 'storage', 'permissions', 'config',
];
/**
 * C2-01：管理面全部走 Typert Remote，不存在自建 /orchestrator HTTP 路由。
 * 前四组是已有插件暴露的 Remote，后两组是本装配层新增的视图 / 工具清单端点。
 */
export const MANAGEMENT_REMOTES = [
    'ghostTickets/list', 'ghostTickets/get', 'ghostTickets/accept',
    'ghostSources/list', 'ghostSources/ingest',
    'ghostMemory/list', 'ghostMemory/read', 'ghostMemory/write', 'ghostMemory/remove', 'ghostMemory/status', 'ghostMemory/toggle',
    'ghostEvolution/list', 'ghostEvolution/propose', 'ghostEvolution/measure',
    'ghostViews/list', 'ghostViews/read',
    'ghostTools/list',
];
/** 与 orchestrator-plugin 的分工说明（写进清单与文档，避免两侧各挂一个 Engine）。 */
export const DIVISION_NOTE = [
    'Engine 常驻归 ghost-orchestrator（orchestrator-plugin）：票持久化、ghost_ticket 工具、自动执行器、Outbox、ghostTickets/* 与 ghostSources/* Remote。',
    'dsh-superagent 是装配层：不 new Engine，注入同一份 Engine / Repositories，把 19 个会话工具、7 个面板视图、ghostViews/* 与 ghostTools/* Remote 接成完整清单。',
    'github-watch / feishu-watch 只产出声明式 SourceSpec，经 ghostSources/ingest 归一化，不碰 Engine；飞书默认关闭。',
].join(' ');
/** 把 7 个视图渲成人话文本，绑成 orchestrator_read 用的 ViewReader。 */
export function buildViewReader(repo, extra = {}) {
    const texts = {};
    for (const name of VIEW_NAMES)
        texts[name] = renderViewText(VIEW_BUILDERS[name](repo, extra));
    return new StaticViewReader(texts);
}
/** 纯函数：产出装配清单，不碰宿主、不需要真实 Engine。 */
export function createAssembly(config = {}) {
    return {
        plugin: 'dsh-superagent',
        inject: [...INJECT_SERVICES],
        tools: [...TOOL_NAMES],
        views: [...VIEW_NAMES],
        remotes: [...MANAGEMENT_REMOTES],
        sources: (config.sources ?? []).map(spec => spec.id),
        division: DIVISION_NOTE,
    };
}
/** 由可注入依赖构造工具上下文；配置仓缺省用纯内存实现。 */
export function createToolContext(deps, extra = {}) {
    return {
        repo: deps.repo,
        engine: deps.engine,
        config: deps.config ?? new SettingsStore(),
        views: buildViewReader(deps.repo, extra),
    };
}
/**
 * 真正装配：注册 19 个工具、2 个新增 Remote、以及启用的触发源 spec。
 * 注意这里只是把工具描述符转成宿主工具的注册动作，绝不改 contracts.ts、绝不 new Engine。
 */
export function install(ctx, deps, config = {}) {
    const manifest = createAssembly(config);
    const toolCtx = createToolContext(deps, config.extra);
    for (const descriptor of TOOL_DESCRIPTORS) {
        ctx.registerTool({
            name: descriptor.name,
            description: descriptor.description,
            parameters: descriptor.parameters,
            execute: args => invokeTool(descriptor.name, args, toolCtx),
        });
    }
    ctx.registerRemote('ghostViews', { namespace: 'ghostViews', methods: ['list', 'read'] });
    ctx.registerRemote('ghostTools', { namespace: 'ghostTools', methods: ['list'] });
    const sources = config.sources ?? deps.sources ?? [];
    for (const spec of sources) {
        const enabled = config.enabledSources?.[spec.id] ?? true;
        if (enabled && ctx.registerSource !== undefined)
            ctx.registerSource(spec);
    }
    ctx.logger?.info('dsh-superagent: %d 工具 / %d 视图 / %d Remote 已装配；Engine 由 orchestrator-plugin 常驻', manifest.tools.length, manifest.views.length, manifest.remotes.length);
    return manifest;
}
