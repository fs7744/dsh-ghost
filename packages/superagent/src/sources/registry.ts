/**
 * 归一化入口：把一次原始投递交给 source-hub 的注册表。
 *
 * 注册表内部固定顺序：verifyAuth（通用签名）→ adapterFor(kind).normalize。
 * 所以 GitHub 走内置 github 适配器、飞书走声明式 generic 适配器，
 * 本文件一行都不写死某家服务的字段映射。
 */

import { createRegistry, importMapper, verifyAuth } from '@dsh-ghost/source-hub'
import type { NormalizeResult, SourceRequest, SourceSpec, VerifyResult } from '@dsh-ghost/source-hub'
import type { NormalizeInput } from './types.ts'

/** 从若干 spec 构建一个注册表（custom mapper 的加载器直接复用 source-hub 的实现）。 */
export function buildRegistry(specs: readonly SourceSpec[]): ReturnType<typeof createRegistry> {
  return createRegistry([...specs], { importMapper })
}

/** 把外部输入补齐成 SourceRequest；rawBody 省略时用 JSON.stringify 兜底（仅适合不校验签名的来源）。 */
export function toRequest(input: NormalizeInput): SourceRequest {
  const body = input.body ?? {}
  return {
    headers: input.headers ?? {},
    rawBody: input.rawBody ?? JSON.stringify(body),
    body,
    ...(input.event === undefined ? {} : { event: input.event }),
  }
}

/** 只校验签名（同步），供自检与快速放行判定用；密钥从 env 解析。 */
export function verifySourceAuth(spec: SourceSpec, input: NormalizeInput, env: NodeJS.ProcessEnv = process.env): VerifyResult {
  return verifyAuth(spec.auth, toRequest(input), env)
}

/** 校验签名 → 适配器归一化，返回 0~n 条归一化事件；拒绝时带 reason。 */
export async function normalizeSource(
  spec: SourceSpec,
  input: NormalizeInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<NormalizeResult> {
  return buildRegistry([spec]).normalize(spec.id, toRequest(input), env)
}
