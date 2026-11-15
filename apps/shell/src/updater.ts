/**
 * 自动更新通道与灰度（C5-08 / C6）：只写配置与判定逻辑，不真的发布。
 *
 * 纯模块：feed 地址由环境注入（CI secret / 构建参数），灰度按 installId
 * 做确定性分桶，保证同一安装一致命中，可灰度放量。稳定通道只收 stable，
 * beta 通道收 stable + beta；none 通道完全关闭。
 */
import type { UpdateChannel } from './config.ts'

export interface ChannelResolution {
  enabled: boolean
  channel: UpdateChannel
  feedUrl: string | null
}

export interface ChannelEnv {
  stableFeed?: string
  betaFeed?: string
}

/** 决定更新通道与 feed；none 或缺 feed 时 enabled=false（不联网）。 */
export function resolveChannel(configChannel: UpdateChannel, env: ChannelEnv): ChannelResolution {
  if (configChannel === 'none') return { enabled: false, channel: 'none', feedUrl: null }
  const feedUrl = configChannel === 'beta' ? (env.betaFeed ?? null) : (env.stableFeed ?? null)
  return { enabled: feedUrl !== null, channel: configChannel, feedUrl }
}

/** 简单的点分版本比较；非数字段按 0 处理（预发布由通道过滤兜底）。 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = a.split(/[.-]/)
  const pb = b.split(/[.-]/)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i += 1) {
    const na = Number.parseInt(pa[i] ?? '0', 10)
    const nb = Number.parseInt(pb[i] ?? '0', 10)
    const x = Number.isNaN(na) ? 0 : na
    const y = Number.isNaN(nb) ? 0 : nb
    if (x > y) return 1
    if (x < y) return -1
  }
  return 0
}

/** FNV-1a 32 位确定性 hash -> [0, buckets) 桶号；同一 installId 恒定。 */
export function hashBucket(id: string, buckets: number = 100): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return buckets <= 0 ? 0 : hash % buckets
}

export interface UpdateDecisionInput {
  channel: UpdateChannel
  currentVersion: string
  candidateVersion: string
  candidateChannel: 'stable' | 'beta'
  rolloutPercent: number
  installId: string
}

export interface UpdateDecision {
  offer: boolean
  reason: string
}

/** 灰度判定：通道过滤 -> 版本新旧 -> 分桶命中。rollout 钳制到 [0,100]。 */
export function shouldOfferUpdate(input: UpdateDecisionInput): UpdateDecision {
  if (input.channel === 'none') return { offer: false, reason: 'channel-off' }
  if (input.channel === 'stable' && input.candidateChannel === 'beta') {
    return { offer: false, reason: 'channel-mismatch' }
  }
  if (compareVersions(input.candidateVersion, input.currentVersion) <= 0) {
    return { offer: false, reason: 'not-newer' }
  }
  const pct = Math.max(0, Math.min(100, Math.round(input.rolloutPercent)))
  if (pct === 0) return { offer: false, reason: 'rollout-zero' }
  if (pct >= 100) return { offer: true, reason: 'full-rollout' }
  const bucket = hashBucket(input.installId)
  return bucket < pct
    ? { offer: true, reason: 'in-rollout' }
    : { offer: false, reason: 'out-of-rollout' }
}
