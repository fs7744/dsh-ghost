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
import type { SourceSpec } from '@dsh-ghost/source-hub';
import type { Engine, Repositories } from '../../core/index.ts';
import type { ConfigStore, JsonSchema, ToolArgs, ToolContext, ViewReader } from '../../tools/index.ts';
import type { ViewExtra } from '../views/index.ts';
/** 宿主日志（可选注入）。 */
export interface HostLogger {
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
}
/** 注册给模型的工具形状：描述符 + 一个人话执行入口。 */
export interface RegisteredTool {
    name: string;
    description: string;
    parameters: JsonSchema;
    execute(args: ToolArgs): string;
}
/** 一个 Typert Remote 服务声明（管理面全部走 Remote，不建自建 HTTP 路由）。 */
export interface RemoteService {
    namespace: string;
    methods: readonly string[];
}
/** 装配层需要的宿主能力；全部可注入，测试用假实现即可。 */
export interface HostContext {
    logger?: HostLogger;
    registerTool(tool: RegisteredTool): void;
    registerRemote(name: string, service: RemoteService): void;
    /** 长效副作用（看护 / 定时器），返回清理函数。 */
    effect?(setup: () => () => void, label: string): void;
    /** 把一个触发源 spec 交给 ghostSources 注册表；宿主不提供时只产出清单。 */
    registerSource?(spec: SourceSpec): void;
}
/** B2-01 声明的 11 个逻辑服务依赖；真实 ctx 键名映射由 harness-port 收口。 */
export declare const INJECT_SERVICES: readonly string[];
/**
 * C2-01：管理面全部走 Typert Remote，不存在自建 /orchestrator HTTP 路由。
 * 前四组是已有插件暴露的 Remote，后两组是本装配层新增的视图 / 工具清单端点。
 */
export declare const MANAGEMENT_REMOTES: readonly string[];
/** 与 orchestrator-plugin 的分工说明（写进清单与文档，避免两侧各挂一个 Engine）。 */
export declare const DIVISION_NOTE: string;
/** 一份装配清单：入口可解析、账本可核对的核心对象。 */
export interface AssemblyManifest {
    plugin: string;
    inject: readonly string[];
    tools: readonly string[];
    views: readonly string[];
    remotes: readonly string[];
    sources: readonly string[];
    division: string;
}
/** 触发源入口的装配结果。 */
export interface WatchAssembly {
    plugin: string;
    inject: readonly string[];
    spec: SourceSpec;
    enabled: boolean;
    remotes: readonly string[];
    division: string;
}
/** 可注入的领域依赖；engine 必须来自 orchestrator-plugin 的常驻实例。 */
export interface AssemblyDeps {
    repo: Repositories;
    engine: Engine;
    config?: ConfigStore;
    sources?: readonly SourceSpec[];
    now?: () => string;
}
/** 主入口配置。 */
export interface MainConfig {
    sources?: readonly SourceSpec[];
    enabledSources?: Record<string, boolean>;
    extra?: ViewExtra;
}
/** 把 7 个视图渲成人话文本，绑成 orchestrator_read 用的 ViewReader。 */
export declare function buildViewReader(repo: Repositories, extra?: ViewExtra): ViewReader;
/** 纯函数：产出装配清单，不碰宿主、不需要真实 Engine。 */
export declare function createAssembly(config?: MainConfig): AssemblyManifest;
/** 由可注入依赖构造工具上下文；配置仓缺省用纯内存实现。 */
export declare function createToolContext(deps: AssemblyDeps, extra?: ViewExtra): ToolContext;
/**
 * 真正装配：注册 19 个工具、2 个新增 Remote、以及启用的触发源 spec。
 * 注意这里只是把工具描述符转成宿主工具的注册动作，绝不改 contracts.ts、绝不 new Engine。
 */
export declare function install(ctx: HostContext, deps: AssemblyDeps, config?: MainConfig): AssemblyManifest;
