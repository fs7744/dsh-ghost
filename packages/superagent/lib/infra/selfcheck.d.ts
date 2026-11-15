/**
 * B7-02 自检与 status 退出码，以及 C2-01 的静态断言。
 *
 * 纯逻辑、零 IO：配置 / 装配完整性由可注入的输入给出，路由扫描由调用方读入文件后传入。
 * 缺项一律给「明确原因」的人话，不静默略过；status 子命令直接把 exitCode 交出去。
 */
/** status 退出码：0 全绿、1 配置缺项、2 触到安全红线。 */
export declare const EXIT_OK = 0;
export declare const EXIT_INCOMPLETE = 1;
export declare const EXIT_SECURITY = 2;
/** 一条检查项。severity=security 的失败把退出码抬到 2。 */
export interface CheckItem {
    id: string;
    ok: boolean;
    reason: string;
    severity?: 'missing' | 'security';
}
/** 自检输入，全部可注入；文件扫描结果由调用方传入。 */
export interface SelfCheckInput {
    env?: NodeJS.ProcessEnv;
    /** 状态目录是否可写。 */
    stateDirReady?: boolean;
    /** B6 提示词 / 剧本资产是否齐全（静态验收核对后注入）。 */
    assetsReady?: boolean;
    /** C2-01 扫描命中的自建 /orchestrator 路由文件列表。 */
    selfBuiltRoutes?: readonly string[];
}
export interface SelfCheckResult {
    ok: boolean;
    exitCode: number;
    checks: CheckItem[];
    summary: string;
}
/** 8 项完整性检查：配置 3 项、装配清单 3 项、资产 1 项、安全红线 1 项。 */
export declare function runSelfCheck(input?: SelfCheckInput): SelfCheckResult;
/** 判断单段代码是否含自建 /orchestrator 路由。 */
export declare function containsSelfBuiltOrchestratorRoute(text: string): boolean;
/** 扫一批文件内容，返回命中自建路由的代码文件路径。只扫代码文件，不扫文档，跳过断言定义自身。 */
export declare function findSelfBuiltRoutes(entries: readonly {
    path: string;
    text: string;
}[]): string[];
