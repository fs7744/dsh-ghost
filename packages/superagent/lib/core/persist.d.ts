import type { Repositories } from './ports.ts';
/**
 * 把快照写进文件（tmp + rename，避免半截文件）。
 * @param repo - 内存仓库
 * @param file - 目标路径
 */
export declare function saveSnapshot(repo: Repositories, file: string): void;
/**
 * 从文件恢复快照；文件不存在就什么都不做。
 * @param repo - 内存仓库
 * @param file - 快照路径
 * @returns 恢复的票数
 */
export declare function loadSnapshot(repo: Repositories, file: string): number;
/**
 * 让仓库在每个事务结束后自动落盘，并在创建时读回历史。
 * @param repo - 内存仓库
 * @param file - 快照路径
 * @returns 同一个仓库（已包上持久化）
 */
export declare function persisting(repo: Repositories, file: string): Repositories;
