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
export declare const SLOT_IDS: readonly ['chat.toolbar', 'settings.sections', 'stats.extra'];
export type SlotId = typeof SLOT_IDS[number];
/** 面板的数据来源：宿主 Remote 端点。 */
export interface PanelSource {
    /** 形如 `myPlugin/rows` 的端点名。 */
    endpoint: string;
    /** 调用参数（纯 JSON）。 */
    args?: Record<string, unknown>;
}
/** 一个可渲染的面板。 */
export interface PanelManifest {
    /** 唯一 id，kebab-case。 */
    id: string;
    /** 页签标题。 */
    title: string;
    /** 排序，小的靠前；默认 100。 */
    order: number;
    /** 一句话说明，显示在页签下方。 */
    description?: string;
    /** 数据来源。 */
    source: PanelSource;
    /** 行里显示哪些字段；缺省用 name/detail。 */
    columns?: string[];
}
/** 往已有界面注入的一条内容。 */
export interface SlotContribution {
    /** 目标插槽。 */
    slot: SlotId;
    /** 显示文本。 */
    label: string;
    /** 说明文字。 */
    description?: string;
    /** 点击时调用的端点（可空：纯展示）。 */
    endpoint?: string;
    /** 调用参数（纯 JSON）。 */
    args?: Record<string, unknown>;
}
/** 校验一份面板清单；返回错误列表，空数组即合法。 */
export declare function validatePanelManifest(raw: unknown): string[];
/** 校验一条插槽贡献；返回错误列表。 */
export declare function validateSlotContribution(raw: unknown): string[];
export interface NormalizedResult<T> {
    /** 合法的条目（去重、按 order 排序）。 */
    items: T[];
    /** 被丢弃的条目与原因。 */
    errors: Array<{
        id: string;
        errors: string[];
    }>;
}
/** 归一化一批面板清单：去重（同名取先到）、丢弃非法项、排序。 */
export declare function normalizePanels(raws: readonly unknown[]): NormalizedResult<PanelManifest>;
/** 归一化一批插槽贡献：丢弃非法项与未知插槽。 */
export declare function normalizeSlots(raws: readonly unknown[]): NormalizedResult<SlotContribution>;
/** 面板里的一行。 */
export interface PanelRow {
    /** 主标题。 */
    name: string;
    /** 次要说明。 */
    detail: string;
    /** 其余字段（按 columns 顺序）。 */
    cells: string[];
}
/**
 * 把端点返回值归一化成行：数组元素是对象时按 columns 取字段；
 * 字符串直接当主标题；取不到列就用 name/detail 兜底。
 */
export declare function panelRows(value: unknown, columns?: readonly string[]): PanelRow[];
