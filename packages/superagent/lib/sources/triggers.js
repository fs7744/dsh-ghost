/**
 * 归一化事件 → 领域 Trigger，以及「值不值得建票」的判定。
 *
 * 关键策略：默认只给 addressed（点名了 agent）的事件建票。
 * 非 addressed 的旁观消息、机器人消息、空线程 / 空正文一律不建票，
 * 避免噪音把主动引擎塞满。这条是 B5 的核心准入，与领域 Policy 的 gate 分层。
 */
/** 一条归一化事件是否值得建票。 */
export function shouldOpenTicket(event, options = {}) {
    const requireAddressed = options.requireAddressed ?? true;
    if (requireAddressed && event.addressed !== true)
        return false;
    if (event.threadId === '' || event.text === '')
        return false;
    return true;
}
/** 把一批归一化事件转成领域 Trigger；过滤掉不建票的事件。 */
export function toTicketTriggers(events, options = {}) {
    const now = options.now ?? (() => new Date().toISOString());
    const makeId = options.makeId ?? ((_event, index) => `tr-${now()}-${index}-${Math.random().toString(36).slice(2, 8)}`);
    const result = [];
    let index = 0;
    for (const event of events) {
        if (!shouldOpenTicket(event, options))
            continue;
        const channel = event.channel;
        result.push({
            id: makeId(event, index++),
            source: event.source,
            threads: [{ source: event.source, id: event.threadId }],
            actor: { source: event.source, id: event.actor ?? event.source },
            human: event.human ?? false,
            ...(event.addressed === true ? { addressed: 'mention' } : {}),
            at: now(),
            text: event.text,
            ...(channel === undefined ? {} : {
                channel: { source: channel.source, thread: channel.thread, address: { ...channel.address } },
            }),
            ...(event.url === undefined ? {} : { url: event.url }),
            meta: { via: 'source-hub' },
        });
    }
    return result;
}
