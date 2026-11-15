/** 可插拔信息源：注册表、签名、声明式映射、内置适配器与自定义 mapper 加载器。 */
export { createRegistry, type SourceRegistry } from './registry.ts';
export { verifyAuth } from './signature.ts';
export { getPath, render, matches, applyMapping } from './mapping.ts';
export { adapterFor, importMapper, isNormalizedEvent, githubAdapter, genericAdapter, passthroughAdapter, customAdapter } from './adapters.ts';
export type { SourceRequest, SourceSpec, SourceAuth, SourceSummary, SourceAdapter, AdapterContext, NormalizedEvent, NormalizeResult, VerifyResult, GenericMapping, EventChannel, MapperInput, MapperFunction, } from './types.ts';
