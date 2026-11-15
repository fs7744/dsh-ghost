// SPDX-License-Identifier: Apache-2.0
/**
 * 对外稳定的 ModelAdapter 契约（C3-04，Apache-2.0）。
 *
 * 为什么不直接用 harness 的 LlmAdapter：它是 pre-stable 的公开抽象类，
 * 一次 harness 升级就可能改签名，把全部第三方插件一起打翻。我们在 harness-port
 * 之上再收一层，只暴露 3 个方法；用户插件只依赖本包，永远不 import 任何
 * @deepseek-ai/* 包。宿主侧负责把这层适配到最新的 harness。
 *
 * 本包是纯类型 + 纯函数：零网络、零 DOM、零文件系统，依赖全部可注入、可单测。
 * 版权与授权见包内 LICENSE（Apache License 2.0）。
 */
/** 契约版本。major 变化表示不兼容；宿主用 isCompatible 判断是否接受插件。 */
export const MODEL_ADAPTER_CONTRACT_VERSION = '1.0.0';
/** 解析三段版本号（可带预发布后缀）；非法返回 undefined。 */
function parseVersion(text) {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(text);
    if (match === null)
        return undefined;
    const major = Number(match[1] ?? '0');
    const minor = Number(match[2] ?? '0');
    const patch = Number(match[3] ?? '0');
    if (![major, minor, patch].every(Number.isFinite))
        return undefined;
    return { major, minor, patch };
}
/**
 * 兼容规则：major 必须相同；插件声明的 minor 不得高于宿主（宿主向后兼容旧插件）；
 * patch 与预发布后缀不影响判断。任一侧格式非法即不兼容。
 */
export function isCompatible(pluginVersion, hostVersion = MODEL_ADAPTER_CONTRACT_VERSION) {
    const plugin = parseVersion(pluginVersion);
    const host = parseVersion(hostVersion);
    if (plugin === undefined || host === undefined)
        return false;
    if (plugin.major !== host.major)
        return false;
    return plugin.minor <= host.minor;
}
/** 结构化兼容校验：插件启动自检用，返回原因而不是抛异常。 */
export function checkContract(plugin, hostVersion = MODEL_ADAPTER_CONTRACT_VERSION) {
    const pluginVersion = typeof plugin?.contractVersion === 'string' ? plugin.contractVersion : '';
    const ok = isCompatible(pluginVersion, hostVersion);
    let reason = '兼容';
    if (!ok) {
        reason = parseVersion(pluginVersion) === undefined
            ? '契约版本缺失或格式非法（要三段数字）'
            : 'major 不一致或插件 minor 高于宿主';
    }
    return { ok, reason, pluginVersion, hostVersion };
}
/** 参考实现：静态模型列表 + 回显，零网络零 DOM，可直接用于单测或本地演示。 */
export const DEFAULT_MODELS = Object.freeze([
    { id: 'echo-1', contextWindow: 8192, maxTokens: 2048 },
    { id: 'echo-2', contextWindow: 32768, maxTokens: 4096, reasoningEfforts: ['low', 'high'] },
]);
/** 工厂：用户插件可照此实现 3 个方法；examples/echo-adapter.ts 是可复制的完整示例。 */
export function createEchoAdapter(models = DEFAULT_MODELS) {
    return {
        listModels: () => models,
        chat: (request) => {
            const last = [...request.messages].reverse().find(message => message.role === 'user');
            return { content: `ECHO:${last?.content ?? ''}`, finishReason: 'stop' };
        },
        close: () => { },
    };
}
function toPascalCase(name) {
    return name.split('-').filter(part => part !== '').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('');
}
/**
 * 生成一份可复制的用户插件脚手架源码（纯函数，返回文本，不写盘）。
 * 生成的代码只 import 本契约包，不含任何 @deepseek-ai/* 依赖。
 */
export function generateAdapterScaffold(options) {
    if (typeof options.name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(options.name)) {
        throw new Error(`适配器名称不合法（要 kebab-case）: ${String(options.name)}`);
    }
    const ids = options.modelIds ?? ['echo-1'];
    const modelLines = ids.map(id => `  { id: ${JSON.stringify(id)} },`).join('\n');
    const factory = toPascalCase(options.name);
    return [
        '// SPDX-License-Identifier: Apache-2.0',
        '// 由 @dsh-ghost/model-adapter-kit 的 generateAdapterScaffold 生成，可自由修改。',
        "import type { ChatRequest, ChatResponse, ModelAdapter, ModelInfo } from '@dsh-ghost/model-adapter-kit'",
        '',
        `export const contractVersion = '${MODEL_ADAPTER_CONTRACT_VERSION}'`,
        '',
        'const MODELS: readonly ModelInfo[] = [',
        modelLines,
        ']',
        '',
        `export function create${factory}Adapter(): ModelAdapter {`,
        '  return {',
        '    listModels: () => MODELS,',
        '    chat: (request: ChatRequest): ChatResponse => {',
        "      const last = [...request.messages].reverse().find(message => message.role === 'user')",
        "      return { content: 'ECHO:' + (last?.content ?? ''), finishReason: 'stop' }",
        '    },',
        '    close: () => {},',
        '  }',
        '}',
        '',
    ].join('\n');
}
