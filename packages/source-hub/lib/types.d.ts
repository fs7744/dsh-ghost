/**
 * 可插拔信息源的公共契约。
 *
 * 设计原则：来源只负责把「原始投递」归一化成 NormalizedEvent，
 * 不关心票、策略、会话怎么跑。新增一个来源 = 新增一个适配器或一段配置。
 */
/** 一次外部投递的原始材料。`rawBody` 必须是原始字节字符串（签名校验依赖它）。 */
export interface SourceRequest {
    headers: Record<string, string>;
    rawBody: string;
    body: unknown;
    /** 事件类型，一般由适配器从头里取。 */
    event?: string;
}
/** 来源的写回地址：票跑完后 Outbox 据此决定回复到哪。 */
export interface EventChannel {
    source: string;
    thread: string;
    address: Record<string, string>;
}
/** 归一化后的事件，形状与 orchestrator 的 AcceptInput 对齐。 */
export interface NormalizedEvent {
    source: string;
    threadId: string;
    text: string;
    human?: boolean;
    addressed?: boolean;
    url?: string;
    actor?: string;
    channel?: EventChannel;
}
/** 声明式映射：用户不写代码，只配字段模板。模板里可写 `{{a.b}}`、`{{headers.x-foo}}`、`{{event}}`。 */
export interface GenericMapping {
    /** 从哪个响应头取事件名；省略则用 request.event。 */
    eventHeader?: string;
    /** 只处理这些事件名；省略表示全收。 */
    events?: string[];
    /** 全部满足才产出事件。 */
    where?: Array<{
        path: string;
        equals?: string;
        exists?: boolean;
    }>;
    fields: {
        /** 来源名模板，默认用来源 id。 */
        source?: string;
        threadId: string;
        text: string;
        actor?: string;
        url?: string;
        /** 模板结果等于 "true" 时视为人写的。 */
        human?: string;
        /** 正文里含任一别名即算点名 agent。 */
        addressed?: {
            contains?: string[];
        };
        channel?: {
            source?: string;
            thread: string;
            address: Record<string, string>;
        };
    };
}
import type { ApiPullConfig } from './pull.ts';
/** 签名与鉴权：HMAC / 静态 token / 不校验，头名和前缀都可配。 */
export type SourceAuth = {
    type: 'hmac';
    header: string;
    secretEnv?: string;
    secret?: string;
    algorithm?: string;
    prefix?: string;
} | {
    type: 'token';
    header: string;
    valueEnv?: string;
    value?: string;
} | {
    type: 'none';
};
/** 一个来源的配置。github（内置）、generic（声明式）、api（拉取式）、custom（用户 mapper）。 */
export interface SourceSpec {
    id: string;
    kind: 'github' | 'generic' | 'api' | 'passthrough' | 'custom';
    description?: string;
    auth?: SourceAuth;
    /** 传给适配器的自由参数（botLogin、mentionAliases、mapper 自己的参数…）。 */
    options?: Record<string, unknown>;
    /** generic 专用。 */
    mapping?: GenericMapping;
    /** custom 专用：用户 .mjs 文件的绝对路径。 */
    mapper?: string;
    /** 拉取型配置：定时打这个接口（api 模式，或任何来源附带轮询）。 */
    pull?: ApiPullConfig;
}
/** 自定义 mapper 的输入。 */
export interface MapperInput {
    headers: Record<string, string>;
    rawBody: string;
    body: unknown;
    event?: string;
    options: Record<string, unknown>;
}
/** 自定义 mapper 的契约：默认导出一个函数，返回 0~n 条归一化事件。 */
export type MapperFunction = (input: MapperInput) => NormalizedEvent[] | Promise<NormalizedEvent[]>;
/** 适配器运行期能用的宿主能力。 */
export interface AdapterContext {
    importMapper(path: string): Promise<MapperFunction>;
}
/** 把一次原始投递变成 0~n 条归一化事件。 */
export interface SourceAdapter {
    id: string;
    description: string;
    normalize(request: SourceRequest, spec: SourceSpec, context: AdapterContext): NormalizedEvent[] | Promise<NormalizedEvent[]>;
}
/** 校验结果。 */
export type VerifyResult = {
    ok: true;
} | {
    ok: false;
    reason: string;
};
/** 归一化结果（签名失败时 events 为空并给出 reason）。 */
export interface NormalizeResult {
    ok: boolean;
    reason?: string;
    events: NormalizedEvent[];
}
/** 对外可见的来源摘要（不含密钥）。 */
export interface SourceSummary {
    id: string;
    kind: SourceSpec['kind'];
    description: string;
    auth: string;
}
