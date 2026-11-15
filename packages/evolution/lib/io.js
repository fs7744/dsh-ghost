/**
 * 可注入的文件 IO：进化相关模块全靠它落盘，node:test 用内存实现即可跑。
 * 真实实现只负责「目录自动创建 + UTF-8 读写」，不掺任何业务逻辑。
 */
import { access, appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
/** 真实磁盘实现（默认）。 */
export function nodeFileIo() {
    return {
        async read(path) {
            return readFile(path, 'utf8');
        },
        async write(path, content) {
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, content, 'utf8');
        },
        async append(path, content) {
            await mkdir(dirname(path), { recursive: true });
            await appendFile(path, content, 'utf8');
        },
        async exists(path) {
            try {
                await access(path);
                return true;
            }
            catch {
                return false;
            }
        },
        async list(dir) {
            try {
                return await readdir(dir);
            }
            catch {
                return [];
            }
        },
    };
}
/** 构造内存 IO，可给一份初始文件表。 */
export function memoryFileIo(initial = {}) {
    const files = new Map(Object.entries(initial));
    return {
        files,
        async read(path) {
            const value = files.get(path);
            if (value === undefined)
                throw new Error(`ENOENT: ${path}`);
            return value;
        },
        async write(path, content) {
            files.set(path, content);
        },
        async append(path, content) {
            files.set(path, `${files.get(path) ?? ''}${content}`);
        },
        async exists(path) {
            return files.has(path);
        },
        async list(dir) {
            // 统一按 '/' 归一化，兼容 Windows 的 '\\' 与 POSIX 的 '/'。
            const normalizedPrefix = `${dir.replace(/[\\/]+$/, '').replace(/[\\/]+/g, '/')}/`;
            const names = new Set();
            for (const path of files.keys()) {
                const normalized = path.replace(/[\\/]+/g, '/');
                if (!normalized.startsWith(normalizedPrefix))
                    continue;
                const head = normalized.slice(normalizedPrefix.length).split('/')[0];
                if (head !== undefined && head !== '')
                    names.add(head);
            }
            return [...names];
        },
    };
}
