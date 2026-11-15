/** 通用签名校验：头名、算法、前缀、密钥来源都可配，不绑定某一家服务。 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { SourceAuth, SourceRequest, VerifyResult } from './types.ts'

/** 常量时间比较两个字符串，长度不同直接判失败（timingSafeEqual 要求等长）。 */
function equal(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8')
  const b = Buffer.from(right, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * 校验一次投递。
 * @param auth - 来源的鉴权配置；缺省或 `none` 直接放行
 * @param request - 原始投递（签名用 rawBody，不能是重新序列化的 JSON）
 * @param env - 环境变量，用于解析 secretEnv / valueEnv
 */
export function verifyAuth(auth: SourceAuth | undefined, request: SourceRequest, env: NodeJS.ProcessEnv = process.env): VerifyResult {
  if (auth === undefined || auth.type === 'none') return { ok: true }
  const header = auth.header.toLowerCase()

  if (auth.type === 'token') {
    const expected = auth.value ?? (auth.valueEnv === undefined ? undefined : env[auth.valueEnv])
    if (expected === undefined || expected === '') return { ok: false, reason: 'token-not-configured' }
    const given = request.headers[header]
    if (given === undefined) return { ok: false, reason: 'missing-token' }
    return equal(given, expected) ? { ok: true } : { ok: false, reason: 'token-mismatch' }
  }

  const secret = auth.secret ?? (auth.secretEnv === undefined ? undefined : env[auth.secretEnv])
  if (secret === undefined || secret === '') return { ok: false, reason: 'secret-not-configured' }
  const given = request.headers[header]
  if (given === undefined) return { ok: false, reason: 'missing-signature' }
  const value = auth.prefix !== undefined && given.startsWith(auth.prefix) ? given.slice(auth.prefix.length) : given
  const expected = createHmac(auth.algorithm ?? 'sha256', secret).update(request.rawBody, 'utf8').digest('hex')
  return equal(value, expected) ? { ok: true } : { ok: false, reason: 'digest-mismatch' }
}
