/**
 * 安全存储（C5-13 / C2-03）：封装 Electron safeStorage（Windows 下即 DPAPI）。
 *
 * 硬要求：凭据绝不明文进 settings。加密可用时只写 base64 密文；不可用时
 * 明确降级为「仅内存、不落盘、重启即失效」，绝不把明文写进任何文件。
 * 纯模块：safeStorage 与文件系统全部注入，测试用假实现验证加解密与降级。
 */
import type { FileSystem, SafeStorageLike } from './ports.ts'

export type CredentialMode = 'encrypted' | 'unavailable'

/** settings 里的凭据区：只存密文，结构固定便于版本校验。 */
export interface StoredCredentials {
  v: 1
  items: Record<string, string>
}

export interface SetCredentialResult {
  stored: boolean
  mode: CredentialMode
  reason: string
}

export interface CredentialVaultDeps {
  safeStorage: SafeStorageLike
  fs: FileSystem
  path: string
  logger?: { warn(message: string): void }
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function fromBase64(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, 'base64'))
}

function isStored(value: unknown): value is StoredCredentials {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (v['v'] !== 1) return false
  const items = v['items']
  if (typeof items !== 'object' || items === null || Array.isArray(items)) return false
  return Object.values(items as Record<string, unknown>).every(x => typeof x === 'string')
}

export class CredentialVault {
  private readonly memory = new Map<string, string>()

  constructor(private readonly deps: CredentialVaultDeps) {}

  mode(): CredentialMode {
    return this.deps.safeStorage.isEncryptionAvailable() ? 'encrypted' : 'unavailable'
  }

  private readStore(): StoredCredentials {
    if (!this.deps.fs.exists(this.deps.path)) return { v: 1, items: {} }
    try {
      const parsed = JSON.parse(this.deps.fs.readFile(this.deps.path)) as unknown
      if (isStored(parsed)) return parsed
    } catch {
      // 损坏按空处理，不抛到调用方
    }
    return { v: 1, items: {} }
  }

  private writeStore(store: StoredCredentials): void {
    this.deps.fs.writeFile(this.deps.path, JSON.stringify(store))
  }

  set(name: string, plain: string): SetCredentialResult {
    if (name === '' || plain === '') {
      return { stored: false, mode: this.mode(), reason: 'empty-input' }
    }
    if (!this.deps.safeStorage.isEncryptionAvailable()) {
      // 降级策略：绝不写明文到 settings，仅保留在当前进程内存
      this.memory.set(name, plain)
      this.deps.logger?.warn('safeStorage unavailable: credential kept in memory only, not persisted')
      return { stored: false, mode: 'unavailable', reason: 'encryption-unavailable-kept-in-memory' }
    }
    const enc = toBase64(this.deps.safeStorage.encryptString(plain))
    const store = this.readStore()
    store.items[name] = enc
    this.writeStore(store)
    this.memory.delete(name)
    return { stored: true, mode: 'encrypted', reason: 'ok' }
  }

  get(name: string): string | null {
    if (!this.deps.safeStorage.isEncryptionAvailable()) return this.memory.get(name) ?? null
    const store = this.readStore()
    const enc = store.items[name]
    if (enc === undefined) return null
    try {
      return this.deps.safeStorage.decryptString(fromBase64(enc))
    } catch {
      return null
    }
  }

  remove(name: string): void {
    this.memory.delete(name)
    if (!this.deps.safeStorage.isEncryptionAvailable()) return
    const store = this.readStore()
    delete store.items[name]
    this.writeStore(store)
  }

  /** 自检：settings 文件里明文出现次数；正常路径必须为 0。 */
  countPlaintextOccurrences(plain: string): number {
    if (plain === '' || !this.deps.fs.exists(this.deps.path)) return 0
    return this.deps.fs.readFile(this.deps.path).split(plain).length - 1
  }
}
