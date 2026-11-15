/**
 * 触发源端到端管线：原始投递 → 签名校验 → 归一化 → 建票判定。
 * 单一入口，测试与宿主装配都用它，避免各处重复拼链路。
 */

import type { SourceSpec } from '@dsh-ghost/source-hub'
import type { Trigger } from '../core/index.ts'
import { normalizeSource } from './registry.ts'
import { toTicketTriggers } from './triggers.ts'
import type { IngestSummary, NormalizeInput, TicketTriggerOptions } from './types.ts'

export interface IngestOutcome {
  summary: IngestSummary
  triggers: Trigger[]
}

/**
 * 收下一次原始投递：
 *  - 签名不对 / 未知来源：ok=false 并带 reason，一张票都不建；
 *  - 签名正确：归一化成事件，再按 addressed 策略决定建几张票。
 */
export async function ingestAndOpenTickets(
  spec: SourceSpec,
  input: NormalizeInput,
  env: NodeJS.ProcessEnv = process.env,
  triggerOptions: TicketTriggerOptions = {},
): Promise<IngestOutcome> {
  const result = await normalizeSource(spec, input, env)
  if (!result.ok) {
    return {
      summary: {
        ok: false,
        ...(result.reason === undefined ? {} : { reason: result.reason }),
        events: [], tickets: 0,
      },
      triggers: [],
    }
  }
  const triggers = toTicketTriggers(result.events, triggerOptions)
  return {
    summary: { ok: true, events: result.events, tickets: triggers.length },
    triggers,
  }
}
