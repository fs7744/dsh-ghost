/** 把各种形状的探测结果归一化成统一结构；易变字段一律丢弃。 */
export function normalizeProbeResult(raw) {
    if (raw === true)
        return { ok: true };
    if (raw === false || raw === null || raw === undefined)
        return { ok: false, error: '无响应' };
    if (typeof raw === 'string')
        return { ok: false, error: raw.slice(0, 120) };
    if (raw instanceof Error)
        return { ok: false, error: raw.message.slice(0, 120) };
    if (typeof raw !== 'object')
        return { ok: false, error: '未知结果形状' };
    const value = raw;
    const status = typeof value.status === 'number' ? value.status : undefined;
    const models = Array.isArray(value.models)
        ? value.models.filter((item) => typeof item === 'string')
        : undefined;
    let ok = false;
    if (typeof value.ok === 'boolean')
        ok = value.ok;
    else if (typeof value.success === 'boolean')
        ok = value.success;
    else if (status !== undefined)
        ok = status >= 200 && status < 300;
    const error = typeof value.error === 'string' ? value.error.slice(0, 120) : undefined;
    const outcome = { ok };
    if (status !== undefined)
        outcome.status = status;
    if (error !== undefined)
        outcome.error = error;
    if (models !== undefined)
        outcome.models = models;
    return outcome;
}
/** 归一化结果的可读标签（界面与 CLI 共用一份文案口径）。 */
export function describeProbe(outcome) {
    if (outcome.ok)
        return '连通' + (outcome.status === undefined ? '' : ` (HTTP ${outcome.status})`);
    return '不通' + (outcome.error === undefined ? '' : `: ${outcome.error}`);
}
/** 调一次可注入 probe，捕获异常并归一化；绝不把原始异常直接抛给界面。 */
export async function runConnectivityProbe(provider, probe) {
    let raw;
    try {
        raw = await probe(provider);
    }
    catch (error) {
        raw = error;
    }
    const outcome = normalizeProbeResult(raw);
    return { ...outcome, label: outcome.ok ? '连通' : '不通' };
}
