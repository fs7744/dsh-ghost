/**
 * C11-03：压缩策略配置。
 *
 * 裁剪阈值、触发阈值、保留策略、`/compact` 焦点参数的**配置模型 + 校验 + 序列化**。
 * 配置以 `{ compaction: {...} }` 的形态写进 settings（与 `<root>/settings.json` 一致）。
 * 全部纯函数：校验不过就明确拒绝，绝不静默塞一个非法值进去。
 */
/** 默认配置：一个能直接用的、保守的取值。 */
export const DEFAULT_COMPACTION = {
    pruneThresholdBytes: 8_192,
    headKeepRatio: 0.2,
    tailKeepRatio: 0.3,
    triggerRatio: 0.75,
    keepPolicy: 'balanced',
    keepRecentImages: 2,
};
const KEEP_POLICIES = ['recent', 'summary', 'balanced'];
/** 校验一份（可能不完整的）配置；缺失字段不报错，由 normalize 补默认值。 */
export function validateCompaction(input) {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        return { ok: false, errors: ['配置必须是对象'] };
    }
    const config = input;
    const errors = [];
    const checkNumber = (key, min, max, integer) => {
        const value = config[key];
        if (value === undefined)
            return;
        const valid = typeof value === 'number'
            && Number.isFinite(value)
            && value >= min
            && value <= max
            && (!integer || Number.isInteger(value));
        if (!valid)
            errors.push(`${key} 必须是 ${min}~${max}${integer ? ' 的整数' : ''}`);
    };
    checkNumber('pruneThresholdBytes', 1, 1_000_000_000, true);
    checkNumber('headKeepRatio', 0, 1, false);
    checkNumber('tailKeepRatio', 0, 1, false);
    checkNumber('triggerRatio', 0, 1, false);
    checkNumber('keepRecentImages', 0, 100, true);
    if (config.keepPolicy !== undefined && !KEEP_POLICIES.includes(config.keepPolicy)) {
        errors.push(`keepPolicy 必须是 ${KEEP_POLICIES.join('/')}`);
    }
    if (config.compactFocus !== undefined
        && (typeof config.compactFocus !== 'string' || config.compactFocus.length > 120)) {
        errors.push('compactFocus 必须是长度不超过 120 的字符串');
    }
    const head = typeof config.headKeepRatio === 'number' ? config.headKeepRatio : DEFAULT_COMPACTION.headKeepRatio;
    const tail = typeof config.tailKeepRatio === 'number' ? config.tailKeepRatio : DEFAULT_COMPACTION.tailKeepRatio;
    if (head + tail > 1)
        errors.push('headKeepRatio + tailKeepRatio 之和不能超过 1');
    return { ok: errors.length === 0, errors };
}
function pickNumber(value, fallback) {
    return typeof value === 'number' ? value : fallback;
}
/** 合并默认值并校验；非法值直接抛错（纯函数）。 */
export function normalizeCompaction(input) {
    const verdict = validateCompaction(input);
    if (!verdict.ok)
        throw new Error(`压缩配置非法：${verdict.errors.join('；')}`);
    const config = (typeof input === 'object' && input !== null ? input : {});
    const policy = KEEP_POLICIES.includes(config.keepPolicy)
        ? config.keepPolicy
        : DEFAULT_COMPACTION.keepPolicy;
    return {
        pruneThresholdBytes: pickNumber(config.pruneThresholdBytes, DEFAULT_COMPACTION.pruneThresholdBytes),
        headKeepRatio: pickNumber(config.headKeepRatio, DEFAULT_COMPACTION.headKeepRatio),
        tailKeepRatio: pickNumber(config.tailKeepRatio, DEFAULT_COMPACTION.tailKeepRatio),
        triggerRatio: pickNumber(config.triggerRatio, DEFAULT_COMPACTION.triggerRatio),
        keepPolicy: policy,
        keepRecentImages: pickNumber(config.keepRecentImages, DEFAULT_COMPACTION.keepRecentImages),
        ...(typeof config.compactFocus === 'string' ? { compactFocus: config.compactFocus } : {}),
    };
}
/** 序列化成 settings 对象（可再 JSON.stringify 落盘）。 */
export function serializeCompaction(config) {
    return { compaction: { ...config } };
}
/** 序列化成可直接写 settings.json 的文本。 */
export function toSettingsJson(config) {
    return `${JSON.stringify(serializeCompaction(config), null, 2)}\n`;
}
/** 从 settings 对象里读回配置（缺失即默认，非法即抛错）。 */
export function deserializeCompaction(settings) {
    const raw = typeof settings === 'object' && settings !== null
        ? settings.compaction
        : undefined;
    return normalizeCompaction(raw ?? {});
}
/** 由配置生成 `/compact` 调用参数（纯函数）。 */
export function compactInvocation(config) {
    return {
        command: '/compact',
        ...(config.compactFocus === undefined ? {} : { focus: config.compactFocus }),
    };
}
