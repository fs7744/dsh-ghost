/** 传给 runner 的一次执行：命令与参数分离，杜绝 shell 拼接。 */
export interface RunnerCommand {
    /** 可执行名，如 `node`；不含空格与 shell 元字符。 */
    command: string;
    /** 参数数组（脚本路径 + 脚本参数）。 */
    args: string[];
    cwd: string;
    timeoutMs: number;
    signal?: AbortSignal;
}
/** runner 的原始返回。 */
export interface RunnerResult {
    stdout: string;
    stderr: string;
    exitCode: number;
    timedOut: boolean;
}
/** 可注入 runner：默认实现是 nodeRunner。 */
export type Runner = (command: RunnerCommand) => Promise<RunnerResult>;
/** 一次脚本执行请求。 */
export interface RunRequest {
    /** 包内相对路径，如 `scripts/verify.mjs`。 */
    script: string;
    args?: string[];
    /** 工作目录，缺省取 packageRoot。 */
    cwd?: string;
    /** 本次超时（毫秒），缺省取 defaultTimeoutMs。 */
    timeoutMs?: number;
    /** 幂等键：相同键 + 相同请求只真正执行一次。 */
    idempotencyKey?: string;
}
/** 运行时配置。 */
export interface RuntimeOptions {
    /** 脚本根目录：所有路径必须落在它里面。 */
    packageRoot: string;
    allowedCommands?: string[];
    allowedExtensions?: string[];
    defaultTimeoutMs?: number;
    maxConcurrency?: number;
    maxOutputBytes?: number;
    /** 可注入；缺省跑 node 脚本。 */
    runner?: Runner;
    now?: () => number;
}
/** 归一化后的执行结果（也是 `{ok,code,fix,hint}` 协议）。 */
export interface RunOutcome {
    ok: boolean;
    code: string;
    fix?: string;
    hint?: string;
    /** 截断后的 stdout（模型只看这个）。 */
    output?: string;
    durationMs: number;
    /** 是否命中幂等缓存（没有真正再跑一次）。 */
    idempotentHit: boolean;
    timedOut: boolean;
}
/** 带并发/幂等状态的一次性运行时。 */
export interface Runtime {
    run(request: RunRequest): Promise<RunOutcome>;
}
/**
 * 默认 runner：只跑 `node <包内脚本> [参数...]`，用 execFile 且参数分开传。
 * 不启用 shell；abort 信号或超时会杀掉子进程。
 */
export declare const nodeRunner: Runner;
/**
 * 构造一个带并发/幂等状态的运行时。
 * @param options - 包根、白名单、上限、可注入 runner
 */
export declare function createRuntime(options: RuntimeOptions): Runtime;
/** 便捷封装：单次执行（并发/幂等状态只在这一次调用内有效）。 */
export declare function runScript(request: RunRequest, options: RuntimeOptions): Promise<RunOutcome>;
