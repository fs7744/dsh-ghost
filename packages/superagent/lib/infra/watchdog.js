/**
 * B7-04 小时级看护：定时体检，挂了自动拉起，连续失败按指数退避。
 *
 * 核心是纯状态机（watchdogTick / nextBackoffMs），可注入 check / restart / sleep / log；
 * runWatchdog 用可注入的 sleep 驱动若干轮，便于测试退避序列与失败上限。
 */
/** 默认体检间隔：1 小时（毫秒）。 */
export const DEFAULT_WATCHDOG_INTERVAL_MS = 3_600_000;
/** 初始状态。 */
export function initialWatchdogState() {
    return { failures: 0, backoffMs: 0, restarts: 0 };
}
/** 第 failures 次连续失败后的退避时长：base * 2^(failures-1)，封顶 backoffMax。 */
export function nextBackoffMs(failures, options = {}) {
    const base = options.backoffBaseMs ?? 1000;
    const cap = options.backoffMaxMs ?? 60_000;
    return Math.min(base * 2 ** Math.max(0, failures - 1), cap);
}
/** 一次体检后的状态转移；不修改传入的 state。 */
export function watchdogTick(state, healthy, options = {}) {
    const maxFailures = options.maxFailures ?? 5;
    if (healthy) {
        return {
            state: { failures: 0, backoffMs: 0, restarts: state.restarts },
            restarted: false,
            reason: '体检健康，连续失败计数与退避已重置',
        };
    }
    const failures = state.failures + 1;
    const restarted = failures <= maxFailures;
    const backoffMs = restarted ? nextBackoffMs(failures, options) : 0;
    return {
        state: {
            failures,
            backoffMs,
            restarts: state.restarts + (restarted ? 1 : 0),
        },
        restarted,
        reason: restarted
            ? `体检失败：第 ${failures} 次自动拉起，退避 ${backoffMs}ms`
            : `连续失败 ${failures} 次已达上限 ${maxFailures}，停止自动拉起并告警`,
    };
}
/** 跑若干轮体检，返回每轮的退避与拉起情况；用于自检 CLI 与测试。 */
export function runWatchdog(deps, options = {}) {
    const intervalMs = options.intervalMs ?? DEFAULT_WATCHDOG_INTERVAL_MS;
    const maxTicks = options.maxTicks ?? 24;
    const maxFailures = options.maxFailures ?? 5;
    const ticks = [];
    let state = initialWatchdogState();
    for (let index = 1; index <= maxTicks; index++) {
        deps.sleep(intervalMs);
        const healthy = deps.check();
        const result = watchdogTick(state, healthy, options);
        state = result.state;
        if (result.restarted)
            deps.restart();
        deps.log(`[看护 ${index}] ${result.reason}`);
        ticks.push({
            tick: index, healthy, restarted: result.restarted,
            backoffMs: result.state.backoffMs, failures: result.state.failures,
        });
        if (result.state.backoffMs > 0)
            deps.sleep(result.state.backoffMs);
        if (result.state.failures > maxFailures)
            break;
    }
    return ticks;
}
/**
 * 真实守护：按 intervalMs（默认 1 小时）定时体检，挂了自动拉起，退避状态由 watchdogTick 维护。
 * 返回清理函数；测试与自检 CLI 用有限轮的 runWatchdog，不启动这个常驻定时器。
 */
export function startWatchdog(deps, options = {}) {
    const intervalMs = options.intervalMs ?? DEFAULT_WATCHDOG_INTERVAL_MS;
    let state = initialWatchdogState();
    const timer = setInterval(() => {
        const healthy = deps.check();
        const result = watchdogTick(state, healthy, options);
        state = result.state;
        if (result.restarted)
            deps.restart();
        deps.log(`[小时级看护] ${result.reason}`);
    }, intervalMs);
    return () => clearInterval(timer);
}
