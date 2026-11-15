/**
 * B7-01 服务脚本的核心：起停 / 状态 / 重启的 CLI 形态，执行器与 IO 全部可注入。
 *
 * status 的退出码直接取 runSelfCheck 的结果（0 全绿 / 1 配置缺项 / 2 安全红线），
 * 每一条检查都把「明确原因」打到日志里，不静默略过。
 * 本文件含最小 fs IO（pid 文件、仓库扫描），但 runService 本身只认接口，测试用假实现即可。
 */
import type { SelfCheckResult } from './selfcheck.ts';
/** 服务子命令。SETUP 与看护由 CLI 脚本单独识别，不进这里的状态机。 */
export type ServiceCommand = 'start' | 'stop' | 'status' | 'restart' | 'help';
/** 可注入的执行器：起停、查运行态、跑自检。 */
export interface ServiceExecutor {
    start(): void;
    stop(): void;
    isRunning(): boolean;
    selfCheck(): SelfCheckResult;
}
/** 可注入的日志出口。 */
export interface ServiceIO {
    log(message: string): void;
}
export interface ServiceDeps {
    executor: ServiceExecutor;
    io: ServiceIO;
}
/** 用法文本。 */
export declare const USAGE: string;
/** 解析命令行；未知命令一律落到 help。 */
export declare function parseArgs(argv: readonly string[]): ServiceCommand;
/** 跑一个服务命令，返回退出码（不自己 process.exit，便于测试）。 */
export declare function runService(command: ServiceCommand, deps: ServiceDeps): number;
/** 检查 B6 提示词 / 剧本资产是否齐全（manifest 为准）。 */
export declare function checkAssets(root: string): boolean;
/** 扫描仓库代码文件，返回命中自建 /orchestrator 路由的路径（跳过构建产物与依赖目录）。 */
export declare function scanRepositoryForRoutes(root: string): string[];
export interface FileExecutorOptions {
    root?: string;
    stateDir?: string;
    env?: NodeJS.ProcessEnv;
}
/** 基于 pid 文件的默认执行器：CLI 用它，测试可换成假实现。 */
export declare function createFileExecutor(options?: FileExecutorOptions): ServiceExecutor;
/** 默认 IO：打到 stdout。 */
export declare const defaultIO: ServiceIO;
