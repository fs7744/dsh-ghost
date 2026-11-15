/**
 * 凭据引用校验（C2-03）：拒绝明文 key，只允许 env 引用名。
 *
 * 明文永不落 settings、永不进配置文件。这里只认一个环境变量名（如 WB_KEY），
 * 由宿主在启动时从进程环境读取，配置里只留引用名。
 */
/** 合法 env 引用名：大写字母开头，其余大写字母 / 数字 / 下划线。 */
export declare const ENV_REF_NAME: RegExp;
/** 是否看起来像一把明文密钥（而不是 env 名）。 */
export declare function looksLikePlaintextKey(value: string): boolean;
export interface CredentialCheck {
    ok: boolean;
    reason: string;
}
/** 校验一个凭据引用值；只允许 env 引用名，明文一律拒绝。 */
export declare function validateCredentialRef(value: unknown): CredentialCheck;
/** 从一份配置对象里挑出所有疑似明文密钥的字段名，供批量自检。 */
export declare function findPlaintextCredentials(config: Record<string, unknown>): string[];
