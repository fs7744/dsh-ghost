/**
 * 凭据脱敏（写盘前拦、显示前洗）。
 *
 * 放在纯逻辑包里：编排插件（Node）与桌面端（浏览器）都要用，不能有 node 依赖。
 *
 * 放在纯逻辑包里：编排插件（Node）与桌面端（浏览器）都要用，不能有 node 依赖。
 *
 * 两条规则：
 *  1. **配置里不存明文密钥**：`token` / `secret` / `apiKey` 这类键只能指向环境变量
 *     （我们约定 `tokenEnv: 'GITHUB_TOKEN'`），明文值一律拒写——否则它会同时出现在
 *     磁盘、视图文本和模型上下文里。
 *  2. **显示前一律洗**：视图、审批卡、诊断文本在进模型上下文前过一遍，
 *     敏感值替换成 `***`；这同时省 token（长密钥没必要进上下文）。
 */
/** 指向环境变量的键（`*Env` / `env:` 前缀）不算明文。 */
export declare function isEnvRefKey(key: string): boolean;
/** 这个键名是否敏感。 */
export declare function isSecretKey(key: string): boolean;
/**
 * 在配置对象里找第一处「明文密钥」：敏感键 + 非空字符串值 + 不是环境变量引用。
 * @returns 形如 `accounts.github.token` 的路径；没有则 undefined
 */
export declare function findPlainSecret(value: unknown, path?: string): string | undefined;
/**
 * 洗文本里的敏感赋值：`token=xxx` / `"secret": "xxx"` → `token=***`。
 */
export declare function redactText(text: string): string;
/**
 * 脱敏后的预览：敏感键显示 `***`，其余照旧但截断。
 */
export declare function redactPreview(value: unknown, limit?: number): string;
