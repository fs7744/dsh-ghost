var __rewriteRelativeImportExtension = (this && this.__rewriteRelativeImportExtension) || function (path, preserveJsx) {
    if (typeof path === "string" && /^\.\.?\//.test(path)) {
        return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function (m, tsx, d, ext, cm) {
            return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : (d + ext + "." + cm.toLowerCase() + "js");
        });
    }
    return path;
};
/**
 * 内置适配器。新增来源不需要改这里：写一份 generic 配置，或指一个自定义 mapper 文件。
 *
 * - `github`：复用 packages/source-github 的事件映射（不重复实现）
 * - `generic`：声明式字段模板，任意 JSON webhook
 * - `passthrough`：上游已经归一化好，直接透传
 * - `custom`：动态加载用户写的 .mjs mapper
 */
import { pathToFileURL } from 'node:url';
import { toTriggers } from '@dsh-ghost/source-github';
import { applyMapping } from './mapping.js';
/** 用户 mapper 文件的加载器；路径可以是绝对路径或 file: URL。 */
export async function importMapper(path) {
    const url = path.startsWith('file:') ? path : pathToFileURL(path).href;
    const loaded = await import(__rewriteRelativeImportExtension(url));
    if (typeof loaded.default !== 'function')
        throw new Error(`mapper 没有默认导出函数：${path}`);
    return loaded.default;
}
/** 运行时形状校验：外部数据一律不信任。 */
export function isNormalizedEvent(value) {
    if (value === null || typeof value !== 'object')
        return false;
    const item = value;
    return typeof item.source === 'string' && typeof item.threadId === 'string' && typeof item.text === 'string';
}
/** GitHub webhook：issue / PR / 评论 / review。 */
export const githubAdapter = {
    id: 'github',
    description: 'GitHub webhook（issue、PR、评论、review）',
    normalize(request, spec) {
        const event = request.event ?? request.headers['x-github-event'] ?? '';
        const triggers = toTriggers(event, request.body, {
            botLogin: String(spec.options?.botLogin ?? ''),
            mentionAliases: Array.isArray(spec.options?.mentionAliases) ? spec.options.mentionAliases : [],
        });
        return triggers.map(trigger => ({
            source: trigger.source,
            threadId: trigger.threads[0]?.id ?? '',
            text: trigger.text,
            human: trigger.human,
            addressed: trigger.addressed === 'mention',
            ...(trigger.url === undefined ? {} : { url: trigger.url }),
            actor: String(trigger.actor?.id ?? 'unknown'),
            ...(trigger.channel === undefined ? {} : { channel: trigger.channel }),
        }));
    },
};
/** 任意 JSON webhook：完全由配置决定字段从哪来。 */
export const genericAdapter = {
    id: 'generic',
    description: '声明式映射（任意 JSON webhook，只改配置不改代码）',
    normalize(request, spec) {
        if (spec.mapping === undefined)
            throw new Error(`来源 ${spec.id} 缺少 mapping`);
        return applyMapping(spec.mapping, request, spec.id);
    },
};
/** 已经归一化的事件数组（脚本 / IM 网关 / 内部调用）。 */
export const passthroughAdapter = {
    id: 'passthrough',
    description: '归一化事件直投',
    normalize(request) {
        const items = Array.isArray(request.body) ? request.body : [request.body];
        return items.filter(isNormalizedEvent);
    },
};
/** 用户自己写的 mapper，输入原始材料，输出归一化事件。 */
export const customAdapter = {
    id: 'custom',
    description: '用户自定义 .mjs mapper',
    async normalize(request, spec, context) {
        if (spec.mapper === undefined)
            throw new Error(`来源 ${spec.id} 缺少 mapper`);
        const map = await context.importMapper(spec.mapper);
        const mapped = await map({
            headers: request.headers,
            rawBody: request.rawBody,
            body: request.body,
            ...(request.event === undefined ? {} : { event: request.event }),
            options: spec.options ?? {},
        });
        return Array.isArray(mapped) ? mapped.filter(isNormalizedEvent) : [];
    },
};
/** 按 kind 选适配器。 */
export function adapterFor(kind) {
    switch (kind) {
        case 'github': return githubAdapter;
        case 'generic': return genericAdapter;
        case 'custom': return customAdapter;
        case 'passthrough': return passthroughAdapter;
    }
}
