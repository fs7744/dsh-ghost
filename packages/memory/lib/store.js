/**
 * 文件式记忆库。
 *
 * 两种形态，对应文档里的 L2 / L3：
 *  - `indexed`（项目记忆）：`MEMORY.md` 索引常驻 + `entries/<name>.md` 按需读
 *  - `block`（用户记忆）：单文件常驻块，容量有硬上限（对标 WorkBuddy 的 254 字节做法）
 *
 * 三条不变量：
 *  1. 一切皆文件：可 diff、可评审、可回滚
 *  2. 常驻部分有硬预算，超了就拒绝并提示归档，不静默截断
 *  3. 覆盖写之前留 `.bak`，且写入是原子的（tmp + rename）
 */
import { mkdir, readFile, writeFile, rename, copyFile, rm, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { gate } from './gate.js';
const INDEX_FILE = 'MEMORY.md';
const BLOCK_FILE = 'user-memory.md';
const ENTRIES_DIR = 'entries';
/**
 * 条目名必须与 gate 的 kebab-case 规则一致。
 *
 * `write` 一直走 gate，但 `read` / `remove` 曾经直接用 name 拼文件路径：
 * Remote 调用方传 `..\\..\\x` 就能读或删项目外的 `.md`（路径穿越）。
 * 名字是文件名的一部分，所以所有入口都必须在这里收口。
 */
const ENTRY_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
/** 条目名是否合法（供 Remote / UI 复用同一口径）。 */
export function isValidEntryName(name) {
    return ENTRY_NAME.test(name);
}
/** 文件式记忆库。 */
export class MemoryStore {
    #root;
    #mode;
    #budget;
    #now;
    constructor(options) {
        this.#root = options.root;
        this.#mode = options.mode;
        this.#budget = options.maxResidentBytes ?? 2048;
        this.#now = options.now ?? (() => new Date());
    }
    /** 常驻文件路径。 */
    get residentPath() {
        return join(this.#root, this.#mode === 'block' ? BLOCK_FILE : INDEX_FILE);
    }
    /** 确保目录存在。 */
    async init() {
        await mkdir(join(this.#root, ...(this.#mode === 'indexed' ? [ENTRIES_DIR] : [])), { recursive: true });
    }
    /** 常驻文本（会进系统提示的那一段）。 */
    async resident() {
        try {
            return await readFile(this.residentPath, 'utf8');
        }
        catch {
            return this.#mode === 'block' ? '# User Memory Profile\n\n## Memory Block\n' : '# 项目记忆\n\n';
        }
    }
    /** 条目清单（`block` 形态下按 `## ` 分节推导）。 */
    async list() {
        if (this.#mode === 'block') {
            const text = await this.resident();
            return text
                .split(/^## /m)
                .slice(1)
                .map(section => {
                const [title = ''] = section.split('\n');
                const name = slug(title.trim());
                return { name, title: title.trim(), updated: '' };
            })
                .filter(entry => entry.name !== '');
        }
        const names = await this.#entryNames();
        const metas = [];
        for (const name of names) {
            const meta = await this.#readMeta(name);
            if (meta !== undefined)
                metas.push(meta);
        }
        return metas.sort((left, right) => left.name.localeCompare(right.name));
    }
    /** 读一条正文（按需调用的入口）。 */
    async read(name) {
        if (!isValidEntryName(name))
            return undefined;
        if (this.#mode === 'block') {
            const text = await this.resident();
            const section = text.split(/^## /m).find(part => slug(part.split('\n')[0]?.trim() ?? '') === name);
            return section === undefined ? undefined : `## ${section}`;
        }
        try {
            const raw = await readFile(join(this.#root, ENTRIES_DIR, `${name}.md`), 'utf8');
            return stripFrontmatter(raw).body;
        }
        catch {
            return undefined;
        }
    }
    /**
     * 写入一条记忆。
     * @param write - 请求（name / title / text / source）
     */
    async write(write) {
        const verdict = gate(write);
        if (!verdict.ok)
            return { ok: false, reasons: verdict.reasons, ...(verdict.oneShot === true ? { oneShot: true } : {}) };
        await this.init();
        const stamp = this.#now().toISOString();
        if (this.#mode === 'block') {
            const current = await this.resident();
            const section = `## ${write.title ?? write.name}\n\n${write.text.trim()}\n\n<!-- 来源：${write.source} · ${stamp} -->\n`;
            const next = `${current.trimEnd()}\n\n${section}`;
            if (Buffer.byteLength(next, 'utf8') > this.#budget) {
                return { ok: false, reasons: [`常驻块已满（上限 ${this.#budget} 字节）：先归档到项目记忆，别把偏好写成日记`] };
            }
            await this.#atomic(this.residentPath, next);
            return { ok: true, path: this.residentPath };
        }
        const entryPath = join(this.#root, ENTRIES_DIR, `${write.name}.md`);
        const body = [
            '---',
            `title: ${write.title ?? write.name}`,
            `source: ${write.source}`,
            `updated: ${stamp}`,
            '---',
            '',
            write.text.trim(),
            '',
        ].join('\n');
        await this.#atomic(entryPath, body);
        await this.#writeIndex();
        return { ok: true, path: entryPath };
    }
    /** 删除一条记忆，并同步索引。 */
    async remove(name) {
        if (!isValidEntryName(name))
            return false;
        if (this.#mode === 'block') {
            const before = await this.resident();
            const sections = before.split(/^## /m);
            const kept = sections.filter((section, index) => index === 0 || slug(section.split('\n')[0]?.trim() ?? '') !== name);
            if (kept.length === sections.length)
                return false;
            await this.#atomic(this.residentPath, kept.join('## '));
            return true;
        }
        try {
            await rm(join(this.#root, ENTRIES_DIR, `${name}.md`));
        }
        catch {
            return false;
        }
        await this.#writeIndex();
        return true;
    }
    /** 重写索引：只留标题，正文按需读。 */
    async #writeIndex() {
        const metas = (await this.list()).filter(entry => entry.name !== '');
        const lines = ['# 项目记忆', '', '索引常驻；正文用 `memory read <name>` 按需读。', ''];
        for (const meta of metas)
            lines.push(`- \`${meta.name}\` — ${meta.title}`);
        const text = `${lines.join('\n')}\n`;
        if (Buffer.byteLength(text, 'utf8') > this.#budget * 8) {
            lines.splice(3, lines.length - 3);
            for (const meta of metas)
                lines.push(`- \`${meta.name}\``);
            lines.push('', `（${metas.length} 条，标题已省略以控制常驻成本）`);
        }
        await this.#atomic(this.residentPath, `${lines.join('\n')}\n`);
    }
    async #entryNames() {
        try {
            return (await readdir(join(this.#root, ENTRIES_DIR)))
                .filter(file => file.endsWith('.md'))
                .map(file => file.slice(0, -3));
        }
        catch {
            return [];
        }
    }
    async #readMeta(name) {
        try {
            const raw = await readFile(join(this.#root, ENTRIES_DIR, `${name}.md`), 'utf8');
            const { frontmatter } = splitFrontmatter(raw);
            return {
                name,
                title: frontmatter.title ?? name,
                updated: frontmatter.updated ?? '',
            };
        }
        catch {
            return undefined;
        }
    }
    /** 原子写：先写临时文件再 rename；覆盖前留 `.bak`。 */
    async #atomic(path, content) {
        await mkdir(dirname(path), { recursive: true });
        try {
            await copyFile(path, `${path}.bak`);
        }
        catch {
            // 首次写入没有旧文件，正常
        }
        const temporary = `${path}.tmp`;
        await writeFile(temporary, content, 'utf8');
        await rename(temporary, path);
    }
}
/** 标题 → kebab-case 名字。 */
function slug(title) {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 63);
}
/** 拆出 frontmatter 与正文。 */
function splitFrontmatter(raw) {
    if (!raw.startsWith('---\n'))
        return { frontmatter: {}, body: raw };
    const end = raw.indexOf('\n---\n', 4);
    if (end < 0)
        return { frontmatter: {}, body: raw };
    const head = raw.slice(4, end);
    const frontmatter = {};
    for (const line of head.split('\n')) {
        const index = line.indexOf(':');
        if (index > 0)
            frontmatter[line.slice(0, index).trim()] = line.slice(index + 1).trim();
    }
    return { frontmatter, body: raw.slice(end + 5) };
}
/** 去掉 frontmatter，只留正文。 */
function stripFrontmatter(raw) {
    return { body: splitFrontmatter(raw).body };
}
