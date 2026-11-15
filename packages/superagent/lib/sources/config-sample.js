/**
 * 可直接用的触发源配置样例（B5 / B2-02 / B2-03）。
 *
 * 结构化 spec 由 githubWatchSpec / feishuWatchSpec 生成，
 * YAML 文本是同一份配置的 cordis.patch.yml 形态，写到 examples/sources.patch.yml。
 */
import { githubWatchSpec } from './github.js';
import { feishuWatchSpec } from './feishu.js';
/** 结构化样例：GitHub 默认启用，飞书默认关闭。 */
export function sampleWatchSpecs() {
    const github = githubWatchSpec({ botLogin: 'dsh-ghost', mentionAliases: ['ghost'] });
    const feishu = feishuWatchSpec({ mention: '@ghost' });
    return {
        specs: [github.spec, feishu.spec],
        enabled: { github: github.enabled, feishu: feishu.enabled },
    };
}
/** 可直接贴进 cordis.patch.yml 的 sources 段；密钥一律走 *Env，不写明文。 */
export const SAMPLE_PATCH_YAML = `# dsh-superagent 触发源配置样例（B5 / B2-02 / B2-03）
# 密钥一律走 *Env 指向环境变量，配置里不出现任何明文 token。
# 飞书源默认关闭：把 options.enabled 改成 true 并配好 FEISHU_WEBHOOK_SECRET 后才启用。
sources:
  - id: github
    kind: github
    description: 'GitHub webhook（内置适配器，@ 提及才建票）'
    auth:
      type: hmac
      header: x-hub-signature-256
      prefix: 'sha256='
      algorithm: sha256
      secretEnv: GH_WEBHOOK_SECRET
    options:
      botLogin: dsh-ghost
      mentionAliases: [ghost]
      enabled: true

  - id: feishu
    kind: generic
    description: '飞书 bot 提及与群成员同步（声明式映射，默认关闭）'
    auth:
      type: hmac
      header: x-lark-signature
      algorithm: sha256
      secretEnv: FEISHU_WEBHOOK_SECRET
    options:
      enabled: false
      mention: '@ghost'
    mapping:
      eventHeader: x-lark-event
      events: [im.message.receive_v1]
      where:
        - path: event.message.message_type
          equals: text
      fields:
        threadId: '{{event.message.chat_id}}#{{event.message.root_id}}'
        text: '{{event.message.content.text}}'
        actor: '{{event.sender.sender_id.open_id}}'
        human: '{{event.sender.is_human}}'
        addressed:
          contains: ['@ghost']
        channel:
          thread: '{{event.message.chat_id}}'
          address:
            chat_id: '{{event.message.chat_id}}'
            message_id: '{{event.message.message_id}}'
`;
