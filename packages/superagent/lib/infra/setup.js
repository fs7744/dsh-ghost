/**
 * B7-03 SETUP 引导流程：12 步问答 → 计划 → 执行（先保留 CLI 形态）。
 *
 * 纯逻辑 + 可注入 IO：问答、计划、执行三段都能在测试里用假 IO / 假 executor 跑完，
 * 不碰 readline、不碰文件、不碰宿主。将来 C5-11 把它变 GUI 时，三段逻辑原样复用。
 */
/** 通用校验器。 */
const nonEmpty = (answer) => answer.trim() === '' ? '不能为空' : null;
const kebab = (answer) => /^[a-z][a-z0-9-]*$/.test(answer) ? null : '只能用小写字母、数字和连字符，且以字母开头';
const yesNo = (answer) => /^(yes|no)$/i.test(answer) ? null : '只能填 yes 或 no';
const envName = (answer) => /^[A-Z][A-Z0-9_]*$/.test(answer) ? null : '环境变量名只能是大写字母、数字和下划线';
const statePath = (answer) => answer.includes('..') ? '状态目录不能包含 ..' : nonEmpty(answer);
const minutes = (answer) => /^\d+$/.test(answer) && Number(answer) >= 1 && Number(answer) <= 720
    ? null : '看护间隔要是 1 到 720 之间的整数分钟';
/** 12 步问答，顺序即 SETUP 向导顺序。 */
export const SETUP_STEPS = [
    { id: 'serviceName', prompt: '服务名（kebab-case）', defaultAnswer: 'dsh-superagent', validate: kebab },
    { id: 'stateDir', prompt: '状态目录（相对仓库根）', defaultAnswer: '.ghost/superagent', validate: statePath },
    { id: 'driveSession', prompt: '驱动会话 id（auto 表示自动选最新）', defaultAnswer: 'auto', validate: nonEmpty },
    { id: 'githubEnabled', prompt: '是否启用 GitHub 触发源（yes/no）', defaultAnswer: 'yes', validate: yesNo },
    { id: 'githubSecretEnv', prompt: 'GitHub webhook 密钥的环境变量名', defaultAnswer: 'GH_WEBHOOK_SECRET', validate: envName },
    { id: 'githubBotLogin', prompt: 'GitHub bot 登录名', defaultAnswer: 'dsh-ghost', validate: nonEmpty },
    { id: 'mentionAliases', prompt: '额外的 @ 别名（逗号分隔）', defaultAnswer: 'ghost', validate: nonEmpty },
    { id: 'feishuEnabled', prompt: '是否启用飞书触发源（yes/no，默认关闭）', defaultAnswer: 'no', validate: yesNo },
    { id: 'feishuSecretEnv', prompt: '飞书 webhook 密钥的环境变量名', defaultAnswer: 'FEISHU_WEBHOOK_SECRET', validate: envName },
    { id: 'feishuMention', prompt: '飞书里点名 agent 的别名', defaultAnswer: '@ghost', validate: nonEmpty },
    { id: 'watchIntervalMinutes', prompt: '小时级看护的体检间隔（分钟）', defaultAnswer: '60', validate: minutes },
    { id: 'permissionMode', prompt: '权限档位（workspace-write / danger-full-access）', defaultAnswer: 'workspace-write', validate: nonEmpty },
];
/** 每一步对应的执行动作描述。 */
const ACTIONS = {
    serviceName: '写入服务名',
    stateDir: '创建状态目录',
    driveSession: '设置驱动会话',
    githubEnabled: '配置 GitHub 源开关',
    githubSecretEnv: '登记 GitHub 签名密钥环境变量',
    githubBotLogin: '设置 GitHub bot 登录名',
    mentionAliases: '设置 @ 别名',
    feishuEnabled: '配置飞书源开关',
    feishuSecretEnv: '登记飞书签名密钥环境变量',
    feishuMention: '设置飞书 @ 别名',
    watchIntervalMinutes: '设置看护体检间隔',
    permissionMode: '写入权限档位',
};
/** 把 12 个答案转成计划：逐项校验，不合法的记进 errors 而不静默丢弃。 */
export function buildSetupPlan(answers) {
    const steps = [];
    const errors = [];
    const resolved = {};
    for (const question of SETUP_STEPS) {
        const answer = (answers[question.id] ?? '').trim() === '' ? question.defaultAnswer : answers[question.id] ?? question.defaultAnswer;
        resolved[question.id] = answer;
        const reason = question.validate(answer);
        if (reason !== null) {
            errors.push({ id: question.id, reason });
            continue;
        }
        steps.push({ id: question.id, action: ACTIONS[question.id] ?? '应用配置', value: answer });
    }
    return { steps, errors, answers: resolved };
}
/** 执行计划：逐条交给可注入的 executor；校验失败的项跳过并说明。 */
export function executeSetupPlan(plan, executor, io) {
    let applied = 0;
    for (const step of plan.steps) {
        executor.apply(step);
        io.log(`已应用 ${step.id}：${step.action} = ${step.value}`);
        applied++;
    }
    for (const error of plan.errors)
        io.log(`跳过 ${error.id}：${error.reason}`);
    return { applied, skipped: plan.errors.length, errors: plan.errors };
}
/** 完整向导：12 步问答 → 计划 → 执行。空回答用默认值。 */
export async function runSetup(io, executor) {
    const answers = {};
    for (const question of SETUP_STEPS) {
        const raw = await io.ask(question);
        answers[question.id] = raw.trim() === '' ? question.defaultAnswer : raw.trim();
    }
    const plan = buildSetupPlan(answers);
    io.log(`SETUP 计划：${plan.steps.length} 步可应用、${plan.errors.length} 步待修正`);
    return executeSetupPlan(plan, executor, io);
}
