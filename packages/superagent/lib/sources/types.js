/**
 * 触发源层（B5）的公共类型。
 *
 * 原始投递 → 签名校验 → 适配器归一化 → 判定是否建票 → 领域 Trigger。
 * 归一化与签名复用 @dsh-ghost/source-hub / @dsh-ghost/source-github，
 * 这里只做「来源配置」与「是否值得建票」的策略，不把任何一家服务的逻辑写死。
 */
export {};
