/**
 * model-manager 的核心类型与可注入存储（C3-01/02/03/05）。
 *
 * 纯逻辑：零网络、零 DOM、零文件系统。所有配置读写都走调用方注入的
 * CatalogStore，缺省是内存实现；界面与验收脚本各自注入自己的 store。
 * 凭据只允许 env 引用名（apiKeyEnv），绝不接受明文 key。
 */
export const PROVIDER_APIS = ['openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-ai'];
export const EMPTY_STATE = Object.freeze({ providers: [], bindings: [] });
/** 默认内存实现：不落盘、不碰文件系统，测试与无后端 UI 直接用。 */
export function createMemoryStore(initial = EMPTY_STATE) {
    let state = initial;
    return {
        read: () => state,
        write: next => { state = next; },
    };
}
const isPositiveInt = (value) => typeof value === 'number' && Number.isInteger(value) && value > 0;
/** 能力标注校验；返回错误列表，空数组即合法。参数用 unknown 以容纳运行时脏数据。 */
export function validateCapabilities(caps) {
    if (caps === null || typeof caps !== 'object')
        return ['能力标注必须是对象'];
    const value = caps;
    const errors = [];
    if (!isPositiveInt(value.contextWindow))
        errors.push('contextWindow 必须是正整数');
    if (!isPositiveInt(value.maxTokens))
        errors.push('maxTokens 必须是正整数');
    if (isPositiveInt(value.maxTokens) && isPositiveInt(value.contextWindow) && value.maxTokens > value.contextWindow) {
        errors.push('maxTokens 不能大于 contextWindow');
    }
    if (!Array.isArray(value.reasoningEfforts))
        errors.push('reasoningEfforts 必须是数组');
    else if (value.reasoningEfforts.some(item => typeof item !== 'string' || item === ''))
        errors.push('reasoningEfforts 每项须为非空字符串');
    return errors;
}
