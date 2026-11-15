/** 会话工具层入口：19 个描述符、调用入口与可注入依赖的默认实现。 */
export { TOOL_DESCRIPTORS, TOOL_NAMES, getTool, invokeTool } from './registry.js';
export { SettingsStore, StaticViewReader, DEFAULT_PROMPT_PARTS, PROMPT_CHAR_LIMIT } from './context.js';
