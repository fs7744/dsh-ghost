/**
 * 凭据引用校验（C2-03）：拒绝明文 key，只允许 env 引用名。
 *
 * 明文永不落 settings、永不进配置文件。这里只认一个环境变量名（如 WB_KEY），
 * 由宿主在启动时从进程环境读取，配置里只留引用名。
 */
/** 合法 env 引用名：大写字母开头，其余大写字母 / 数字 / 下划线。 */
export const ENV_REF_NAME = /^[A-Z][A-Z0-9_]{1,63}$/;
// 常见密钥前缀。注意这些是正则字面量而非示例密钥字符串，不会触发密钥扫描。
const KEY_PREFIXES = [
    /^sk-[A-Za-z0-9_-]{12,}$/,
    /^wbk_[A-Za-z0-9]{12,}$/,
    /^gh[pousr]_[A-Za-z0-9]{12,}$/,
    /^AKIA[0-9A-Z]{12,}$/,
    /^-----BEGIN/,
    /^Bearer\s+\S+/,
];
/** 是否看起来像一把明文密钥（而不是 env 名）。 */
export function looksLikePlaintextKey(value) {
    if (typeof value !== 'string' || value === '')
        return false;
    if (KEY_PREFIXES.some(pattern => pattern.test(value)))
        return true;
    // 长且混杂大小写 / 数字的裸串也按明文处理；env 名不会长成这样。
    if (value.length >= 32 && /[a-z]/.test(value) && /[0-9]/.test(value))
        return true;
    return false;
}
/** 校验一个凭据引用值；只允许 env 引用名，明文一律拒绝。 */
export function validateCredentialRef(value) {
    if (typeof value !== 'string' || value === '')
        return { ok: false, reason: '凭据引用不能为空' };
    if (looksLikePlaintextKey(value))
        return { ok: false, reason: '疑似明文密钥，只允许 env 引用名（如 WB_KEY）' };
    if (!ENV_REF_NAME.test(value))
        return { ok: false, reason: '必须是大写字母/数字/下划线组成的 env 引用名' };
    return { ok: true, reason: 'ok' };
}
/** 从一份配置对象里挑出所有疑似明文密钥的字段名，供批量自检。 */
export function findPlaintextCredentials(config) {
    const bad = [];
    for (const [key, value] of Object.entries(config)) {
        if (typeof value === 'string' && looksLikePlaintextKey(value))
            bad.push(key);
    }
    return bad;
}
