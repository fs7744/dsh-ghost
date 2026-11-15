/**
 * B7-03 SETUP 引导流程：12 步问答 → 计划 → 执行（先保留 CLI 形态）。
 *
 * 纯逻辑 + 可注入 IO：问答、计划、执行三段都能在测试里用假 IO / 假 executor 跑完，
 * 不碰 readline、不碰文件、不碰宿主。将来 C5-11 把它变 GUI 时，三段逻辑原样复用。
 */
/** 一步问答。validate 返回 null 表示通过，否则返回人话拒绝原因。 */
export interface SetupQuestion {
    id: string;
    prompt: string;
    defaultAnswer: string;
    validate: (answer: string) => string | null;
}
/** 计划里的一步：把答案变成一个可执行的动作。 */
export interface SetupStep {
    id: string;
    action: string;
    value: string;
}
export interface SetupPlan {
    steps: SetupStep[];
    errors: Array<{
        id: string;
        reason: string;
    }>;
    answers: Record<string, string>;
}
export interface SetupIO {
    ask(question: SetupQuestion): string | Promise<string>;
    log(message: string): void;
}
export interface SetupExecutor {
    apply(step: SetupStep): void;
}
export interface SetupResult {
    applied: number;
    skipped: number;
    errors: Array<{
        id: string;
        reason: string;
    }>;
}
/** 12 步问答，顺序即 SETUP 向导顺序。 */
export declare const SETUP_STEPS: readonly SetupQuestion[];
/** 把 12 个答案转成计划：逐项校验，不合法的记进 errors 而不静默丢弃。 */
export declare function buildSetupPlan(answers: Record<string, string>): SetupPlan;
/** 执行计划：逐条交给可注入的 executor；校验失败的项跳过并说明。 */
export declare function executeSetupPlan(plan: SetupPlan, executor: SetupExecutor, io: SetupIO): SetupResult;
/** 完整向导：12 步问答 → 计划 → 执行。空回答用默认值。 */
export declare function runSetup(io: SetupIO, executor: SetupExecutor): Promise<SetupResult>;
