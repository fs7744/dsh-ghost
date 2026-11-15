/**
 * 工具层的可注入依赖的默认实现（纯内存、零 IO）。
 *
 * 宿主接真实存储 / 真实视图时只要实现 ConfigStore / ViewReader 接口替换即可，
 * 工具注册表本身一行都不用改。
 */
import { UserError } from '../core/index.js';
/** 允许的提示词分片名与必须保留的占位符；可由装配层用 prompts/manifest.json 覆盖。 */
export const DEFAULT_PROMPT_PARTS = [
    'orchestrator', 'shared', 'subscriptions', 'dispatch', 'handoff',
    'handoff-orchestrator', 'handoff-worker', 'worker', 'work', 'cli',
    'admission', 'replies', 'team/communication', 'team/delivery', 'team/scope',
];
/** 这些分片被系统填充占位符，改提示词时必须保留，否则模型拿不到必要上下文。 */
const PLACEHOLDERS = {
    handoff: ['{{ticket}}', '{{assignment}}'],
    'handoff-worker': ['{{ticket}}', '{{assignment}}'],
    worker: ['{{ticket}}'],
    dispatch: ['{{ticket}}'],
};
/** 提示词正文的字符预算：常驻体量之外的硬上限，防止把流程又塞回提示词。 */
export const PROMPT_CHAR_LIMIT = 4000;
/**
 * 纯内存配置仓。settings_save / policy_sync / prompts_save 三个工具共用它，
 * 拒绝一律抛 UserError，由 invokeTool 把原因原样返回给模型自愈。
 */
export class SettingsStore {
    data = new Map();
    policyVersion;
    promptTexts = new Map();
    parts;
    placeholders;
    /** 保存历史，供测试与状态页核对「确实写进去了」。 */
    writes = [];
    constructor(options = {}) {
        this.policyVersion = options.policyVersion ?? 'v1';
        this.parts = options.parts ?? DEFAULT_PROMPT_PARTS;
        this.placeholders = options.placeholders ?? PLACEHOLDERS;
        const now = options.now ?? (() => new Date().toISOString());
        for (const [block, value] of Object.entries(options.initial ?? {}))
            this.data.set(block, { ...value });
        this.stamp = now;
    }
    stamp;
    blocks() { return [...this.data.keys()]; }
    read(block) {
        const value = this.data.get(block);
        return value === undefined ? undefined : { ...value };
    }
    save(block, value) {
        const known = ['policy', 'executor', 'prompts', 'sources', 'accounts', 'models'];
        if (!known.includes(block))
            throw new UserError('unknownBlock', { block });
        this.data.set(block, { ...value });
        this.writes.push({ block, at: this.stamp() });
    }
    syncPolicy(from) {
        const previous = from ?? this.policyVersion;
        this.policyVersion = bump(this.policyVersion);
        return { from: previous, to: this.policyVersion };
    }
    savePrompt(id, text) {
        if (!this.parts.includes(id))
            throw new UserError('unknownPromptPart', { part: id });
        if (text.trim() === '')
            throw new UserError('promptPartEmpty', { part: id });
        if (text.length > PROMPT_CHAR_LIMIT)
            throw new UserError('promptTooLong', { limit: String(PROMPT_CHAR_LIMIT) });
        const required = this.placeholders[id] ?? [];
        const missing = required.filter(token => !text.includes(token));
        if (missing.length)
            throw new UserError('promptPlaceholders', { part: id, placeholders: missing.join(', ') });
        this.promptTexts.set(id, text);
        this.writes.push({ block: `prompt:${id}`, at: this.stamp() });
    }
    prompts() { return [...this.promptTexts.keys()]; }
    promptParts() { return [...this.parts]; }
}
/** 把 'v1' 推成 'v2'；非 vN 形状一律从 v1 重来。 */
function bump(version) {
    const match = /^v(\d+)$/.exec(version);
    return match === null ? 'v1' : `v${Number(match[1] ?? '0') + 1}`;
}
/**
 * 把一组面板视图绑成 ViewReader。装配层把 buildXxxView 的结果转成文本后传进来，
 * 工具层不需要认识视图的具体形状。
 */
export class StaticViewReader {
    views;
    constructor(views) {
        this.views = views;
    }
    read(view) { return this.views[view]; }
}
