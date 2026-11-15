/**
 * 工具层的可注入依赖的默认实现（纯内存、零 IO）。
 *
 * 宿主接真实存储 / 真实视图时只要实现 ConfigStore / ViewReader 接口替换即可，
 * 工具注册表本身一行都不用改。
 */

import { findPlainSecret } from '@dsh-ghost/economizer'
import { UserError } from '../core/index.ts'
import type { ConfigStore, ViewReader } from './types.ts'

/** 允许的提示词分片名与必须保留的占位符；可由装配层用 prompts/manifest.json 覆盖。 */
export const DEFAULT_PROMPT_PARTS: readonly string[] = [
  'orchestrator', 'shared', 'subscriptions', 'dispatch', 'handoff',
  'handoff-orchestrator', 'handoff-worker', 'worker', 'work', 'cli',
  'admission', 'replies', 'team/communication', 'team/delivery', 'team/scope',
]

/** 这些分片被系统填充占位符，改提示词时必须保留，否则模型拿不到必要上下文。 */
const PLACEHOLDERS: Record<string, readonly string[]> = {
  handoff: ['{{ticket}}', '{{assignment}}'],
  'handoff-worker': ['{{ticket}}', '{{assignment}}'],
  worker: ['{{ticket}}'],
  dispatch: ['{{ticket}}'],
}

/** 提示词正文的字符预算：常驻体量之外的硬上限，防止把流程又塞回提示词。 */
export const PROMPT_CHAR_LIMIT = 4000

/**
 * 纯内存配置仓。settings_save / policy_sync / prompts_save 三个工具共用它，
 * 拒绝一律抛 UserError，由 invokeTool 把原因原样返回给模型自愈。
 */
export class SettingsStore implements ConfigStore {
  private readonly data = new Map<string, Record<string, unknown>>()
  private policyVersion: string
  private readonly promptTexts = new Map<string, string>()
  private readonly parts: readonly string[]
  private readonly placeholders: Record<string, readonly string[]>
  /** 保存历史，供测试与状态页核对「确实写进去了」。 */
  readonly writes: Array<{ block: string; at: string }> = []

  constructor(options: {
    policyVersion?: string
    initial?: Record<string, Record<string, unknown>>
    parts?: readonly string[]
    placeholders?: Record<string, readonly string[]>
    now?: () => string
  } = {}) {
    this.policyVersion = options.policyVersion ?? 'v1'
    this.parts = options.parts ?? DEFAULT_PROMPT_PARTS
    this.placeholders = options.placeholders ?? PLACEHOLDERS
    const now = options.now ?? (() => new Date().toISOString())
    for (const [block, value] of Object.entries(options.initial ?? {})) this.data.set(block, { ...value })
    this.stamp = now
  }
  private readonly stamp: () => string

  blocks(): string[] { return [...this.data.keys()] }
  read(block: string): Record<string, unknown> | undefined {
    const value = this.data.get(block)
    return value === undefined ? undefined : { ...value }
  }
  save(block: string, value: Record<string, unknown>): void {
    const known = ['policy', 'executor', 'prompts', 'sources', 'accounts', 'models']
    if (!known.includes(block)) throw new UserError('unknownBlock', { block })
    // 明文密钥一律拒写：它会同时落盘、进视图文本、进模型上下文。
    // 凭据只能指向环境变量（tokenEnv: 'GITHUB_TOKEN'）。
    const secret = findPlainSecret(value)
    if (secret !== undefined) throw new UserError('plainSecret', { path: `${block}.${secret}` })
    this.data.set(block, { ...value })
    this.writes.push({ block, at: this.stamp() })
  }
  syncPolicy(from?: string): { from: string; to: string } {
    const previous = from ?? this.policyVersion
    this.policyVersion = bump(this.policyVersion)
    return { from: previous, to: this.policyVersion }
  }
  savePrompt(id: string, text: string): void {
    if (!this.parts.includes(id)) throw new UserError('unknownPromptPart', { part: id })
    if (text.trim() === '') throw new UserError('promptPartEmpty', { part: id })
    if (text.length > PROMPT_CHAR_LIMIT) throw new UserError('promptTooLong', { limit: String(PROMPT_CHAR_LIMIT) })
    const required = this.placeholders[id] ?? []
    const missing = required.filter(token => !text.includes(token))
    if (missing.length) throw new UserError('promptPlaceholders', { part: id, placeholders: missing.join(', ') })
    this.promptTexts.set(id, text)
    this.writes.push({ block: `prompt:${id}`, at: this.stamp() })
  }
  prompts(): string[] { return [...this.promptTexts.keys()] }
  promptParts(): string[] { return [...this.parts] }

  /**
   * 可序列化快照：宿主把配置存到磁盘后再 restore，重启不会丢 settings/policy/prompts。
   * 只有纯数据，不含函数与路径，便于直接 JSON.stringify。
   */
  snapshot(): {
    policyVersion: string
    blocks: Record<string, Record<string, unknown>>
    prompts: Record<string, string>
  } {
    const blocks: Record<string, Record<string, unknown>> = {}
    for (const [key, value] of this.data) blocks[key] = { ...value }
    const prompts: Record<string, string> = {}
    for (const [key, value] of this.promptTexts) prompts[key] = value
    return { policyVersion: this.policyVersion, blocks, prompts }
  }

  /** 从快照恢复；非法形状整体忽略，保持内存版可用。 */
  restore(snapshot: unknown): void {
    if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) return
    const value = snapshot as Record<string, unknown>
    if (typeof value.policyVersion === 'string' && /^v\d+$/.test(value.policyVersion)) {
      this.policyVersion = value.policyVersion
    }
    // 分块校验：形状不对就整块忽略，不能先 clear 再发现是坏数据。
    if (typeof value.blocks === 'object' && value.blocks !== null && !Array.isArray(value.blocks)) {
      this.data.clear()
      for (const [key, block] of Object.entries(value.blocks)) {
        if (typeof block === 'object' && block !== null && !Array.isArray(block)) {
          this.data.set(key, { ...block as Record<string, unknown> })
        }
      }
    }
    if (typeof value.prompts === 'object' && value.prompts !== null && !Array.isArray(value.prompts)) {
      this.promptTexts.clear()
      for (const [key, text] of Object.entries(value.prompts)) {
        if (typeof text === 'string' && this.parts.includes(key)) this.promptTexts.set(key, text)
      }
    }
  }
}

/** 把 'v1' 推成 'v2'；非 vN 形状一律从 v1 重来。 */
function bump(version: string): string {
  const match = /^v(\d+)$/.exec(version)
  return match === null ? 'v1' : `v${Number(match[1] ?? '0') + 1}`
}

/**
 * 把一组面板视图绑成 ViewReader。装配层把 buildXxxView 的结果转成文本后传进来，
 * 工具层不需要认识视图的具体形状。
 */
export class StaticViewReader implements ViewReader {
  constructor(private readonly views: Record<string, string>) {}
  read(view: string): string | undefined { return this.views[view] }
}
