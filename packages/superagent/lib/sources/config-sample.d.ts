/**
 * 可直接用的触发源配置样例（B5 / B2-02 / B2-03）。
 *
 * 结构化 spec 由 githubWatchSpec / feishuWatchSpec 生成，
 * YAML 文本是同一份配置的 cordis.patch.yml 形态，写到 examples/sources.patch.yml。
 */
import type { SourceSpec } from '@dsh-ghost/source-hub';
/** 结构化样例：GitHub 默认启用，飞书默认关闭。 */
export declare function sampleWatchSpecs(): {
    specs: SourceSpec[];
    enabled: Record<string, boolean>;
};
/** 可直接贴进 cordis.patch.yml 的 sources 段；密钥一律走 *Env，不写明文。 */
export declare const SAMPLE_PATCH_YAML = "# dsh-superagent \u89E6\u53D1\u6E90\u914D\u7F6E\u6837\u4F8B\uFF08B5 / B2-02 / B2-03\uFF09\n# \u5BC6\u94A5\u4E00\u5F8B\u8D70 *Env \u6307\u5411\u73AF\u5883\u53D8\u91CF\uFF0C\u914D\u7F6E\u91CC\u4E0D\u51FA\u73B0\u4EFB\u4F55\u660E\u6587 token\u3002\n# \u98DE\u4E66\u6E90\u9ED8\u8BA4\u5173\u95ED\uFF1A\u628A options.enabled \u6539\u6210 true \u5E76\u914D\u597D FEISHU_WEBHOOK_SECRET \u540E\u624D\u542F\u7528\u3002\nsources:\n  - id: github\n    kind: github\n    description: 'GitHub webhook\uFF08\u5185\u7F6E\u9002\u914D\u5668\uFF0C@ \u63D0\u53CA\u624D\u5EFA\u7968\uFF09'\n    auth:\n      type: hmac\n      header: x-hub-signature-256\n      prefix: 'sha256='\n      algorithm: sha256\n      secretEnv: GH_WEBHOOK_SECRET\n    options:\n      botLogin: dsh-ghost\n      mentionAliases: [ghost]\n      enabled: true\n\n  - id: feishu\n    kind: generic\n    description: '\u98DE\u4E66 bot \u63D0\u53CA\u4E0E\u7FA4\u6210\u5458\u540C\u6B65\uFF08\u58F0\u660E\u5F0F\u6620\u5C04\uFF0C\u9ED8\u8BA4\u5173\u95ED\uFF09'\n    auth:\n      type: hmac\n      header: x-lark-signature\n      algorithm: sha256\n      secretEnv: FEISHU_WEBHOOK_SECRET\n    options:\n      enabled: false\n      mention: '@ghost'\n    mapping:\n      eventHeader: x-lark-event\n      events: [im.message.receive_v1]\n      where:\n        - path: event.message.message_type\n          equals: text\n      fields:\n        threadId: '{{event.message.chat_id}}#{{event.message.root_id}}'\n        text: '{{event.message.content.text}}'\n        actor: '{{event.sender.sender_id.open_id}}'\n        human: '{{event.sender.is_human}}'\n        addressed:\n          contains: ['@ghost']\n        channel:\n          thread: '{{event.message.chat_id}}'\n          address:\n            chat_id: '{{event.message.chat_id}}'\n            message_id: '{{event.message.message_id}}'\n";
