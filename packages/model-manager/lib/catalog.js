import { PROVIDER_APIS, validateCapabilities } from './core.js';
import { validateCredentialRef } from './credentials.js';
import { defaultModelForRole, validateRoleBindings } from './roles.js';
/** 校验一条 provider 配置；返回错误列表，空数组即合法。 */
export function validateProviderSpec(spec) {
    const errors = [];
    if (typeof spec?.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(spec.id))
        errors.push('id 必须是 kebab-case');
    if (typeof spec?.displayName !== 'string' || spec.displayName === '')
        errors.push('displayName 不能为空');
    if (typeof spec?.api !== 'string' || !PROVIDER_APIS.some(api => api === spec.api))
        errors.push('api 必须是 4 种线协议之一');
    const cred = validateCredentialRef(spec?.apiKeyEnv);
    if (!cred.ok)
        errors.push(`apiKeyEnv: ${cred.reason}`);
    if (spec?.baseURL !== undefined && !/^https?:\/\/[^\s]+$/.test(spec.baseURL))
        errors.push('baseURL 必须是 http(s) 地址');
    if (!Array.isArray(spec?.models) || spec.models.length === 0)
        errors.push('models 不能为空');
    else {
        for (const model of spec.models) {
            if (typeof model?.id !== 'string' || model.id === '')
                errors.push('模型 id 不能为空');
            for (const problem of validateCapabilities(model?.capabilities))
                errors.push(`${model?.id ?? '?'}: ${problem}`);
        }
    }
    return errors;
}
/** 用给定 store 建一个目录；store 是唯一 I/O 口，测试可完全替换。 */
export function createCatalog(store) {
    const read = async () => await store.read();
    const write = async (state) => {
        await store.write(state);
        return state;
    };
    return {
        list: () => read(),
        addProvider: async (spec) => {
            const problems = validateProviderSpec(spec);
            if (problems.length > 0)
                throw new Error(`provider 不合法: ${problems.join('; ')}`);
            const state = await read();
            if (state.providers.some(item => item.id === spec.id))
                throw new Error(`provider 已存在: ${spec.id}`);
            return write({ ...state, providers: [...state.providers, spec] });
        },
        removeProvider: async (id) => {
            const state = await read();
            return write({
                providers: state.providers.filter(item => item.id !== id),
                bindings: state.bindings.filter(item => item.providerId !== id),
            });
        },
        bindRole: async (binding) => {
            const state = await read();
            const problems = validateRoleBindings([binding], state.providers);
            if (problems.length > 0)
                throw new Error(`角色绑定不合法: ${problems.join('; ')}`);
            return write({ ...state, bindings: [...state.bindings.filter(item => item.role !== binding.role), binding] });
        },
        listModels: async () => {
            const state = await read();
            return state.providers.flatMap(provider => provider.models.map(model => ({ providerId: provider.id, model })));
        },
        resolve: async (role) => defaultModelForRole(role, await read()),
    };
}
