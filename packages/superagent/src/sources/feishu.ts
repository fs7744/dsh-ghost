/**
 * B2-03 / B5-02 飞书触发源入口（默认关闭）。
 *
 * 完全声明式：kind=generic，字段走 GenericMapping 的 {{路径}} 模板，
 * 签名走 source-hub 的通用 HMAC（头名 / 算法 / 前缀 / 密钥来源全部可配）。
 * 不硬编码任何 token；要启用必须显式 enabled: true 并配好 FEISHU_WEBHOOK_SECRET。
 */

import type { SourceSpec } from '@dsh-ghost/source-hub'
import type { WatchOptions, WatchSpec } from './types.ts'

/** 飞书触发源的可配置项。 */
export interface FeishuWatchOptions extends WatchOptions {
  /** 点名 agent 的别名，正文含它即算 addressed。 */
  mention?: string
  /** 只处理的事件名。 */
  eventName?: string
}

/** 产出一份声明式飞书 spec；默认 enabled=false，即「默认关闭」。 */
export function feishuWatchSpec(options: FeishuWatchOptions = {}): WatchSpec {
  const enabled = options.enabled ?? false
  const mention = options.mention ?? '@ghost'
  const spec: SourceSpec = {
    id: 'feishu',
    kind: 'generic',
    description: '飞书 bot 提及与群成员同步（声明式映射，默认关闭）',
    auth: {
      type: 'hmac',
      header: options.signatureHeader ?? 'x-lark-signature',
      algorithm: options.signatureAlgorithm ?? 'sha256',
      secretEnv: options.secretEnv ?? 'FEISHU_WEBHOOK_SECRET',
      ...(options.signaturePrefix === undefined ? {} : { prefix: options.signaturePrefix }),
    },
    options: { enabled, mention },
    // 示例假定上游网关已把 message.content 解析成对象；否则先用自定义 mapper 拆开。
    mapping: {
      eventHeader: 'x-lark-event',
      events: [options.eventName ?? 'im.message.receive_v1'],
      where: [{ path: 'event.message.message_type', equals: 'text' }],
      fields: {
        threadId: '{{event.message.chat_id}}#{{event.message.root_id}}',
        text: '{{event.message.content.text}}',
        actor: '{{event.sender.sender_id.open_id}}',
        human: '{{event.sender.is_human}}',
        addressed: { contains: [mention] },
        channel: {
          thread: '{{event.message.chat_id}}',
          address: {
            chat_id: '{{event.message.chat_id}}',
            message_id: '{{event.message.message_id}}',
          },
        },
      },
    },
  }
  return { spec, enabled }
}
