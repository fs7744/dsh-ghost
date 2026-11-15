/**
 * C11-07：`/init` 等价物 —— 扫描仓库生成 `GHOST.md` 草案（项目记忆种子）。
 *
 * 两条硬约束：
 *  1. **不能覆盖已存在的 GHOST.md**：已存在时只给草案、不写文件；
 *  2. 草案必须**标出来源与不确定项**：每条结论标来源，缺失的信息列成待确认清单，
 *     绝不把猜测写成事实。
 *
 * `draftGhostMd` 是纯函数（输入扫描结果、输出草案）；`scanRepo` / `writeGhostDraft`
 * 用到文件能力，可注入。
 */
import { join } from 'node:path';
import { nodeFileIo } from './io.js';
const CANDIDATES = [
    'package.json', 'README.md', 'README', 'AGENTS.md', 'CLAUDE.md', 'GHOST.md',
    'Makefile', 'tsconfig.json', 'pyproject.toml', 'Cargo.toml', 'go.mod',
];
/** 容错解析 JSON。 */
function parseJson(raw) {
    if (raw === undefined)
        return undefined;
    try {
        const value = JSON.parse(raw);
        return typeof value === 'object' && value !== null && !Array.isArray(value)
            ? value
            : undefined;
    }
    catch {
        return undefined;
    }
}
/** 取 README 前面一小段作为「项目做什么」的线索。 */
function leadParagraph(raw) {
    if (raw === undefined)
        return undefined;
    const text = raw.replace(/\r/g, '').split(/\n/);
    const first = text.find(line => line.trim() !== '' && !line.trim().startsWith('#'));
    return first?.trim().slice(0, 200);
}
/** 扫描仓库（文件能力可注入）。 */
export async function scanRepo(root, io = nodeFileIo()) {
    const files = {};
    for (const name of CANDIDATES) {
        const path = join(root, name);
        if (!(await io.exists(path)))
            continue;
        try {
            files[name] = (await io.read(path)).slice(0, 20_000);
        }
        catch {
            // 单个文件读不了不影响整体
        }
    }
    const dirs = (await io.list(root)).filter(name => !name.includes('.'));
    const ghostExists = await io.exists(join(root, 'GHOST.md'));
    return { files, dirs, ghostExists };
}
/**
 * 由扫描结果生成 GHOST.md 草案（纯函数）。
 * 每条结论标 `[来源: xxx]`，缺失信息进「待确认」。
 */
export function draftGhostMd(scan) {
    const sources = [];
    const uncertainties = [];
    const lines = [
        '# GHOST.md（草案）',
        '',
        '> 本文件由 /init 扫描仓库生成，是项目记忆种子；请人工确认后再纳入版本库。',
    ];
    if (scan.ghostExists) {
        lines.push('> 注意：仓库已存在 GHOST.md，本草案**不会覆盖**它，仅供比对参考。');
    }
    lines.push('');
    const pkg = parseJson(scan.files['package.json']);
    lines.push('## 项目', '');
    if (pkg !== undefined) {
        sources.push('package.json');
        const name = typeof pkg.name === 'string' ? pkg.name : '（未标注，需确认）';
        lines.push(`- 名称：${name}  [来源: package.json]`);
        if (typeof pkg.description === 'string')
            lines.push(`- 简介：${pkg.description}  [来源: package.json]`);
        const workspaces = Array.isArray(pkg.workspaces) ? pkg.workspaces.length : undefined;
        if (workspaces !== undefined)
            lines.push(`- 工作区：${workspaces} 个  [来源: package.json]`);
        const scripts = typeof pkg.scripts === 'object' && pkg.scripts !== null
            ? pkg.scripts
            : undefined;
        const keys = ['build', 'test', 'typecheck', 'lint', 'dev'];
        const commands = keys
            .filter(key => typeof scripts?.[key] === 'string')
            .map(key => `- \`${key}\`：\`${String(scripts?.[key])}\`  [来源: package.json]`);
        lines.push('', '## 常用命令', '');
        if (commands.length > 0)
            lines.push(...commands);
        else {
            lines.push('- （未检测到 build/test/typecheck 等标准脚本）');
            uncertainties.push('package.json 里没有标准构建/测试命令，需人工补充');
        }
    }
    else {
        lines.push('- （未找到可用的 package.json）');
        uncertainties.push('未找到 package.json，项目名称与命令无法确认');
    }
    const readmeName = scan.files['README.md'] !== undefined
        ? 'README.md'
        : scan.files['README'] !== undefined ? 'README' : undefined;
    const readme = readmeName === undefined ? undefined : scan.files[readmeName];
    const lead = leadParagraph(readme);
    lines.push('', '## 目标', '');
    if (readmeName !== undefined && lead !== undefined) {
        sources.push(readmeName);
        lines.push(`- ${lead}  [来源: ${readmeName}]`);
    }
    else {
        lines.push('- （未从 README 提取到摘要）');
        uncertainties.push('未找到 README 或 README 无可用首段，项目目标需人工补充');
    }
    const agreementFiles = ['AGENTS.md', 'CLAUDE.md', 'GHOST.md'];
    const foundAgreements = agreementFiles.filter(name => scan.files[name] !== undefined);
    if (foundAgreements.length > 0) {
        sources.push(...foundAgreements);
        lines.push('', '## 已有约定文件', '');
        for (const name of foundAgreements)
            lines.push(`- ${name}（请人工确认其中的约定是否仍适用）  [来源: ${name}]`);
        uncertainties.push('已有约定文件的内容未自动并入，需人工判断哪些要保留');
    }
    if (scan.dirs.length > 0) {
        sources.push('目录结构');
        lines.push('', '## 目录结构', '');
        lines.push(`- 一级目录：${scan.dirs.slice(0, 20).join(', ')}  [来源: 目录扫描]`);
    }
    lines.push('', '## 待确认', '');
    if (uncertainties.length === 0)
        lines.push('- 无');
    else
        for (const item of uncertainties)
            lines.push(`- [ ] ${item}`);
    lines.push('', '## 来源', '');
    for (const source of [...new Set(sources)])
        lines.push(`- ${source}`);
    return {
        content: `${lines.join('\n')}\n`,
        sources: [...new Set(sources)],
        uncertainties,
        wouldWrite: !scan.ghostExists,
    };
}
/**
 * 生成并（在 GHOST.md 不存在时）写入草案。
 * 已存在时 `created: false` 且**不覆盖**。
 */
export async function writeGhostDraft(root, io = nodeFileIo()) {
    const scan = await scanRepo(root, io);
    const draft = draftGhostMd(scan);
    const target = join(root, 'GHOST.md');
    const base = { sources: draft.sources, uncertainties: draft.uncertainties };
    if (scan.ghostExists || !draft.wouldWrite)
        return { created: false, ...base };
    await io.write(target, draft.content);
    return { created: true, path: target, ...base };
}
