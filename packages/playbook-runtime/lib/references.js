/**
 * C9-12：references 分层加载。
 *
 * 对应 docs/PLAYBOOK.md §7.1 的 L3：索引常驻（只有名字 + 大小，极便宜），
 * 单文件按需读，单文件有硬上限且超限时**明确截断并给提示**，不静默丢内容。
 *
 * 纯逻辑：files 由调用方注入（内存或读盘后的内容），本模块不碰文件系统、不碰网络。
 */
const DEFAULT_MAX = 16 * 1024;
/** 按 UTF-8 字节数截断，并补一行人话提示。 */
function truncateBytes(text, maxBytes) {
    const buffer = Buffer.from(text, 'utf8');
    if (buffer.byteLength <= maxBytes)
        return { text, truncated: false };
    // 用 toString 容忍被切断的多字节字符（会产生替换符，但不抛错、绝不超预算）
    return { text: buffer.subarray(0, maxBytes).toString('utf8'), truncated: true };
}
/**
 * 构造一个分层加载器。
 * @param files - 相对路径 → 文件内容（注入，便于测试）
 * @param options - 单文件上限
 */
export function createReferences(files, options = {}) {
    const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX;
    const entries = Object.entries(files).map(([name, content]) => ({
        name,
        content,
        bytes: Buffer.byteLength(content, 'utf8'),
    }));
    const sorted = [...entries].sort((left, right) => left.name.localeCompare(right.name));
    const byName = new Map(sorted.map(entry => [entry.name, entry]));
    return {
        index() {
            return sorted.map(entry => ({ name: entry.name, bytes: entry.bytes }));
        },
        load(name) {
            const entry = byName.get(name);
            if (entry === undefined)
                return undefined;
            const cut = truncateBytes(entry.content, maxFileBytes);
            const hint = cut.truncated
                ? `文件 ${name} 共 ${entry.bytes} 字节，超过单文件上限 ${maxFileBytes} 字节，已截断；需要全文请拆分或缩小引用`
                : undefined;
            return {
                name,
                content: cut.text,
                bytes: Buffer.byteLength(cut.text, 'utf8'),
                totalBytes: entry.bytes,
                truncated: cut.truncated,
                ...(hint === undefined ? {} : { hint }),
            };
        },
    };
}
