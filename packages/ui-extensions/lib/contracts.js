/**
 * UI 扩展契约（纯逻辑、零 IO、零 DOM）。
 *
 * 目标：让用户**不改我们的代码**就能
 *  1. 加一个新页面（页签）：放一份面板清单 JSON；
 *  2. 往已有界面里注入东西（插槽）：放一份插槽清单 JSON；
 *  3. 登记 LLM 服务：放一份 provider 规格。
 *
 * 边界（重要）：
 *  - 扩展**不能**塞任意 JS 进来跑（那等于给界面开后门）；只能声明
 *    「去哪个宿主端点取数据」与「点了调哪个端点」；
 *  - 所有声明都要过校验，非法项直接丢弃并给出原因，不静默生效。
 */
/** 允许注入的插槽。未知插槽一律忽略。 */
export const SLOT_IDS = ['chat.toolbar', 'settings.sections', 'stats.extra'];
const ID_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;
const ENDPOINT_PATTERN = /^[A-Za-z][A-Za-z0-9]*\/[A-Za-z][A-Za-z0-9]*$/;
const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
/** 校验一份面板清单；返回错误列表，空数组即合法。 */
export function validatePanelManifest(raw) {
    const errors = [];
    if (!isPlainObject(raw))
        return ['面板清单必须是对象'];
    if (typeof raw.id !== 'string' || !ID_PATTERN.test(raw.id))
        errors.push('id 必须是 kebab-case（字母开头，字母数字连字符）');
    if (typeof raw.title !== 'string' || raw.title.trim() === '')
        errors.push('title 不能为空');
    if (raw.order !== undefined && (typeof raw.order !== 'number' || !Number.isFinite(raw.order)))
        errors.push('order 必须是数字');
    if (!isPlainObject(raw.source))
        errors.push('source 必须是对象');
    else {
        if (typeof raw.source.endpoint !== 'string' || !ENDPOINT_PATTERN.test(raw.source.endpoint)) {
            errors.push('source.endpoint 必须是「命名空间/方法」形式');
        }
        if (raw.source.args !== undefined && !isPlainObject(raw.source.args))
            errors.push('source.args 必须是对象');
    }
    if (raw.columns !== undefined && (!Array.isArray(raw.columns) || raw.columns.some(item => typeof item !== 'string'))) {
        errors.push('columns 必须是字符串数组');
    }
    return errors;
}
/** 校验一条插槽贡献；返回错误列表。 */
export function validateSlotContribution(raw) {
    const errors = [];
    if (!isPlainObject(raw))
        return ['插槽清单必须是对象'];
    if (typeof raw.slot !== 'string' || !SLOT_IDS.includes(raw.slot)) {
        errors.push(`slot 必须是 ${SLOT_IDS.join(' / ')} 之一`);
    }
    if (typeof raw.label !== 'string' || raw.label.trim() === '')
        errors.push('label 不能为空');
    if (raw.endpoint !== undefined && (typeof raw.endpoint !== 'string' || !ENDPOINT_PATTERN.test(raw.endpoint))) {
        errors.push('endpoint 必须是「命名空间/方法」形式');
    }
    if (raw.args !== undefined && !isPlainObject(raw.args))
        errors.push('args 必须是对象');
    return errors;
}
/** 归一化一批面板清单：去重（同名取先到）、丢弃非法项、排序。 */
export function normalizePanels(raws) {
    const items = [];
    const errors = [];
    const seen = new Set();
    for (const raw of raws) {
        const problems = validatePanelManifest(raw);
        if (problems.length > 0) {
            const id = isPlainObject(raw) && typeof raw.id === 'string' ? raw.id : '(无 id)';
            errors.push({ id, errors: problems });
            continue;
        }
        const manifest = raw;
        if (seen.has(manifest.id))
            continue;
        seen.add(manifest.id);
        items.push({
            id: manifest.id,
            title: manifest.title,
            order: typeof manifest.order === 'number' ? manifest.order : 100,
            ...(manifest.description === undefined ? {} : { description: manifest.description }),
            source: {
                endpoint: manifest.source.endpoint,
                ...(manifest.source.args === undefined ? {} : { args: manifest.source.args }),
            },
            ...(manifest.columns === undefined ? {} : { columns: manifest.columns }),
        });
    }
    items.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    return { items, errors };
}
/** 归一化一批插槽贡献：丢弃非法项与未知插槽。 */
export function normalizeSlots(raws) {
    const items = [];
    const errors = [];
    for (const raw of raws) {
        const problems = validateSlotContribution(raw);
        if (problems.length > 0) {
            const label = isPlainObject(raw) && typeof raw.label === 'string' ? raw.label : '(无 label)';
            errors.push({ id: label, errors: problems });
            continue;
        }
        const slot = raw;
        items.push({
            slot: slot.slot,
            label: slot.label,
            ...(slot.description === undefined ? {} : { description: slot.description }),
            ...(slot.endpoint === undefined ? {} : { endpoint: slot.endpoint }),
            ...(slot.args === undefined ? {} : { args: slot.args }),
        });
    }
    return { items, errors };
}
/**
 * 把端点返回值归一化成行：数组元素是对象时按 columns 取字段；
 * 字符串直接当主标题；取不到列就用 name/detail 兜底。
 */
export function panelRows(value, columns) {
    const list = Array.isArray(value)
        ? value
        : isPlainObject(value) && Array.isArray(value.items)
            ? value.items
            : isPlainObject(value) && Array.isArray(value.rows)
                ? value.rows
                : [];
    const out = [];
    for (const item of list) {
        if (typeof item === 'string') {
            out.push({ name: item, detail: '', cells: [] });
            continue;
        }
        if (!isPlainObject(item))
            continue;
        const cells = (columns ?? []).map(column => {
            const raw = item[column];
            if (raw === undefined || raw === null)
                return '-';
            return typeof raw === 'string' ? raw : String(JSON.stringify(raw));
        });
        const name = typeof item.name === 'string' ? item.name
            : typeof item.title === 'string' ? item.title
                : typeof item.id === 'string' ? item.id
                    : cells[0] ?? '-';
        const detail = typeof item.description === 'string' ? item.description
            : typeof item.detail === 'string' ? item.detail
                : cells.slice(1).filter(cell => cell !== '-').join(' · ');
        out.push({ name, detail, cells });
    }
    return out;
}
