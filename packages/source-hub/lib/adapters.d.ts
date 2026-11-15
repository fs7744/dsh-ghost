import type { MapperFunction, NormalizedEvent, SourceAdapter, SourceSpec } from './types.ts';
/** 用户 mapper 文件的加载器；路径可以是绝对路径或 file: URL。 */
export declare function importMapper(path: string): Promise<MapperFunction>;
/** 运行时形状校验：外部数据一律不信任。 */
export declare function isNormalizedEvent(value: unknown): value is NormalizedEvent;
/** GitHub webhook：issue / PR / 评论 / review。 */
export declare const githubAdapter: SourceAdapter;
/** 任意 JSON webhook：完全由配置决定字段从哪来。 */
export declare const genericAdapter: SourceAdapter;
/** 已经归一化的事件数组（脚本 / IM 网关 / 内部调用）。 */
export declare const passthroughAdapter: SourceAdapter;
/** 用户自己写的 mapper，输入原始材料，输出归一化事件。 */
export declare const customAdapter: SourceAdapter;
/** 按 kind 选适配器。 */
export declare function adapterFor(kind: SourceSpec['kind']): SourceAdapter;
