/**
 * GitHub 事件源：把 webhook 变成领域里的 Trigger。
 *
 * 分两层，故意不掺 IO：
 *  1. `verifySignature` —— 用 HMAC-SHA256 校验 `x-hub-signature-256`，恒定时间比较；
 *  2. `toTriggers` —— 纯函数映射，未知事件返回空数组（不抛错，未知事件是常态）。
 *
 * 只有"人写的、且指向本 agent"的消息才算 `addressed`；机器人一律 `human: false`，
 * 这样上游策略才有机会把它们挡在门外。
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
/**
 * 校验 GitHub webhook 签名。
 * @param options - 含密钥的来源配置
 * @param rawBody - **原始字节**（不能是重新序列化的 JSON，否则签名必然不匹配）
 * @param header - `x-hub-signature-256` 头的值，形如 `sha256=…`
 */
export function verifySignature(options, rawBody, header) {
    if (options.secret === undefined || options.secret === '')
        return { ok: true };
    if (header === undefined || !header.startsWith('sha256='))
        return { ok: false, reason: 'missing-signature' };
    const expected = createHmac('sha256', options.secret).update(rawBody, 'utf8').digest('hex');
    const given = header.slice('sha256='.length);
    if (given.length !== expected.length)
        return { ok: false, reason: 'length-mismatch' };
    return timingSafeEqual(Buffer.from(given, 'hex'), Buffer.from(expected, 'hex'))
        ? { ok: true }
        : { ok: false, reason: 'digest-mismatch' };
}
/** 需要 @ 的名字集合（统一带 @ 前缀）。 */
function aliases(options) {
    const names = [options.botLogin, ...(options.mentionAliases ?? [])].filter((name) => typeof name === 'string' && name !== '');
    return names.map(name => (name.startsWith('@') ? name.toLowerCase() : `@${name}`.toLowerCase()));
}
/**
 * 一段文本是否点名了 agent。
 * @param text - 待检查的正文
 * @param options - 含 botLogin / mentionAliases 的配置
 */
export function mentionsAgent(text, options) {
    return aliases(options).some(alias => {
        // 不能只用 includes：`@ghostbusters` / `@ghost-bot` 会把 agent 误唤醒。
        // 边界排除字母、数字、下划线与连字符（GitHub 用户名允许连字符）。
        const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(^|[^a-z0-9_-])${escaped}(?![a-z0-9_-])`, 'i').test(text);
    });
}
/** 人写的还是机器写的。 */
function isHuman(payload) {
    return (payload.sender?.type ?? payload.comment?.user?.type ?? 'User') !== 'Bot';
}
/**
 * webhook → Trigger。未知事件返回空数组。
 * @param event - `x-github-event` 头的值（issue_comment / issues / pull_request / pull_request_review）
 * @param payload - 解析后的 JSON
 * @param options - 来源配置
 * @param now - 时间源（测试可注入）
 */
export function toTriggers(event, payload, options = {}, now = () => new Date().toISOString()) {
    const repo = payload.repository?.full_name;
    if (repo === undefined)
        return [];
    const at = now();
    const actor = { id: payload.sender?.login ?? 'unknown', name: payload.sender?.login ?? 'unknown' };
    const human = isHuman(payload);
    /** 组装一条触发；线程键用仓库 + 编号，保证同一 issue/PR 的事件聚在同一线程。 */
    const build = (number, text, url, addressed) => {
        const thread = { source: 'github', id: `${repo}#${number}` };
        return {
            id: `gh-${repo.replace('/', '-')}-${number}-${at}-${Math.random().toString(36).slice(2, 8)}`,
            source: 'github',
            threads: [thread],
            actor,
            human,
            ...(addressed ? { addressed: 'mention' } : {}),
            at,
            text,
            channel: { source: 'github', thread: thread.id, address: { repo, number: String(number) } },
            ...(url === undefined ? {} : { url }),
            meta: { event, action: payload.action ?? null, installationId: payload.installation?.id ?? null },
        };
    };
    if (event === 'issue_comment' && payload.action === 'created' && payload.comment !== undefined && payload.issue !== undefined) {
        const body = payload.comment.body ?? '';
        return [build(payload.issue.number, body, payload.comment.html_url, human && mentionsAgent(body, options))];
    }
    if (event === 'issues' && (payload.action === 'opened' || payload.action === 'reopened') && payload.issue !== undefined) {
        const text = `${payload.issue.title ?? ''}\n\n${payload.issue.body ?? ''}`.trim();
        return [build(payload.issue.number, text, payload.issue.html_url, false)];
    }
    // PR 事件也挂在同一个线程上：issue 编号与 PR 编号在 GitHub 里是同一序列
    if (event === 'pull_request' && (payload.action === 'opened' || payload.action === 'synchronize' || payload.action === 'closed') && payload.pull_request !== undefined) {
        const text = `${payload.pull_request.title ?? ''}\n\n${payload.pull_request.body ?? ''}`.trim();
        return [build(payload.pull_request.number, text, payload.pull_request.html_url, false)];
    }
    if (event === 'pull_request_review' && payload.action === 'submitted' && payload.pull_request !== undefined && payload.review !== undefined) {
        const body = payload.review.body ?? '';
        return [build(payload.pull_request.number, body, payload.review.html_url, human && mentionsAgent(body, options))];
    }
    return [];
}
