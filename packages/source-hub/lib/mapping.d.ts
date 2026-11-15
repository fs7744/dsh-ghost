/**
 * 声明式映射引擎：不写一行代码就能接入任意 JSON webhook。
 *
 * 模板语法：`{{a.b}}` 取 body 的嵌套字段，`{{headers.x-foo}}` 取请求头，`{{event}}` 取事件名。
 * 取不到渲染成空串；对象渲染成 JSON。字段名与路径全部由用户配置决定。
 */
import type { GenericMapping, NormalizedEvent, SourceRequest } from './types.ts';
/** 按点路径取嵌套字段。 */
export declare function getPath(value: unknown, path: string): unknown;
/** 渲染一个模板字符串。 */
export declare function render(template: string, request: SourceRequest): string;
/** 事件名过滤与 where 条件。 */
export declare function matches(mapping: GenericMapping, request: SourceRequest): boolean;
/** 按配置产出归一化事件；正文或线程键为空则不产出。 */
export declare function applyMapping(mapping: GenericMapping, request: SourceRequest, sourceId: string): NormalizedEvent[];
