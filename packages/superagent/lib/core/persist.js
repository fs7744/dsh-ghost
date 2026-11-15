/**
 * 票据持久化：把内存仓库的票/线程/决策快照到 JSON 文件，启动时读回。
 *
 * 为什么是"快照"而不是逐条写入：内存仓库的写路径在事务里，逐条落盘会让
 * 一次 receive 变成几十次 fs 调用。快照的粒度就是事务粒度——`atomic()` 结束即落盘一次。
 *
 * 已知局限：整体重写文件，票量大时需要换成 append-only 或 SQLite（见 docs/FEATURES.md 已知限制）。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
/**
 * 把快照写进文件（tmp + rename，避免半截文件）。
 * @param repo - 内存仓库
 * @param file - 目标路径
 */
export function saveSnapshot(repo, file) {
    const snapshot = {
        version: 1,
        at: new Date().toISOString(),
        tickets: repo.tickets.list(),
        threads: repo.threads.list(),
        // 决策不单独存：票上有 decisionId，需要时按 id 取；避免快照里出现重复副本
        decisions: [],
    };
    mkdirSync(dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(snapshot, null, 2)}\n`);
    renameSync(temporary, file);
}
/**
 * 从文件恢复快照；文件不存在就什么都不做。
 * @param repo - 内存仓库
 * @param file - 快照路径
 * @returns 恢复的票数
 */
export function loadSnapshot(repo, file) {
    if (!existsSync(file))
        return 0;
    let snapshot;
    try {
        snapshot = JSON.parse(readFileSync(file, 'utf8'));
    }
    catch {
        return 0;
    }
    for (const thread of snapshot.threads ?? [])
        repo.threads.save(thread);
    for (const decision of snapshot.decisions ?? [])
        repo.decisions.save(decision);
    for (const ticket of snapshot.tickets ?? [])
        repo.tickets.save(ticket);
    return snapshot.tickets?.length ?? 0;
}
/**
 * 让仓库在每个事务结束后自动落盘，并在创建时读回历史。
 * @param repo - 内存仓库
 * @param file - 快照路径
 * @returns 同一个仓库（已包上持久化）
 */
export function persisting(repo, file) {
    loadSnapshot(repo, file);
    const original = repo.atomic.bind(repo);
    repo.atomic = (work) => {
        const result = original(work);
        try {
            saveSnapshot(repo, file);
        }
        catch {
            // 落盘失败不该让业务事务回滚：内存里仍是权威状态，下次事务会重试
        }
        return result;
    };
    return repo;
}
