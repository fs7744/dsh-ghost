/**
 * B7-01 服务脚本的核心：起停 / 状态 / 重启的 CLI 形态，执行器与 IO 全部可注入。
 *
 * status 的退出码直接取 runSelfCheck 的结果（0 全绿 / 1 配置缺项 / 2 安全红线），
 * 每一条检查都把「明确原因」打到日志里，不静默略过。
 * 本文件含最小 fs IO（pid 文件、仓库扫描），但 runService 本身只认接口，测试用假实现即可。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { findSelfBuiltRoutes, runSelfCheck } from './selfcheck.js';
/** 用法文本。 */
export const USAGE = [
    '用法：dsh-superagent <命令>',
    '  start    启动服务（启动前跑自检，缺项不启）',
    '  stop     停止服务',
    '  status   打印运行状态与自检明细，退出码取自检结果',
    '  restart  重启服务',
    '  setup    运行 12 步 SETUP 向导（CLI 脚本处理）',
    '  watch    跑一轮小时级看护体检（CLI 脚本处理）',
    '  help     显示本帮助',
].join('\n');
/** 解析命令行；未知命令一律落到 help。 */
export function parseArgs(argv) {
    const raw = argv[0];
    if (raw === 'start' || raw === 'stop' || raw === 'status' || raw === 'restart')
        return raw;
    return 'help';
}
/** 跑一个服务命令，返回退出码（不自己 process.exit，便于测试）。 */
export function runService(command, deps) {
    const { executor, io } = deps;
    switch (command) {
        case 'start': {
            if (executor.isRunning()) {
                io.log('服务已在运行，无需重复启动。');
                return 0;
            }
            const check = executor.selfCheck();
            if (!check.ok) {
                io.log(`启动前自检未通过：${check.summary}`);
                return check.exitCode;
            }
            executor.start();
            io.log('服务已启动。');
            return 0;
        }
        case 'stop': {
            if (!executor.isRunning()) {
                io.log('服务未在运行。');
                return 0;
            }
            executor.stop();
            io.log('服务已停止。');
            return 0;
        }
        case 'status': {
            const check = executor.selfCheck();
            io.log(`运行状态：${executor.isRunning() ? '运行中' : '已停止'}`);
            for (const item of check.checks)
                io.log(`  ${item.ok ? 'OK  ' : 'FAIL'} ${item.id}: ${item.reason}`);
            io.log(check.summary);
            return check.exitCode;
        }
        case 'restart': {
            if (executor.isRunning())
                executor.stop();
            executor.start();
            io.log('服务已重启。');
            return 0;
        }
        case 'help': {
            io.log(USAGE);
            return 0;
        }
    }
}
/** 检查 B6 提示词 / 剧本资产是否齐全（manifest 为准）。 */
export function checkAssets(root) {
    const base = join(root, 'packages', 'superagent');
    const manifestPath = join(base, 'prompts', 'manifest.json');
    if (!existsSync(manifestPath))
        return false;
    try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        for (const file of manifest.files) {
            const full = join(base, 'prompts', file.path);
            if (!existsSync(full))
                return false;
            const text = readFileSync(full, 'utf8');
            if (file.level === 'resident' && text.length >= manifest.residentMaxChars)
                return false;
            if (file.skill === true && !/^---[\s\S]*?name:[\s\S]*?description:[\s\S]*?---/.test(text))
                return false;
        }
        for (const playbook of manifest.playbooks) {
            if (!existsSync(join(base, 'playbooks', playbook)))
                return false;
        }
        return true;
    }
    catch {
        return false;
    }
}
/** 扫描仓库代码文件，返回命中自建 /orchestrator 路由的路径（跳过构建产物与依赖目录）。 */
export function scanRepositoryForRoutes(root) {
    const skipDirs = new Set(['node_modules', '.git', 'lib', 'dist', 'out', '.dsh-home', 'spikes']);
    const entries = [];
    const walk = (dir) => {
        let items;
        try {
            items = readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const item of items) {
            if (item.name.startsWith('.') && item.name !== '.ghost')
                continue;
            const full = join(dir, item.name);
            if (item.isDirectory()) {
                if (!skipDirs.has(item.name))
                    walk(full);
            }
            else if (/\.(?:[cm]?[jt]s|tsx)$/.test(item.name)) {
                try {
                    entries.push({ path: relative(root, full).replace(/\\/g, '/'), text: readFileSync(full, 'utf8') });
                }
                catch { /* 忽略读不了的文件 */ }
            }
        }
    };
    walk(root);
    return findSelfBuiltRoutes(entries);
}
/** 基于 pid 文件的默认执行器：CLI 用它，测试可换成假实现。 */
export function createFileExecutor(options = {}) {
    const root = options.root ?? process.cwd();
    const stateDir = options.stateDir ?? join(root, '.ghost', 'superagent');
    const pidFile = join(stateDir, 'service.pid');
    const env = options.env ?? process.env;
    return {
        isRunning: () => existsSync(pidFile),
        start: () => { mkdirSync(stateDir, { recursive: true }); writeFileSync(pidFile, `${process.pid}\n`); },
        stop: () => { if (existsSync(pidFile))
            rmSync(pidFile); },
        selfCheck: () => runSelfCheck({
            env,
            stateDirReady: existsSync(stateDir),
            assetsReady: checkAssets(root),
            selfBuiltRoutes: scanRepositoryForRoutes(root),
        }),
    };
}
/** 默认 IO：打到 stdout。 */
export const defaultIO = { log: message => { process.stdout.write(`${message}\n`); } };
