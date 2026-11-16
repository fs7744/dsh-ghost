export const DEFAULT_DISCOVERED_CONTEXT = 128_000;
export const DEFAULT_DISCOVERED_MAX_TOKENS = 8_192;
/**
 * 各协议的模型列表端点。baseURL 已经是带版本前缀的表单值时不去重加。
 * - OpenAI Chat Completions / Responses: GET {base}/models
 * - Anthropic Messages:                 GET {base}/v1/models?limit=100
 * - Google Generative AI (Gemini):      GET {base}/v1beta/models?pageSize=100
 */
export function discoveryUrl(baseURL, api) {
    const base = baseURL.replace(/\/+$/, '');
    if (api === 'anthropic-messages') {
        return `${base.endsWith('/v1') ? base : `${base}/v1`}/models?limit=100`;
    }
    if (api === 'google-generative-ai') {
        return `${base.endsWith('/v1beta') ? base : `${base}/v1beta`}/models?pageSize=100`;
    }
    return `${base}/models`;
}
/** 鉴权头：OpenAI 用 Bearer，Anthropic 用 x-api-key，Gemini 用 x-goog-api-key。 */
export function discoveryHeaders(api, key) {
    const headers = { accept: 'application/json' };
    if (key === undefined || key === '')
        return headers;
    if (api === 'anthropic-messages') {
        headers['x-api-key'] = key;
        headers['anthropic-version'] = '2023-06-01';
    }
    else if (api === 'google-generative-ai') {
        headers['x-goog-api-key'] = key;
    }
    else {
        headers.authorization = `Bearer ${key}`;
    }
    return headers;
}
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
/**
 * 把 /models 响应解析成统一列表；认识 3 种常见形状：
 * - OpenAI / Anthropic: { data: [{ id, name? }] }
 * - Gemini:             { models: [{ name: "models/xxx", displayName? }] }
 * - 裸数组:             [{ id, name? }]
 * 无法识别的形状返回空数组，绝不猜、不抛。
 */
export function parseDiscoveredModels(api, raw) {
    let rows = [];
    if (Array.isArray(raw))
        rows = raw;
    else if (isRecord(raw)) {
        if (Array.isArray(raw['data']))
            rows = raw['data'];
        else if (Array.isArray(raw['models']))
            rows = raw['models'];
    }
    const result = [];
    const seen = new Set();
    for (const row of rows) {
        if (!isRecord(row))
            continue;
        const rawId = typeof row['id'] === 'string' ? row['id'] : (typeof row['name'] === 'string' ? row['name'] : '');
        const id = api === 'google-generative-ai' ? rawId.replace(/^models\//, '') : rawId;
        if (id === '' || seen.has(id))
            continue;
        seen.add(id);
        const display = typeof row['displayName'] === 'string' ? row['displayName']
            : typeof row['display_name'] === 'string' ? row['display_name']
                : typeof row['name'] === 'string' && row['name'] !== rawId ? row['name']
                    : id;
        result.push({
            id,
            name: display,
            capabilities: {
                contextWindow: DEFAULT_DISCOVERED_CONTEXT,
                maxTokens: DEFAULT_DISCOVERED_MAX_TOKENS,
                reasoningEfforts: [],
            },
        });
    }
    return result;
}
