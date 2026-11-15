import type { SourceAuth, SourceRequest, VerifyResult } from './types.ts';
/**
 * 校验一次投递。
 * @param auth - 来源的鉴权配置；缺省或 `none` 直接放行
 * @param request - 原始投递（签名用 rawBody，不能是重新序列化的 JSON）
 * @param env - 环境变量，用于解析 secretEnv / valueEnv
 */
export declare function verifyAuth(auth: SourceAuth | undefined, request: SourceRequest, env?: NodeJS.ProcessEnv): VerifyResult;
