import { validateCapabilities } from './core.js';
import { validateCredentialRef } from './credentials.js';
export const LOCAL_PRESETS = ['ollama', 'vllm'];
const PRESETS = {
    ollama: { displayName: 'Ollama (local)', defaultPort: 11434, defaultModel: 'llama3.1', apiKeyEnv: 'OLLAMA_API_KEY', contextWindow: 128000, maxTokens: 8192 },
    vllm: { displayName: 'vLLM (local)', defaultPort: 8000, defaultModel: 'local-model', apiKeyEnv: 'VLLM_API_KEY', contextWindow: 32768, maxTokens: 4096 },
};
/** 类型守卫，让 generateLocalRoute 能接受任意字符串并给出明确拒绝。 */
export function isLocalPreset(value) {
    return value === 'ollama' || value === 'vllm';
}
/** 生成一条本地模型 route；非法值直接抛，绝不静默回退到默认值。 */
export function generateLocalRoute(preset, options = {}) {
    if (!isLocalPreset(preset))
        throw new Error(`未知本地预设: ${preset}`);
    const base = PRESETS[preset];
    const host = options.host ?? '127.0.0.1';
    const port = options.port ?? base.defaultPort;
    const modelId = options.modelId ?? base.defaultModel;
    const contextWindow = options.contextWindow ?? base.contextWindow;
    const maxTokens = options.maxTokens ?? base.maxTokens;
    const reasoningEfforts = options.reasoningEfforts ?? [];
    const apiKeyEnv = options.apiKeyEnv ?? base.apiKeyEnv;
    if (!/^[A-Za-z0-9.-]+$/.test(host) || host.includes('://'))
        throw new Error(`host 不合法: ${host}`);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
        throw new Error(`port 不合法: ${String(port)}`);
    if (!/^[\w.:-]+$/.test(modelId))
        throw new Error(`modelId 不合法: ${modelId}`);
    const cred = validateCredentialRef(apiKeyEnv);
    if (!cred.ok)
        throw new Error(`apiKeyEnv 不合法: ${cred.reason}`);
    const capErrors = validateCapabilities({ contextWindow, maxTokens, reasoningEfforts });
    if (capErrors.length > 0)
        throw new Error(`能力标注不合法: ${capErrors.join('; ')}`);
    return {
        id: preset,
        displayName: base.displayName,
        api: 'openai-completions',
        baseURL: `http://${host}:${port}/v1`,
        apiKeyEnv,
        models: [{ id: modelId, capabilities: { contextWindow, maxTokens, reasoningEfforts } }],
    };
}
