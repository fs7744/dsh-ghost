/**
 * B2-03 / B5-02：dsh-superagent/feishu-watch 触发源入口（默认关闭）。
 *
 * 完全声明式：kind=generic 的字段映射 + 通用 HMAC 签名（头名 / 算法 / 前缀 / 密钥来源可配）。
 * 不硬编码任何 token；不显式 enabled:true 就只产出清单、不注册 spec。
 */
import type { FeishuWatchOptions } from '../../sources/feishu.ts';
import type { HostContext, WatchAssembly } from './assembly.ts';
/** cordis 插件 id。 */
export declare const name = "dsh-superagent/feishu-watch";
/** 触发源入口声明的依赖。 */
export declare const inject: readonly string[];
/** 纯函数：产出飞书触发源的装配清单；默认 enabled=false。 */
export declare function createFeishuWatchAssembly(options?: FeishuWatchOptions): WatchAssembly;
/** 挂载：默认关闭，只有显式 enabled:true 才把 spec 交给注册表。 */
export declare function apply(ctx: HostContext, options?: FeishuWatchOptions): WatchAssembly;
export type { FeishuWatchOptions };
