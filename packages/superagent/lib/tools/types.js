/**
 * 会话工具层的公共类型。
 *
 * 这一层是「描述符 + 处理器」的注册表：描述符给模型看（说明书 + 参数 schema），
 * 处理器只依赖可注入的领域端口（Repositories / Engine / ConfigStore / ViewReader）。
 * 不 import 任何 harness 包、不碰 DOM、不碰 contracts.ts，也不改 harness 的工具注册。
 */
export {};
