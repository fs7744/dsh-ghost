/**
 * 外部 agent（peer）适配：把 Claude / Codex / 豆包 / WorkBuddy 这类**独立 agent 程序**
 * 当成同事来协作，而不是当成工具调用一次。
 *
 * 三种接法（覆盖业界主流形态）：
 *  - **cli**：命令行程序（`claude -p`、`codex exec` 这类），提示词走参数或 stdin；
 *  - **http**：普通 JSON HTTP 服务（`{prompt}` 进、`{output}` 出）；
 *  - **a2a**：Google Agent2Agent 协议的 `message/send`（可先拉 agent card 看能力）。
 *
 * 边界：
 *  - 命令与地址都由**用户自己配置**（本机），我们不内置任何厂商端点；
 *  - 执行用 `execFile`（参数数组，不经 shell），提示词作为独立参数或 stdin 传入，
 *    不做字符串拼接 → 没有注入面；
 *  - peer 的输出只作为**参考材料**回到会话，由主 agent 判断要不要采纳。
 */
import { execFile } from 'node:child_process'
import type { PeerAgent, PeerKind, PeerResult } from './types.ts'

export type { PeerAgent, PeerKind, PeerResult } from './types.ts'

/** 允许的 peer 类型。 */
export const PEER_KINDS: readonly PeerKind[] = ['cli', 'http', 'a2a']

/** 配置校验：返回错误列表，空数组即合法。 */
export function validatePeer(raw: unknown): string[] {
  const errors: string[] = []
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return ['peer 必须是对象']
  const peer = raw as Record<string, unknown>
  if (typeof peer.id !== 'string' || !/^[a-z][a-z0-9-]{0,40}$/.test(peer.id)) errors.push('id 必须是 kebab-case')
  if (typeof peer.label !== 'string' || peer.label.trim() === '') errors.push('label 不能为空')
  if (typeof peer.kind !== 'string' || !(PEER_KINDS as readonly string[]).includes(peer.kind)) {
    errors.push(`kind 必须是 ${PEER_KINDS.join(' / ')} 之一`)
  }
  if (peer.kind === 'cli') {
    if (typeof peer.command !== 'string' || peer.command.trim() === '') errors.push('cli 需要 command')
    if (peer.args !== undefined && (!Array.isArray(peer.args) || peer.args.some(item => typeof item !== 'string'))) {
      errors.push('args 必须是字符串数组')
    }
    if (peer.promptVia !== undefined && peer.promptVia !== 'argv' && peer.promptVia !== 'stdin') {
      errors.push("promptVia 只能是 'argv' 或 'stdin'")
    }
  }
  if (peer.kind === 'http' || peer.kind === 'a2a') {
    if (typeof peer.url !== 'string' || !/^https?:\/\/[^\s]+$/.test(peer.url)) errors.push(`${peer.kind} 需要 http(s) 地址`)
  }
  return errors
}

/** 归一化一批 peer 配置（丢弃非法项、去重）。 */
export function normalizePeers(raws: readonly unknown[]): { peers: PeerAgent[]; errors: Array<{ id: string; errors: string[] }> } {
  const peers: PeerAgent[] = []
  const errors: Array<{ id: string; errors: string[] }> = []
  const seen = new Set<string>()
  for (const raw of raws) {
    const problems = validatePeer(raw)
    if (problems.length > 0) {
      const id = typeof raw === 'object' && raw !== null && typeof (raw as { id?: unknown }).id === 'string'
        ? String((raw as { id: string }).id)
        : '(无 id)'
      errors.push({ id, errors: problems })
      continue
    }
    const peer = raw as PeerAgent
    if (seen.has(peer.id)) continue
    seen.add(peer.id)
    peers.push(peer)
  }
  return { peers, errors }
}

/**
 * 拼 CLI 参数：`{prompt}` 占位替换；没有占位时按 promptVia 追加或走 stdin。
 */
export function buildCliArgs(peer: PeerAgent, prompt: string): { args: string[]; stdin?: string } {
  const template = peer.args ?? []
  if (template.some(arg => arg.includes('{prompt}'))) {
    return { args: template.map(arg => arg.replaceAll('{prompt}', prompt)) }
  }
  if (peer.promptVia === 'stdin') return { args: [...template], stdin: prompt }
  return { args: [...template, prompt] }
}

/** 从普通 HTTP 响应里取文本（认几种常见字段名）。 */
export function parseHttpOutput(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (typeof raw !== 'object' || raw === null) return ''
  const value = raw as Record<string, unknown>
  for (const key of ['output', 'text', 'reply', 'result', 'content', 'answer']) {
    const item = value[key]
    if (typeof item === 'string') return item
    if (Array.isArray(item)) {
      const joined = item.map(entry => (typeof entry === 'string' ? entry : JSON.stringify(entry))).join('\n')
      if (joined !== '') return joined
    }
  }
  return ''
}

/** 从 A2A 响应里取文本（artifacts / status.message / parts）。 */
export function parseA2AOutput(raw: unknown): string {
  if (typeof raw !== 'object' || raw === null) return ''
  const value = raw as Record<string, unknown>
  const result = (value.result ?? value) as Record<string, unknown>
  const collect = (parts: unknown): string => {
    if (!Array.isArray(parts)) return ''
    return parts
      .map(part => {
        if (typeof part === 'string') return part
        if (typeof part === 'object' && part !== null) {
          const text = (part as { text?: unknown }).text
          return typeof text === 'string' ? text : ''
        }
        return ''
      })
      .filter(text => text !== '')
      .join('\n')
  }
  const artifacts = Array.isArray(result.artifacts) ? result.artifacts : []
  const fromArtifacts = artifacts
    .map(artifact => collect((artifact as { parts?: unknown }).parts))
    .filter(text => text !== '')
    .join('\n')
  if (fromArtifacts !== '') return fromArtifacts
  const status = result.status as { message?: { parts?: unknown } } | undefined
  const fromStatus = collect(status?.message?.parts)
  if (fromStatus !== '') return fromStatus
  return parseHttpOutput(result)
}

/** A2A 请求体（message/send）。 */
export function buildA2ARequest(prompt: string, context?: string): Record<string, unknown> {
  const text = context === undefined || context === '' ? prompt : `${prompt}\n\n---\n上下文：\n${context}`
  return {
    jsonrpc: '2.0',
    id: `peer-${Date.now()}`,
    method: 'message/send',
    params: {
      message: {
        role: 'user',
        parts: [{ kind: 'text', text }],
      },
    },
  }
}

/** 运行一个 cli peer。 */
function runCliPeer(peer: PeerAgent, prompt: string, timeoutMs: number): Promise<PeerResult> {
  // 先取到局部变量：TS 不会把属性的窄化带进闭包里。
  const command = peer.command
  if (command === undefined || command.trim() === '') {
    return Promise.resolve({ ok: false, output: '', error: 'peer 缺少 command', peerId: peer.id })
  }
  const { args, stdin } = buildCliArgs(peer, prompt)
  return new Promise((resolve) => {
    const child = execFile(command, args, {
      cwd: peer.cwd,
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, ...(peer.env ?? {}) } as NodeJS.ProcessEnv,
    }, (error: (Error & { killed?: boolean }) | null, stdout: string, stderr: string) => {
      if (error === null) {
        resolve({ ok: true, output: String(stdout).trim(), peerId: peer.id })
        return
      }
      const killed = error.killed === true
      resolve({
        ok: false,
        output: String(stdout).trim(),
        error: killed ? `超时（${Math.round(timeoutMs / 1000)} 秒）` : String(stderr || error).slice(0, 400),
        peerId: peer.id,
      })
    })
    if (stdin !== undefined) {
      child.stdin?.end(stdin)
    }
  })
}

/** 运行一个 http / a2a peer。 */
async function runHttpPeer(peer: PeerAgent, prompt: string, timeoutMs: number, context?: string): Promise<PeerResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const body = peer.kind === 'a2a'
      ? buildA2ARequest(prompt, context)
      : { prompt, ...(context === undefined ? {} : { context }) }
    const response = await fetch(peer.url!, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(peer.headers ?? {}) },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const text = await response.text()
    if (!response.ok) {
      return { ok: false, output: text.slice(0, 400), error: `HTTP ${response.status}`, peerId: peer.id }
    }
    let parsed: unknown = text
    try {
      parsed = JSON.parse(text)
    } catch { /* 不是 JSON 就按原文 */ }
    const output = peer.kind === 'a2a' ? parseA2AOutput(parsed) : parseHttpOutput(parsed)
    return {
      ok: output !== '',
      output,
      ...(output === '' ? { error: '响应里没找到输出内容' } : {}),
      peerId: peer.id,
    }
  } catch (error) {
    const reason = error instanceof Error && error.name === 'AbortError'
      ? `超时（${Math.round(timeoutMs / 1000)} 秒）`
      : String(error).slice(0, 200)
    return { ok: false, output: '', error: reason, peerId: peer.id }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 把任务交给一个 peer。
 * @param peer - peer 配置
 * @param prompt - 任务说明
 * @param options - 超时、附加上下文
 */
export async function runPeer(
  peer: PeerAgent,
  prompt: string,
  options: { timeoutMs?: number; context?: string } = {},
): Promise<PeerResult> {
  const timeoutMs = options.timeoutMs ?? 300_000
  if (peer.kind === 'cli') return runCliPeer(peer, prompt, timeoutMs)
  return runHttpPeer(peer, prompt, timeoutMs, options.context)
}

/**
 * 拉取 A2A agent card（看对方会什么）。
 */
export async function fetchAgentCard(url: string, timeoutMs = 8000): Promise<Record<string, unknown> | undefined> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) return undefined
    const parsed = JSON.parse(await response.text()) as Record<string, unknown>
    return parsed
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}
