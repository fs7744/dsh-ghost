/**
 * B7-04 小时级看护：定时体检，挂了自动拉起，连续失败按指数退避。
 *
 * 核心是纯状态机（watchdogTick / nextBackoffMs），可注入 check / restart / sleep / log；
 * runWatchdog 用可注入的 sleep 驱动若干轮，便于测试退避序列与失败上限。
 */
/** 默认体检间隔：1 小时（毫秒）。 */
export declare const DEFAULT_WATCHDOG_INTERVAL_MS = 3600000;
export interface WatchdogOptions {
    /** 体检间隔，默认 DEFAULT_WATCHDOG_INTERVAL_MS。 */
    intervalMs?: number;
    /** 退避基数，默认 1000ms。 */
    backoffBaseMs?: number;
    /** 退避上限，默认 60000ms。 */
    backoffMaxMs?: number;
    /** 连续失败达到这个数就停止自动拉起并告警，默认 5。 */
    maxFailures?: number;
    /** 最多体检轮数；默认 24（一天）。真实守护用 setInterval 驱动 watchdogTick。 */
    maxTicks?: number;
}
export interface WatchdogState {
    failures: number;
    backoffMs: number;
    restarts: number;
}
export interface WatchdogDeps {
    /** 体检：true 表示服务健康。 */
    check(): boolean;
    /** 拉起服务。 */
    restart(): void;
    /** 等待（可注入；测试里用同步 noop）。 */
    sleep(ms: number): void;
    log(message: string): void;
}
export interface WatchdogTick {
    tick: number;
    healthy: boolean;
    restarted: boolean;
    backoffMs: number;
    failures: number;
}
/** 初始状态。 */
export declare function initialWatchdogState(): WatchdogState;
/** 第 failures 次连续失败后的退避时长：base * 2^(failures-1)，封顶 backoffMax。 */
export declare function nextBackoffMs(failures: number, options?: WatchdogOptions): number;
/** 一次体检后的状态转移；不修改传入的 state。 */
export declare function watchdogTick(state: WatchdogState, healthy: boolean, options?: WatchdogOptions): {
    state: WatchdogState;
    restarted: boolean;
    reason: string;
};
/** 跑若干轮体检，返回每轮的退避与拉起情况；用于自检 CLI 与测试。 */
export declare function runWatchdog(deps: WatchdogDeps, options?: WatchdogOptions): WatchdogTick[];
/**
 * 真实守护：按 intervalMs（默认 1 小时）定时体检，挂了自动拉起，退避状态由 watchdogTick 维护。
 * 返回清理函数；测试与自检 CLI 用有限轮的 runWatchdog，不启动这个常驻定时器。
 */
export declare function startWatchdog(deps: {
    check(): boolean;
    restart(): void;
    log(message: string): void;
}, options?: WatchdogOptions): () => void;
