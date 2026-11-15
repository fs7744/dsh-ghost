/**
 * 诊断包导出（C5-10）：收集版本、日志尾、宿主健康、票状态、环境信息，
 * 全部强制脱敏（token / API key / Cookie 零命中），再用纯 JS 生成 zip。
 *
 * 不引入任何必须联网安装的依赖：zip 用 store（无压缩）模式手写，
 * CRC32 自建表，文件名 ASCII、内容 UTF-8。纯模块，零 electron、零 DOM。
 */
import type { Clock } from './ports.ts'

export interface DiagnosticFile {
  name: string
  content: string
}

const SENSITIVE_KEY = /(token|api[_-]?key|secret|password|cookie|authorization|bearer)/i

/**
 * 文本双重脱敏：
 * 1) 已知敏感值（token / key / cookie）按长度降序精确替换，避免子串残留；
 * 2) 常见形态正则兜底（URL 参数、Authorization、Cookie、JSON 字段、sk- 前缀）。
 */
export function redactText(text: string, knownSecrets: readonly string[]): string {
  let out = text
  const secrets = [...knownSecrets].filter(s => s.length >= 4).sort((a, b) => b.length - a.length)
  for (const secret of secrets) out = out.split(secret).join('[REDACTED]')
  out = out.replace(/(token=)[^&\s"']+/gi, '$1[REDACTED]')
  out = out.replace(/(Authorization:\s*Bearer\s+)\S+/gi, '$1[REDACTED]')
  out = out.replace(/(Cookie:\s*)[^\r\n]+/gi, '$1[REDACTED]')
  out = out.replace(/("(?:token|apiKey|api_key|secret|password|cookie|authorization)"\s*:\s*")[^"]*(")/gi, '$1[REDACTED]$2')
  out = out.replace(/\bsk-[A-Za-z0-9._-]{8,}\b/g, '[REDACTED]')
  return out
}

/** 递归脱敏：敏感字段名整值替换，其余递归处理。 */
export function redactValue(value: unknown, knownSecrets: readonly string[]): unknown {
  if (typeof value === 'string') return redactText(value, knownSecrets)
  if (Array.isArray(value)) return value.map(v => redactValue(v, knownSecrets))
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactValue(val, knownSecrets)
    }
    return out
  }
  return value
}

export interface DiagnosticVersions {
  product: string
  shell: string
  electron: string
  chromium: string
  node: string
}

export interface DiagnosticHealth {
  ok: boolean
  state: string
  port: number
  restartCount: number
}

/** 由适配层注入真实采集；纯模块只负责组装与脱敏。 */
export interface DiagnosticCollector {
  versions(): DiagnosticVersions
  logTail(): string
  hostHealth(): DiagnosticHealth
  tickets(): unknown
  environment(): Record<string, unknown>
  knownSecrets(): readonly string[]
}

export interface DiagnosticBundle {
  createdAt: string
  files: DiagnosticFile[]
  zip: Uint8Array
}

/** 票快照只留排障需要的字段，避免把整棵树（含长正文）塞进诊断包。 */
const TICKET_FIELDS = ['id', 'title', 'stage', 'source', 'createdAt', 'updatedAt', 'priority', 'assignee'] as const
const MAX_TICKETS = 100

/** 规整票快照：最多 100 条，只留白名单字段；非对象项转成截断字符串。 */
export function clipTickets(value: unknown, max: number = MAX_TICKETS): unknown[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, Math.max(1, max)).map(item => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return String(item).slice(0, 200)
    const record = item as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of TICKET_FIELDS) {
      if (record[key] !== undefined) out[key] = record[key]
    }
    return out
  })
}

/** 组装诊断包：每个文件与 manifest 均经脱敏，再打包为 zip。 */
export function collectDiagnostics(collector: DiagnosticCollector, clock: Clock): DiagnosticBundle {
  const secrets = collector.knownSecrets()
  const files: DiagnosticFile[] = [
    { name: 'versions.json', content: JSON.stringify(redactValue(collector.versions(), secrets), null, 2) },
    { name: 'host-health.json', content: JSON.stringify(redactValue(collector.hostHealth(), secrets), null, 2) },
    { name: 'tickets.json', content: JSON.stringify(redactValue(collector.tickets(), secrets), null, 2) },
    { name: 'environment.json', content: JSON.stringify(redactValue(collector.environment(), secrets), null, 2) },
    { name: 'logs-tail.txt', content: redactText(collector.logTail(), secrets) },
  ]
  const manifest = [
    'dsh-ghost diagnostics bundle',
    'All contents are redacted: token / API key / Cookie are never included.',
    'Contents are local-only. Review before sharing.',
    'Files:',
    ...files.map(f => `  - ${f.name} (${f.content.length} chars)`),
  ].join('\n')
  files.push({ name: 'README.txt', content: manifest })
  return { createdAt: new Date(clock.now()).toISOString(), files, zip: buildDiagnosticZip(files) }
}

// ---------------------------------------------------------------------------
// 纯 JS ZIP（store 模式）
// ---------------------------------------------------------------------------

function utf8(text: string): Uint8Array {
  return Uint8Array.from(Buffer.from(text, 'utf8'))
}

const CRC_TABLE = makeCrcTable()

function makeCrcTable(): Uint32Array {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1
    table[n] = c >>> 0
  }
  return table
}

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const b of bytes) {
    c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

class ByteWriter {
  private readonly bytes: number[] = []

  u16(value: number): void {
    this.bytes.push(value & 0xff, (value >>> 8) & 0xff)
  }

  u32(value: number): void {
    this.bytes.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff)
  }

  raw(data: Uint8Array): void {
    for (const b of data) this.bytes.push(b)
  }

  get length(): number {
    return this.bytes.length
  }

  toBytes(): Uint8Array {
    return Uint8Array.from(this.bytes)
  }
}

interface CentralEntry {
  name: Uint8Array
  crc: number
  size: number
  offset: number
}

/** 生成标准 ZIP（store）：本地头 + 数据 + 中央目录 + EOCD。 */
export function buildDiagnosticZip(files: readonly DiagnosticFile[]): Uint8Array {
  const writer = new ByteWriter()
  const central: CentralEntry[] = []

  for (const file of files) {
    const name = utf8(file.name)
    const data = utf8(file.content)
    const crc = crc32(data)
    const offset = writer.length

    // local file header
    writer.u32(0x04034b50)
    writer.u16(20)
    writer.u16(0)
    writer.u16(0)
    writer.u16(0)
    writer.u16(0)
    writer.u32(crc)
    writer.u32(data.length)
    writer.u32(data.length)
    writer.u16(name.length)
    writer.u16(0)
    writer.raw(name)
    writer.raw(data)

    central.push({ name, crc, size: data.length, offset })
  }

  const cdOffset = writer.length
  for (const entry of central) {
    writer.u32(0x02014b50)
    writer.u16(20)
    writer.u16(20)
    writer.u16(0)
    writer.u16(0)
    writer.u16(0)
    writer.u16(0)
    writer.u32(entry.crc)
    writer.u32(entry.size)
    writer.u32(entry.size)
    writer.u16(entry.name.length)
    writer.u16(0)
    writer.u16(0)
    writer.u16(0)
    writer.u16(0)
    writer.u32(0)
    writer.u32(entry.offset)
    writer.raw(entry.name)
  }
  const cdSize = writer.length - cdOffset

  // end of central directory
  writer.u32(0x06054b50)
  writer.u16(0)
  writer.u16(0)
  writer.u16(central.length)
  writer.u16(central.length)
  writer.u32(cdSize)
  writer.u32(cdOffset)
  writer.u16(0)

  return writer.toBytes()
}
