/** 可插拔信息源：注册表、签名、声明式映射、内置适配器与自定义 mapper 加载器。 */
export { createRegistry } from './registry.js';
export { verifyAuth } from './signature.js';
export { getPath, render, matches, applyMapping } from './mapping.js';
export { adapterFor, importMapper, isNormalizedEvent, githubAdapter, genericAdapter, passthroughAdapter, customAdapter } from './adapters.js';
export { pullFromApi, resolveHeaderValue } from './pull.js';
