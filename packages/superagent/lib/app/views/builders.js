/**
 * 7 个面板视图的纯函数实现。
 *
 * 统一形状：buildXxxView(repo, extra?) -> { view, rows, summary, actions }。
 * 只读 Repositories 与可注入的 extra，不改任何状态；界面自行渲染 rows / actions。
 *
 * 一条关键领域规则（PLAN §9）：`ready` 报告在没有 follow 项（如 PR 未合并）时直接结束票。
 * 所以 Overview 只挑 ticketStage 为 person 的票；已结束的票（含 completed）一律不进「待人处理」。
 */
import { canRetry, latestReport, reasonText, ticketStage } from '../../core/index.js';
/** 把 TicketStage 压成界面可直接显示的字符串。 */
function stageLabel(stage) {
    return 'action' in stage && stage.action !== undefined ? `${stage.stage}/${stage.action}` : stage.stage;
}
function makeRow(id, cells, needsPerson = false) {
    return { id, cells, needsPerson };
}
function makeAction(id, label, tool, target, humanGate) {
    return { id, label, tool, target, humanGate };
}
function makeSummary(total, needsPerson, text, rest = {}) {
    return { total, needsPerson, text, ...rest };
}
/** B4-01 Overview：只显示需要人处理的票。 */
export function buildOverviewView(repo) {
    const tickets = repo.tickets.list();
    const personTickets = tickets.filter(ticket => ticketStage(ticket).stage === 'person');
    const rows = personTickets.map(ticket => makeRow(`overview:${ticket.id}`, {
        ticket: ticket.id,
        title: ticket.title,
        stage: stageLabel(ticketStage(ticket)),
        question: ticket.attention?.question ?? null,
        report: latestReport(ticket)?.summary ?? null,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
    }, true));
    const actions = personTickets.flatMap(ticket => {
        const stage = ticketStage(ticket);
        const actionKind = 'action' in stage ? stage.action : undefined;
        const primary = actionKind === 'answer'
            ? makeAction(`reply:${ticket.id}`, '答复提问', 'orchestrator_reply', ticket.id, true)
            : actionKind === 'review'
                ? makeAction(`review:${ticket.id}`, '审阅结果', 'orchestrator_read', 'tickets', true)
                : makeAction(`retry:${ticket.id}`, '重试卡住的票', 'orchestrator_ticket_retry', ticket.id, true);
        return [primary, makeAction(`stop:${ticket.id}`, '叫停这张票', 'orchestrator_route', ticket.id, true)];
    });
    return {
        view: 'overview',
        rows,
        summary: makeSummary(tickets.length, personTickets.length, personTickets.length ? `有 ${personTickets.length} 张票需要人处理` : '当前没有需要人处理的票', { open: tickets.filter(item => !item.ended).length, ended: tickets.filter(item => !!item.ended).length }),
        actions,
    };
}
/** B4-02 Tickets：全部工作项列表与概要详情。 */
export function buildTicketsView(repo) {
    const tickets = repo.tickets.list();
    const rows = tickets.map(ticket => {
        const stage = ticketStage(ticket);
        return makeRow(`ticket:${ticket.id}`, {
            id: ticket.id,
            title: ticket.title,
            stage: stageLabel(stage),
            outcome: ticket.ended?.outcome ?? null,
            assignments: ticket.assignments.length,
            inputs: ticket.inputs.length,
            report: latestReport(ticket)?.summary ?? null,
            createdAt: ticket.createdAt,
        }, stage.stage === 'person');
    });
    const actions = tickets.filter(ticket => !ticket.ended).flatMap(ticket => [
        ...(canRetry(ticket) ? [makeAction(`retry:${ticket.id}`, '重试', 'orchestrator_ticket_retry', ticket.id, true)] : []),
        makeAction(`status:${ticket.id}`, '请求状态', 'orchestrator_ticket_request_status', ticket.id, false),
        makeAction(`stop:${ticket.id}`, '叫停', 'orchestrator_route', ticket.id, true),
    ]);
    const needsPerson = rows.filter(row => row.needsPerson).length;
    return {
        view: 'tickets',
        rows,
        summary: makeSummary(tickets.length, needsPerson, `共 ${tickets.length} 张票，${needsPerson} 张待人处理`, {
            open: tickets.filter(item => !item.ended).length,
            ended: tickets.filter(item => !!item.ended).length,
        }),
        actions,
    };
}
/** B4-03 Records：决策记录与派活报告，按时间排序。 */
export function buildRecordsView(repo) {
    const threads = repo.threads.list();
    const decisions = threads.flatMap(thread => repo.decisions.byThread(thread.key));
    const tickets = repo.tickets.list();
    const reports = tickets.flatMap(ticket => ticket.assignments.flatMap(assignment => assignment.report === undefined
        ? []
        : [{ ticketId: ticket.id, assignmentId: assignment.id, report: assignment.report }]));
    const rows = [
        ...decisions.map(decision => makeRow(`decision:${decision.id}`, {
            kind: 'decision',
            id: decision.id,
            at: decision.at,
            verdict: decision.kind,
            reason: reasonText(decision.reason),
            ticket: decision.ticketId ?? null,
            thread: decision.threadKey,
        })),
        ...reports.map(item => makeRow(`report:${item.ticketId}:${item.assignmentId}`, {
            kind: 'report',
            id: item.assignmentId,
            at: item.report.at,
            verdict: item.report.state,
            reason: item.report.summary,
            ticket: item.ticketId,
            thread: '',
        })),
    ].sort((left, right) => String(left.cells['at'] ?? '').localeCompare(String(right.cells['at'] ?? '')));
    return {
        view: 'records',
        rows,
        summary: makeSummary(rows.length, 0, `${decisions.length} 条决策、${reports.length} 条报告`, {
            decisions: decisions.length, reports: reports.length,
        }),
        actions: [makeAction('records:refresh', '刷新记录', 'orchestrator_read', 'records', false)],
    };
}
/** B4-04 Threads：线程与订阅概况。 */
export function buildThreadsView(repo) {
    const threads = repo.threads.list();
    const rows = threads.map(thread => makeRow(`thread:${thread.key}`, {
        key: thread.key,
        source: thread.ref.source,
        id: thread.ref.id,
        subscriptions: thread.subscriptions.length,
        pending: thread.pending.length,
        evaluating: thread.evaluating?.id ?? null,
        lastAt: thread.lastAt ?? null,
        createdAt: thread.createdAt,
    }));
    const actions = threads
        .filter(thread => thread.subscriptions.length > 0)
        .map(thread => makeAction(`unsubscribe:${thread.key}`, '取消订阅', 'orchestrator_thread_unsubscribe', thread.key, true));
    const subscriptions = threads.reduce((sum, thread) => sum + thread.subscriptions.length, 0);
    return {
        view: 'threads',
        rows,
        summary: makeSummary(threads.length, 0, `${threads.length} 个线程、${subscriptions} 条订阅`, {
            withPending: threads.filter(item => item.pending.length > 0).length,
            evaluating: threads.filter(item => item.evaluating !== undefined).length,
            subscriptions,
        }),
        actions,
    };
}
/** B4-05 Sources：触发源配置（默认关闭的源要显眼）。 */
export function buildSourcesView(repo, extra = {}) {
    const sources = extra.sources ?? [];
    const rows = sources.map(source => makeRow(`source:${source.id}`, {
        id: source.id,
        kind: source.kind,
        description: source.description,
        auth: source.auth,
        enabled: source.enabled ?? true,
    }));
    const actions = sources.flatMap(source => [
        makeAction(`toggle:${source.id}`, source.enabled === false ? '启用' : '停用', 'orchestrator_settings_save', source.id, true),
        makeAction(`ingest:${source.id}`, '投递一次', 'orchestrator_read', 'sources', false),
    ]);
    const enabled = sources.filter(item => item.enabled !== false).length;
    return {
        view: 'sources',
        rows,
        summary: makeSummary(sources.length, 0, `${sources.length} 个来源，${enabled} 个启用`, {
            enabled, disabled: sources.length - enabled,
            tickets: repo.tickets.list().length,
        }),
        actions,
    };
}
/** B4-06 Settings：策略 / 执行器 / 提示词配置块。 */
export function buildSettingsView(repo, extra = {}) {
    const settings = extra.settings ?? {};
    const rows = Object.entries(settings).map(([block, value]) => makeRow(`settings:${block}`, {
        block,
        keys: value !== null && typeof value === 'object' ? Object.keys(value).length : 1,
        preview: typeof value === 'string' ? value.slice(0, 80) : String(JSON.stringify(value) ?? '').slice(0, 80),
    }));
    return {
        view: 'settings',
        rows,
        summary: makeSummary(rows.length, 0, rows.length ? `${rows.length} 个配置块` : '尚未配置任何设置', {
            blocks: rows.length, tickets: repo.tickets.list().length,
        }),
        actions: [
            makeAction('settings:save', '保存配置块', 'orchestrator_settings_save', '', true),
            makeAction('settings:sync', '同步策略', 'orchestrator_policy_sync', '', true),
            makeAction('settings:prompts', '保存提示词', 'orchestrator_prompts_save', '', true),
        ],
    };
}
/** B4-07 部署配置页：机器 + 账号 + 自检结果，缺项要显眼。 */
export function buildDeployView(repo, extra = {}) {
    const checks = extra.checks ?? [];
    const deploy = extra.deploy;
    const rows = [
        ...checks.map(check => makeRow(`check:${check.id}`, {
            kind: 'check', id: check.id, ok: check.ok, reason: check.reason,
        }, !check.ok)),
        ...(deploy === undefined ? [] : [
            makeRow('deploy:service', { kind: 'deploy', key: 'service', value: deploy.service }),
            makeRow('deploy:stateDir', { kind: 'deploy', key: 'stateDir', value: deploy.stateDir }),
            makeRow('deploy:watch', { kind: 'deploy', key: 'watchIntervalMinutes', value: deploy.watchIntervalMinutes }),
            ...deploy.accounts.map(account => makeRow(`deploy:account:${account}`, { kind: 'deploy', key: 'account', value: account })),
            ...Object.entries(deploy.machine).map(([key, value]) => makeRow(`deploy:machine:${key}`, { kind: 'deploy', key, value })),
        ]),
    ];
    const failed = checks.filter(check => !check.ok);
    return {
        view: 'deploy',
        rows,
        summary: makeSummary(rows.length, failed.length, failed.length ? `${failed.length} 项配置未就绪` : '部署配置齐全', {
            checks: checks.length, failed: failed.length, ready: checks.length - failed.length,
            tickets: repo.tickets.list().length,
        }),
        actions: [
            makeAction('deploy:status', '重新自检', 'orchestrator_read', 'deploy', false),
            makeAction('deploy:setup', '运行 SETUP 向导', 'orchestrator_settings_save', '', true),
            makeAction('deploy:restart', '重启服务', 'orchestrator_settings_save', '', true),
        ],
    };
}
/** 7 个视图名，顺序即账本 §B4。 */
export const VIEW_NAMES = ['overview', 'tickets', 'records', 'threads', 'sources', 'settings', 'deploy'];
/** 视图名到 builder 的映射，装配层与 orchestrator_read 共用。 */
export const VIEW_BUILDERS = {
    overview: buildOverviewView,
    tickets: buildTicketsView,
    records: buildRecordsView,
    threads: buildThreadsView,
    sources: buildSourcesView,
    settings: buildSettingsView,
    deploy: buildDeployView,
};
/** 把某个视图渲成人话文本，供 orchestrator_read / ViewReader 使用。 */
export function renderViewText(view) {
    const header = `[${view.view}] ${view.summary.text}`;
    if (view.rows.length === 0)
        return `${header}\n（没有数据）`;
    const lines = view.rows.map(row => {
        const cells = Object.entries(row.cells).map(([key, value]) => `${key}=${value === null ? '-' : String(value)}`).join(' ');
        return `${row.needsPerson ? '* ' : '  '}${row.id} ${cells}`;
    });
    return `${header}\n${lines.join('\n')}\n可用动作：${view.actions.map(action => action.label).join(' / ') || '无'}`;
}
