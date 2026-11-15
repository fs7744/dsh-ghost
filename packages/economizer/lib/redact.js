/**
 * 凭据脱敏（写盘前拦、显示前洗）。
 *
 * 放在纯逻辑包里：编排插件（Node）与桌面端（浏览器）都要用，不能有 node 依赖。
 *
 * 放在纯逻辑包里：编排插件（Node）与桌面端（浏览器）都要用，不能有 node 依赖。
 *
 * 两条规则：
 *  1. **配置里不存明文密钥**：`token` / `secret` / `apiKey` 这类键只能指向环境变量
 *     （我们约定 `tokenEnv: 'GITHUB_TOKEN'`），明文值一律拒写——否则它会同时出现在
 *     磁盘、视图文本和模型上下文里。
 *  2. **显示前一律洗**：视图、审批卡、诊断文本在进模型上下文前过一遍，
 *     敏感值替换成 `***`；这同时省 token（长密钥没必要进上下文）。
 */
/** 敏感键名（大小写不敏感）。 */
const SECRET_KEY = /(token|secret|password|passwd|api[-_]?key|credential|private[-_]?key|access[-_]?key|refresh[-_]?key)/i;
/** 指向环境变量的键（`*Env` / `env:` 前缀）不算明文。 */
export function isEnvRefKey(key) {
    return /env$/i.test(key) || /^env:/i.test(key);
}
/** 这个键名是否敏感。 */
export function isSecretKey(key) {
    return SECRET_KEY.test(key);
}
/**
 * 在配置对象里找第一处「明文密钥」：敏感键 + 非空字符串值 + 不是环境变量引用。
 * @returns 形如 `accounts.github.token` 的路径；没有则 undefined
 */
export function findPlainSecret(value, path = '') {
    if (Array.isArray(value)) {
        for (const [index, item] of value.entries()) {
            const found = findPlainSecret(item, path === '' ? `[${index}]` : `${path}[${index}]`);
            if (found !== undefined)
                return found;
        }
        return undefined;
    }
    if (typeof value !== 'object' || value === null)
        return undefined;
    for (const [key, item] of Object.entries(value)) {
        const here = path === '' ? key : `${path}.${key}`;
        if (isSecretKey(key) && !isEnvRefKey(key) && typeof item === 'string' && item.trim() !== '') {
            return here;
        }
        const found = findPlainSecret(item, here);
        if (found !== undefined)
            return found;
    }
    return undefined;
}
/**
 * 洗文本里的敏感赋值：`token=xxx` / `"secret": "xxx"` → `token=***`。
 */
export function redactText(text) {
    // 键可以带引号（JSON 里是 "apiKey": "..."），值也可以带引号；两种都要能盖住。
    const pattern = /(["']?)((?:[A-Za-z_][\w.-]*)?(?:token|secret|password|passwd|api[_-]?key|credential|private[_-]?key|access[_-]?key|refresh[_-]?key)[A-Za-z_]*)\1(\s*[:=]\s*)("?)([^\s"',}]+)\4/gi;
    return text.replace(pattern, (_match, keyQuote, key, sep, valueQuote) => `${keyQuote}${key}${keyQuote}${sep}${valueQuote}***${valueQuote}`);
}
/**
 * 脱敏后的预览：敏感键显示 `***`，其余照旧但截断。
 */
export function redactPreview(value, limit = 80) {
    const text = typeof value === 'string' ? value : String(JSON.stringify(value) ?? '');
    return redactText(text).slice(0, limit);
}
