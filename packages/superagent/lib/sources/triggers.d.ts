/**
 * 归一化事件 → 领域 Trigger，以及「值不值得建票」的判定。
 *
 * 关键策略：默认只给 addressed（点名了 agent）的事件建票。
 * 非 addressed 的旁观消息、机器人消息、空线程 / 空正文一律不建票，
 * 避免噪音把主动引擎塞满。这条是 B5 的核心准入，与领域 Policy 的 gate 分层。
 */
import type { NormalizedEvent } from '@dsh-ghost/source-hub';
import type { Trigger } from '../core/index.ts';
import type { TicketTriggerOptions } from './types.ts';
/** 一条归一化事件是否值得建票。 */
export declare function shouldOpenTicket(event: NormalizedEvent, options?: TicketTriggerOptions): boolean;
/** 把一批归一化事件转成领域 Trigger；过滤掉不建票的事件。 */
export declare function toTicketTriggers(events: readonly NormalizedEvent[], options?: TicketTriggerOptions): Trigger[];
