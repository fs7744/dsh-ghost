/** 来源注册表：配置进来，归一化出去。orchestrator 拿到事件后再决定怎么开票。 */
import { adapterFor } from './adapters.ts'
import { verifyAuth } from './signature.ts'
import type { AdapterContext, NormalizeResult, SourceRequest, SourceSpec, SourceSummary } from './types.ts'

export interface SourceRegistry {
  /** 对外可见的来源清单（不含任何密钥）。 */
  list(): SourceSummary[]
  /** 校验签名 → 选适配器 → 归一化；失败时 events 为空并给 reason。 */
  normalize(sourceId: string, request: SourceRequest, env?: NodeJS.ProcessEnv): Promise<NormalizeResult>
}

/**
 * 从配置构建注册表。
 * @param specs - 用户配置的来源列表（顺序即 list() 的顺序）
 * @param context - 适配器运行期能力，主要是加载自定义 mapper
 */
export function createRegistry(specs: SourceSpec[], context: AdapterContext): SourceRegistry {
  const byId = new Map(specs.map(spec => [spec.id, spec]))
  return {
    list() {
      return specs.map(spec => ({
        id: spec.id,
        kind: spec.kind,
        description: spec.description ?? adapterFor(spec.kind).description,
        auth: spec.auth?.type ?? 'none',
      }))
    },
    async normalize(sourceId, request, env = process.env) {
      const spec = byId.get(sourceId)
      if (spec === undefined) return { ok: false, reason: 'unknown-source', events: [] }
      const verification = verifyAuth(spec.auth, request, env)
      if (!verification.ok) return { ok: false, reason: verification.reason, events: [] }
      try {
        const events = await adapterFor(spec.kind).normalize(request, spec, context)
        return { ok: true, events }
      } catch (error) {
        return { ok: false, reason: String(error), events: [] }
      }
    },
  }
}
