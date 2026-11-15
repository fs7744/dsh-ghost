const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;
/** 把 `09:00` 规范成宿主要的 `HH:mm:ss`（宿主只收带秒的）。 */
export function normalizeTime(value) {
    const match = TIME_PATTERN.exec(value.trim());
    if (match === null)
        return undefined;
    const [, hh = '00', mm = '00', ss = '00'] = match;
    return `${hh}:${mm}:${ss}`;
}
/**
 * 解析一行计划声明：`daily 09:00 Asia/Shanghai`。
 * @returns 计划；格式不对返回 undefined
 */
export function parseScheduleLine(line) {
    const parts = line.trim().split(/\s+/).filter(part => part !== '');
    const kind = parts[0];
    if (kind === undefined)
        return undefined;
    const rest = parts.slice(1);
    const timeZone = rest.length > 0 && /^[A-Za-z]+\/[A-Za-z_+-]+$/.test(rest[rest.length - 1] ?? '') ? rest.pop() : undefined;
    if (kind === 'daily') {
        const time = normalizeTime(rest[0] ?? '');
        if (time === undefined)
            return undefined;
        return { kind: 'daily', time, ...(timeZone === undefined ? {} : { timeZone }) };
    }
    if (kind === 'weekly') {
        // weekly <星期几> <时刻> [时区]，如 weekly 1,3,5 08:30:00 Asia/Shanghai
        const days = rest[0];
        const time = normalizeTime(rest[1] ?? '');
        if (days === undefined || !/^[1-7](,[1-7])*$/.test(days))
            return undefined;
        if (time === undefined)
            return undefined;
        return { kind: 'weekly', time, days, ...(timeZone === undefined ? {} : { timeZone }) };
    }
    if (kind === 'cron') {
        const expression = rest.join(' ');
        if (expression.split(/\s+/).length !== 5)
            return undefined;
        return { kind: 'cron', expression, ...(timeZone === undefined ? {} : { timeZone }) };
    }
    if (kind === 'every') {
        const seconds = Number.parseInt(rest[0] ?? '', 10);
        if (!Number.isFinite(seconds) || seconds <= 0)
            return undefined;
        return { kind: 'every', seconds };
    }
    if (kind === 'at') {
        const at = rest[0];
        if (at === undefined)
            return undefined;
        return { kind: 'at', at };
    }
    if (kind === 'after') {
        const seconds = Number.parseInt(rest[0] ?? '', 10);
        if (!Number.isFinite(seconds) || seconds <= 0)
            return undefined;
        return { kind: 'after', afterSeconds: seconds };
    }
    return undefined;
}
/**
 * 计划 → 宿主的 timing 结构（`schedule/create` 的 timing 字段）。
 * @returns timing，或 undefined（声明不合法）
 */
export function buildTiming(schedule) {
    switch (schedule.kind) {
        case 'daily':
            if (schedule.time === undefined)
                return undefined;
            return {
                kind: 'daily',
                daily: { time: schedule.time, time_zone: schedule.timeZone ?? 'Asia/Shanghai' },
            };
        case 'weekly': {
            if (schedule.time === undefined || schedule.days === undefined)
                return undefined;
            const days = schedule.days.split(',').map(day => Number.parseInt(day, 10));
            if (days.some(day => day < 1 || day > 7))
                return undefined;
            return {
                kind: 'weekly',
                weekly: { days, time: schedule.time, time_zone: schedule.timeZone ?? 'Asia/Shanghai' },
            };
        }
        case 'cron':
            if (schedule.expression === undefined)
                return undefined;
            return {
                kind: 'cron',
                cron: { expression: schedule.expression, time_zone: schedule.timeZone ?? 'Asia/Shanghai' },
            };
        case 'every':
            if (schedule.seconds === undefined)
                return undefined;
            return { kind: 'every', every_seconds: schedule.seconds };
        case 'at':
            if (schedule.at === undefined)
                return undefined;
            return { kind: 'at', at: schedule.at };
        case 'after':
            if (schedule.afterSeconds === undefined)
                return undefined;
            return { kind: 'after', after_seconds: schedule.afterSeconds };
        default:
            return undefined;
    }
}
/** 剧本执行提示词（定时投递的内容）。 */
export function buildPrompt(flow, flowPath) {
    const target = flowPath === undefined ? '' : `（流程文件：${flowPath}）`;
    return `按剧本「${flow.id}」执行。${target}`.trim();
}
/** 建计划请求（`schedule/create` 的 request）。 */
export function buildCreateRequest(options) {
    const timing = buildTiming(options.schedule);
    if (timing === undefined)
        return undefined;
    return {
        title: options.title,
        prompt: options.prompt,
        timing,
        target: options.sessionId === undefined
            ? { kind: 'new' }
            : { kind: 'session', sessionId: options.sessionId },
    };
}
/** 归一化宿主 schedule 列表项。 */
export function normalizeScheduleTasks(raw) {
    const out = [];
    const list = Array.isArray(raw) ? raw : [];
    for (const value of list) {
        if (typeof value !== 'object' || value === null)
            continue;
        const item = value;
        const id = typeof item.id === 'string' ? item.id : '';
        if (id === '')
            continue;
        const kind = typeof item.kind === 'string' ? item.kind : 'unknown';
        const target = typeof item.target === 'object' && item.target !== null
            ? item.target
            : undefined;
        const sessionId = typeof target?.sessionId === 'string' ? target.sessionId : undefined;
        const when = kind === 'daily' || kind === 'weekly'
            ? String(item.time ?? '')
            : kind === 'cron'
                ? String(item.expression ?? '')
                : kind === 'every'
                    ? `每 ${String(item.everySeconds ?? '')} 秒`
                    : kind === 'at'
                        ? String(item.scheduledAt ?? '')
                        : '';
        out.push({
            id,
            kind,
            title: typeof item.title === 'string' ? item.title : id,
            when,
            ...(typeof item.timeZone === 'string' ? { timeZone: item.timeZone } : {}),
            status: typeof item.status === 'string' ? item.status : 'active',
            ...(sessionId === undefined ? {} : { sessionId }),
            ...(typeof item.scheduledAt === 'string' ? { scheduledAt: item.scheduledAt } : {}),
        });
    }
    return out;
}
