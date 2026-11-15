/** porcelain v1 的状态字母（X=暂存区，Y=工作区）。 */
const STATUS_MAP = {
    M: 'modified',
    A: 'added',
    D: 'deleted',
    R: 'renamed',
    C: 'added',
    U: 'conflicted',
    T: 'modified',
};
/**
 * 解析 `git status --porcelain=v1` 的输出。
 * 每行格式：`XY 路径`（XY 是暂存区/工作区状态）。
 */
export function parseStatusPorcelain(stdout) {
    const out = [];
    for (const raw of stdout.split('\n')) {
        const line = raw.trimEnd();
        if (line === '')
            continue;
        const code = line.slice(0, 2);
        const rest = line.slice(3);
        if (rest === '')
            continue;
        // 重命名会写成 `old -> new`；只看新路径。
        const path = rest.includes(' -> ') ? (rest.split(' -> ')[1] ?? rest) : rest;
        const key = code.trim();
        // 任一列是 U（unmerged）即为冲突；否则看暂存区那一列。
        const status = key === '??'
            ? 'untracked'
            : key.includes('U')
                ? 'conflicted'
                : (STATUS_MAP[key.slice(0, 1)] ?? 'unknown');
        out.push({ path: path.replace(/^"|"$/g, ''), status, additions: 0, deletions: 0 });
    }
    return out;
}
/**
 * 解析 `git diff --numstat` 的输出：`新增\t删除\t路径`。
 */
export function parseNumstat(stdout) {
    const out = new Map();
    for (const line of stdout.split('\n')) {
        if (line.trim() === '')
            continue;
        const [add, del, ...rest] = line.split('\t');
        const path = rest.join('\t').replace(/^"|"$/g, '');
        if (path === '')
            continue;
        out.set(path, {
            additions: add === '-' ? 0 : Number.parseInt(add ?? '0', 10) || 0,
            deletions: del === '-' ? 0 : Number.parseInt(del ?? '0', 10) || 0,
        });
    }
    return out;
}
/**
 * 解析 unified diff（`git diff` 的默认格式）为可渲染的行。
 * 只做展示，不做语义判断。
 */
export function parseUnifiedDiff(text) {
    const out = [];
    let oldNo = 0;
    let newNo = 0;
    for (const raw of text.split('\n')) {
        if (raw.startsWith('@@')) {
            const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
            if (match !== null) {
                oldNo = Number.parseInt(match[1] ?? '0', 10);
                newNo = Number.parseInt(match[2] ?? '0', 10);
            }
            out.push({ type: 'hunk', text: raw });
            continue;
        }
        if (raw.startsWith('+++') || raw.startsWith('---') || raw.startsWith('diff ') || raw.startsWith('index ')) {
            out.push({ type: 'meta', text: raw });
            continue;
        }
        if (raw.startsWith('+')) {
            out.push({ type: 'add', text: raw.slice(1), newNo });
            newNo += 1;
            continue;
        }
        if (raw.startsWith('-')) {
            out.push({ type: 'del', text: raw.slice(1), oldNo });
            oldNo += 1;
            continue;
        }
        if (raw.startsWith('\\')) {
            out.push({ type: 'meta', text: raw });
            continue;
        }
        out.push({ type: 'ctx', text: raw.slice(1), oldNo, newNo });
        oldNo += 1;
        newNo += 1;
    }
    return out;
}
/**
 * 找出文件里的 git 冲突块。
 * 标记格式：`<<<<<<< HEAD` … `||||||| base` … `=======` … `>>>>>>> branch`。
 */
export function findConflicts(content) {
    const lines = content.split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i] ?? '';
        if (!line.startsWith('<<<<<<<')) {
            i += 1;
            continue;
        }
        const block = { base: [], ours: [], theirs: [] };
        let section = 'ours';
        i += 1;
        while (i < lines.length) {
            const current = lines[i] ?? '';
            if (current.startsWith('|||||||')) {
                section = 'base';
                i += 1;
                continue;
            }
            if (current.startsWith('=======')) {
                section = 'theirs';
                i += 1;
                continue;
            }
            if (current.startsWith('>>>>>>>')) {
                i += 1;
                break;
            }
            if (section !== null)
                block[section].push(current);
            i += 1;
        }
        out.push(block);
    }
    return out;
}
/**
 * 按选择解决冲突块：'ours'（用我方）/ 'theirs'（用对方）/ 'both'（两者都留）。
 */
export function resolveConflict(content, side) {
    const lines = content.split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i] ?? '';
        if (!line.startsWith('<<<<<<<')) {
            out.push(line);
            i += 1;
            continue;
        }
        const ours = [];
        const theirs = [];
        let section = 'ours';
        i += 1;
        while (i < lines.length) {
            const current = lines[i] ?? '';
            if (current.startsWith('|||||||')) {
                i += 1;
                continue;
            }
            if (current.startsWith('=======')) {
                section = 'theirs';
                i += 1;
                continue;
            }
            if (current.startsWith('>>>>>>>')) {
                i += 1;
                break;
            }
            if (section === 'ours')
                ours.push(current);
            else
                theirs.push(current);
            i += 1;
        }
        if (side === 'ours')
            out.push(...ours);
        else if (side === 'theirs')
            out.push(...theirs);
        else
            out.push(...ours, ...theirs);
    }
    return out.join('\n');
}
