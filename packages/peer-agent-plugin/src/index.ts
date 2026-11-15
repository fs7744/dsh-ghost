/**
 * 宿主插件：把外部 agent 程序接成**同事**（agent-to-agent）。
 *
 * 模型侧两个工具：
 *  - `agent_peers()`：现在有哪些同事可用（id、名称、能干什么）；
 *  - `agent_delegate(peer, task, context?)`：把一件事交给某个同事，返回他的产出。
 *
 * 同事的产出**只是参考材料**：主 agent 自己判断要不要采纳、要不要验证。
 * 我们不替同事做决定，也不自动执行同事建议的动作。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-tools'
import { normalizePeers, runPeer, validatePeer, type PeerAgent } from '@dsh-ghost/peer-agent'

/** 插件名。 */
export const name = 'ghost-peers'

/** 依赖：工具注册表。 */
export const inject = ['tools']

/** 插件配置。 */
export interface Config {
  /** 状态目录（peer 清单放这里）。 */
  stateDir: string
  /** 单个 peer 的默认超时（毫秒）。 */
  timeoutMs?: number
}

const PEERS_FILE = 'peers.json'
const OUTPUT_SCHEMA = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } as const

let currentDir = ''

const peersPath = (dir: string): string => join(dir, PEERS_FILE)

/** 读 peer 清单（纯函数，便于测试）。 */
export function readPeers(dir: string): { peers: PeerAgent[]; errors: Array<{ id: string; errors: string[] }> } {
  const target = peersPath(dir)
  if (!existsSync(target)) return { peers: [], errors: [] }
  try {
    const parsed = JSON.parse(readFileSync(target, 'utf8'))
    const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.peers) ? parsed.peers : [])
    return normalizePeers(list)
  } catch {
    return { peers: [], errors: [{ id: PEERS_FILE, errors: ['不是合法 JSON'] }] }
  }
}

/** 写 peer 清单：整份校验，非法项拒绝写入（不静默丢配置）。 */
export function savePeers(dir: string, peers: unknown): { ok: boolean; errors: string[]; count: number } {
  const list = Array.isArray(peers) ? peers : []
  const errors: string[] = []
  list.forEach((peer, index) => {
    for (const problem of validatePeer(peer)) errors.push(`第 ${index + 1} 个：${problem}`)
  })
  if (errors.length > 0) return { ok: false, errors, count: 0 }
  try {
    mkdirSync(dir, { recursive: true })
    const target = peersPath(dir)
    const temporary = `${target}.tmp`
    writeFileSync(temporary, `${JSON.stringify(list, null, 2)}\n`)
    renameSync(temporary, target)
    return { ok: true, errors: [], count: list.length }
  } catch (error) {
    return { ok: false, errors: [String(error)], count: 0 }
  }
}

/** 宿主 Remote 面（界面用）。 */
export class GhostPeersRemote extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, 'ghostPeers', { namespace: 'ghostPeers' })
  }

  /** peer 清单。 */
  @Remote('list')
  list(input: { root?: string }): { peers: PeerAgent[]; errors: Array<{ id: string; errors: string[] }> } {
    return readPeers(input?.root ?? currentDir)
  }

  /** 保存 peer 清单。 */
  @Remote('save')
  save(input: { peers: unknown; root?: string }): { ok: boolean; errors: string[]; count: number } {
    return savePeers(input?.root ?? currentDir, input?.peers)
  }
}

/** 挂载插件。 */
export function apply(ctx: Context, config: Config): void {
  currentDir = config.stateDir
  const cordis = ctx as unknown as { reflect?: unknown }
  if (cordis.reflect !== undefined) new GhostPeersRemote(ctx)

  const timeoutMs = config.timeoutMs ?? 300_000

  const describePeers = (): string => {
    const { peers } = readPeers(currentDir)
    if (peers.length === 0) {
      return '还没有登记任何外部 agent。可在「设置 → 外部 agent」里添加（命令行 / HTTP / A2A 三种接法）。'
    }
    return peers
      .map(peer => `${peer.id}（${peer.label}，${peer.kind}）${peer.description === undefined ? '' : `：${peer.description}`}`)
      .join('\n')
  }

  const tools: Array<{
    name: string
    description: string
    parameters: unknown
    execute: (args: Record<string, unknown>) => Promise<string>
  }> = [
    {
      name: 'agent_peers',
      description: '列出可以协作的外部 agent（同事）：id、名称、接法与擅长的事。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      execute: async () => describePeers(),
    },
    {
      name: 'agent_delegate',
      description: '把一件事交给某个外部 agent（同事）去做并取回产出。适合「让另一个模型/工具链独立跑一遍」的场景。'
        + '同事的产出只是参考材料，要自己判断是否采纳、是否需要验证。',
      parameters: {
        type: 'object',
        properties: {
          peer: { type: 'string', description: '同事的 id（先用 agent_peers 查）' },
          task: { type: 'string', description: '要做的事，说清楚要什么、期望什么产出' },
          context: { type: 'string', description: '附加上下文（可选）' },
        },
        required: ['peer', 'task'],
        additionalProperties: false,
      },
      execute: async args => {
        const peerId = String(args['peer'] ?? '').trim()
        const task = String(args['task'] ?? '').trim()
        if (peerId === '') return '缺少 peer（先用 agent_peers 看有哪些同事）。'
        if (task === '') return '缺少 task。'
        const { peers } = readPeers(currentDir)
        const peer = peers.find(item => item.id === peerId)
        if (peer === undefined) {
          return `没有叫「${peerId}」的同事。现有：${peers.map(item => item.id).join('、') || '（无）'}`
        }
        const context = String(args['context'] ?? '')
        const result = await runPeer(peer, task, {
          timeoutMs,
          ...(context === '' ? {} : { context }),
        })
        if (!result.ok) {
          return `同事「${peer.label}」没成功：${result.error ?? '未知原因'}${result.output === '' ? '' : `\n它的输出：\n${result.output.slice(0, 2000)}`}`
        }
        return `同事「${peer.label}」的产出：\n${result.output.slice(0, 8000)}`
      },
    },
  ]

  for (const tool of tools) {
    ctx.effect(() => ctx.tools.register({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as unknown as never,
      output: {
        schema: OUTPUT_SCHEMA as unknown as never,
        render: (_args, value) => [{ type: 'text', text: (value as unknown as { text: string }).text }],
      },
      async execute(args) {
        return { text: await tool.execute((args ?? {}) as Record<string, unknown>) }
      },
    }), `ghost-peers: ${tool.name}`)
  }

  ctx.logger?.info('ghost-peers: %d 个外部 agent 可协作', readPeers(currentDir).peers.length)
}
