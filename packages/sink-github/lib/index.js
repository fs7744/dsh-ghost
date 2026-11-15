/**
 * 创建 GitHub 评论出口。
 * @param options - 令牌、仓库与投递函数
 */
export function createGithubSink(options) {
    const apiBase = options.apiBase ?? 'https://api.github.com';
    const maxAttempts = Math.max(1, options.maxAttempts ?? 5);
    const maxBodyChars = Math.max(1, options.maxBodyChars ?? 60_000);
    const table = new Map();
    const headers = {
        authorization: `Bearer ${options.token}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
        'x-github-api-version': '2022-11-28',
    };
    const post = options.post ?? (async (url, body, requestHeaders) => {
        try {
            const response = await fetch(url, { method: 'POST', headers: requestHeaders, body: JSON.stringify(body) });
            if (!response.ok)
                return { ok: false, error: `HTTP ${response.status}` };
            const json = await response.json();
            return { ok: true, ...(json.id === undefined ? {} : { commentId: String(json.id) }) };
        }
        catch (error) {
            return { ok: false, error: String(error) };
        }
    });
    /** 消息对应到哪个 issue/PR 号。 */
    const targetOf = (message) => message.channel.address.number ?? (message.channel.thread.includes('#') ? message.channel.thread.split('#')[1] : undefined);
    return {
        send(message) {
            // 幂等：已存在就保留第一条，不覆盖
            if (table.has(message.id))
                return;
            table.set(message.id, { message, status: 'pending', attempts: 0 });
        },
        status(id) {
            return table.get(id)?.status;
        },
        withdraw(id) {
            const entry = table.get(id);
            // 已经发出去的收不回；未发的直接丢弃
            if (entry !== undefined && entry.status === 'pending')
                entry.status = 'dropped';
        },
        async flush() {
            let sent = 0;
            let failed = 0;
            for (const entry of table.values()) {
                if (entry.status !== 'pending')
                    continue;
                const number = targetOf(entry.message);
                if (number === undefined) {
                    entry.status = 'dropped';
                    entry.error = 'no-target';
                    continue;
                }
                if (entry.attempts >= maxAttempts) {
                    entry.status = 'dropped';
                    entry.error = `max-attempts(${maxAttempts}): ${entry.error ?? 'unknown'}`;
                    continue;
                }
                entry.attempts += 1;
                // GitHub 对评论正文有 65536 字符上限；超了会 422 永久失败，先截断并说明。
                const original = entry.message.text;
                const body = original.length <= maxBodyChars
                    ? original
                    : `${original.slice(0, maxBodyChars)}\n\n…（已截断，原文 ${original.length} 字）`;
                const result = await post(`${apiBase}/repos/${options.repo}/issues/${number}/comments`, { body }, headers);
                if (result.ok) {
                    entry.status = 'sent';
                    sent += 1;
                    if (result.commentId !== undefined)
                        entry.commentId = result.commentId;
                }
                else {
                    entry.error = result.error ?? 'unknown';
                    failed += 1;
                    // 4xx（除 408 / 429）是确定性拒绝：重试只会得到同样的结果，直接丢弃。
                    const status = Number(/HTTP (\d{3})/.exec(entry.error)?.[1] ?? 0);
                    if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
                        entry.status = 'dropped';
                    }
                }
            }
            return { sent, failed };
        },
        entries: () => [...table.values()],
    };
}
