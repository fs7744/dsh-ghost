/**
 * C9-10：脚本运行时 —— 执行编译出的 `scripts/*`，带四道约束与一道安全闸门。
 *
 * 约束：超时、并发上限、幂等键、工作目录。
 * 安全：
 *  - 只允许白名单命令（默认只有 `node`）与白名单扩展名（.mjs/.js/.cjs）；
 *  - **禁止 shell 拼接**：命令名与参数分开传数组给 `execFile`，绝不拼成字符串；
 *  - 脚本路径必须落在包内（resolve 后仍在 packageRoot 下），拒绝 `..` 逃逸；
 *  - 输出有字节上限，超限截断并给提示。
 *
 * 默认不真的跑危险命令：runner 可注入；默认实现只跑包内的 node 脚本。
 * 测试与验收一律注入假 runner，不启动任何真实子进程。
 */
import { execFile } from 'node:child_process';
import { extname, isAbsolute, resolve, sep } from 'node:path';
import { CODES, coerceOutput, helpLine, isHelp, parseOutput, } from './protocol.js';
const DEFAULT_COMMANDS = ['node'];
const DEFAULT_EXTENSIONS = ['.mjs', '.js', '.cjs'];
const SHELL_META = /[;&|`$(){}<>\\\s]/;
/**
 * 默认 runner：只跑 `node <包内脚本> [参数...]`，用 execFile 且参数分开传。
 * 不启用 shell；abort 信号或超时会杀掉子进程。
 */
export const nodeRunner = (command) => new Promise(resolve => {
    execFile(command.command, command.args, {
        cwd: command.cwd,
        timeout: command.timeoutMs,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        windowsHide: true,
        ...(command.signal === undefined ? {} : { signal: command.signal }),
    }, (error, stdout, stderr) => {
        const timedOut = error !== null && (error.killed === true || error.code === 'ETIMEDOUT');
        const exitCode = timedOut ? 124 : error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
        resolve({
            stdout: stdout ?? '',
            stderr: stderr ?? '',
            exitCode,
            timedOut,
        });
    });
});
function validate(request, options, scriptPath, command, args) {
    const root = resolve(options.packageRoot);
    if (request.script.trim() === '' || isAbsolute(request.script) || request.script.includes('\0')) {
        return { code: CODES.EPATH, fix: '脚本路径必须是包内相对路径，不能是绝对路径或含空字符' };
    }
    const resolved = resolve(root, request.script);
    if (resolved !== root && !resolved.startsWith(root + sep)) {
        return { code: CODES.EPATH, fix: `脚本路径越出包目录：${request.script}` };
    }
    const allowedExtensions = options.allowedExtensions ?? DEFAULT_EXTENSIONS;
    if (!allowedExtensions.includes(extname(scriptPath).toLowerCase())) {
        return { code: CODES.EEXT, fix: `只允许这些扩展名：${allowedExtensions.join(', ')}` };
    }
    const allowedCommands = options.allowedCommands ?? DEFAULT_COMMANDS;
    if (!allowedCommands.includes(command)) {
        return { code: CODES.ECMD, fix: `命令不在白名单：${command}（允许 ${allowedCommands.join(', ')}）` };
    }
    if (SHELL_META.test(command) || args.some(arg => arg.includes('\0') || /[\r\n]/.test(arg))) {
        return { code: CODES.ESHELL, fix: '禁止 shell 元字符与换行：命令与参数分开传数组，绝不拼接字符串' };
    }
    return undefined;
}
/** 按 UTF-8 字节数截断输出，并给出是否截断。 */
function truncate(text, maxBytes) {
    const buffer = Buffer.from(text, 'utf8');
    if (buffer.byteLength <= maxBytes)
        return { text, truncated: false };
    return { text: buffer.subarray(0, maxBytes).toString('utf8'), truncated: true };
}
/** 拼一个失败结果，可选字段用条件展开（exactOptionalPropertyTypes）。 */
function failOutcome(code, fix, durationMs, timedOut, hint) {
    return {
        ok: false,
        code,
        fix,
        durationMs,
        idempotentHit: false,
        timedOut,
        ...(hint === undefined ? {} : { hint }),
    };
}
/** 把协议输出 + runner 原始结果合并成最终 RunOutcome。 */
function toOutcome(protocol, result, output, truncated, maxOutputBytes, durationMs) {
    const ok = protocol.ok && !result.timedOut && result.exitCode === 0;
    // 协议说成功但进程非零退出，也要如实报 EEXEC，不能让 code 撒谎。
    const code = result.timedOut
        ? CODES.ETIMEDOUT
        : result.exitCode !== 0 && protocol.ok ? CODES.EEXEC : protocol.code;
    let hint = protocol.hint;
    if (truncated) {
        const note = `输出超过 ${maxOutputBytes} 字节已截断`;
        hint = hint === undefined ? note : `${hint}；${note}`;
    }
    return {
        ok,
        code,
        ...(protocol.fix === undefined ? {} : { fix: protocol.fix }),
        ...(hint === undefined ? {} : { hint }),
        output,
        durationMs,
        idempotentHit: false,
        timedOut: result.timedOut,
    };
}
/** 请求的指纹，用于幂等键防误用。 */
function fingerprint(request, scriptPath, cwd, timeoutMs) {
    return JSON.stringify([scriptPath, request.args ?? [], cwd, timeoutMs]);
}
/**
 * 构造一个带并发/幂等状态的运行时。
 * @param options - 包根、白名单、上限、可注入 runner
 */
export function createRuntime(options) {
    const command = 'node';
    const runner = options.runner ?? nodeRunner;
    const defaultTimeoutMs = options.defaultTimeoutMs ?? 5_000;
    const maxConcurrency = Math.max(1, options.maxConcurrency ?? 2);
    const maxOutputBytes = options.maxOutputBytes ?? 8_192;
    const now = options.now ?? (() => Date.now());
    const cache = new Map();
    // 简易信号量：active 是当前占用数，waiters 是排队者；释放时把槽位直接转交下一个。
    let active = 0;
    const waiters = [];
    const acquire = () => new Promise(done => {
        if (active < maxConcurrency) {
            active += 1;
            done();
        }
        else {
            waiters.push(done);
        }
    });
    const release = () => {
        const next = waiters.shift();
        if (next === undefined)
            active -= 1;
        else
            next();
    };
    return {
        async run(request) {
            const args = request.args ?? [];
            const cwd = resolve(request.cwd ?? options.packageRoot);
            const timeoutMs = request.timeoutMs ?? defaultTimeoutMs;
            const scriptPath = resolve(options.packageRoot, request.script);
            // `--help`：只回一行摘要，不启动任何进程。
            if (isHelp(args)) {
                return {
                    ok: true,
                    code: CODES.HELP,
                    output: helpLine(scriptPath.split(/[\\/]/).at(-1) ?? request.script, '脚本用途摘要（--help 只输出本行；详细用法见 references/）'),
                    durationMs: 0,
                    idempotentHit: false,
                    timedOut: false,
                };
            }
            const rejection = validate(request, options, scriptPath, command, args);
            if (rejection !== undefined)
                return failOutcome(rejection.code, rejection.fix, 0, false);
            const key = request.idempotencyKey;
            const fp = fingerprint(request, scriptPath, cwd, timeoutMs);
            if (key !== undefined && cache.has(key)) {
                const hit = cache.get(key);
                if (hit.fingerprint !== fp) {
                    return failOutcome(CODES.EIDEMPOTENT, '同一个幂等键对应了不同的请求参数：换个键或保持一致', 0, false);
                }
                return { ...hit.outcome, idempotentHit: true };
            }
            await acquire();
            let outcome;
            try {
                const started = now();
                const controller = new AbortController();
                const timeoutPromise = new Promise(done => {
                    controller.signal.addEventListener('abort', () => done({ kind: 'timeout' }), { once: true });
                });
                const timer = setTimeout(() => controller.abort(), timeoutMs);
                let result;
                let errorText;
                let timedOutByClock = false;
                try {
                    const winner = await Promise.race([
                        Promise.resolve(runner({
                            command,
                            args: [scriptPath, ...args],
                            cwd,
                            timeoutMs,
                            signal: controller.signal,
                        })).then(value => ({ kind: 'result', value })),
                        timeoutPromise,
                    ]);
                    if (winner.kind === 'result')
                        result = winner.value;
                    else
                        timedOutByClock = true;
                }
                catch (error) {
                    errorText = String(error);
                }
                finally {
                    clearTimeout(timer);
                }
                const durationMs = Math.max(0, now() - started);
                if (timedOutByClock) {
                    outcome = failOutcome(CODES.ETIMEDOUT, `脚本超过 ${timeoutMs}ms 仍未结束`, durationMs, true);
                }
                else if (errorText !== undefined || result === undefined) {
                    outcome = failOutcome(CODES.EEXEC, `脚本执行失败：${errorText ?? 'runner 未返回结果'}`, durationMs, false);
                }
                else {
                    const cut = truncate(result.stdout, maxOutputBytes);
                    const protocol = parseOutput(cut.text) ?? coerceOutput(cut.text === '' ? result.stderr : cut.text);
                    outcome = toOutcome(protocol, result, cut.text, cut.truncated, maxOutputBytes, durationMs);
                }
            }
            finally {
                release();
            }
            if (key !== undefined)
                cache.set(key, { fingerprint: fp, outcome });
            return outcome;
        },
    };
}
/** 便捷封装：单次执行（并发/幂等状态只在这一次调用内有效）。 */
export function runScript(request, options) {
    return createRuntime(options).run(request);
}
