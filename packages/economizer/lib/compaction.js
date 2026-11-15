/**
 * 上下文预算与触发判断（纯逻辑）。
 *
 * 范围说明（重要）：**就地压缩本身由宿主 `/compact` 完成**，就像 Claude Code、
 * Codex、Cursor 那样——宿主没暴露改写历史的接口（`session/page` 只读、
 * `session/prompt` 只追加），我们无法自己替换旧消息。
 * 我们负责的是另一半，也是真正属于产品体验的部分：
 *  - 估算当前上下文占用的 token（决定什么时候该压）；
 *  - 给出一个可解释的触发计划；
 *  - 决定用哪种模式（就地压缩 / 关闭）。
 */
/**
 * 估算 token：CJK 约 1 字 1 token，其余约 4 字符 1 token。
 * 只是量级判断，不追求与真实分词器一致。
 */
export function estimateTokens(text) {
    let cjk = 0;
    let other = 0;
    for (const char of text) {
        const code = char.codePointAt(0) ?? 0;
        if (code > 0x2e80)
            cjk += 1;
        else
            other += 1;
    }
    return Math.ceil(cjk + other / 4);
}
/**
 * 判断当前上下文是否该压缩。
 */
export function planCompaction(messages, options = {}) {
    const maxTokens = options.maxTokens ?? 12_000;
    const minMessages = options.minMessages ?? 8;
    const estimatedTokens = messages.reduce((sum, message) => sum + estimateTokens(message.text), 0);
    const messageCount = messages.length;
    const overflowTokens = Math.max(0, estimatedTokens - maxTokens);
    return {
        compress: estimatedTokens > maxTokens && messageCount >= minMessages,
        estimatedTokens,
        messageCount,
        overflowTokens,
    };
}
