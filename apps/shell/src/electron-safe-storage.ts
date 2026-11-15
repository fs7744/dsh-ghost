/**
 * safeStorage 适配（C5-13 / C2-03）：把 Electron safeStorage 包成 SafeStorageLike。
 * Windows 下底层即 DPAPI；不可用时由 credentials 纯模块明确降级（绝不写明文）。
 */
import { safeStorage } from 'electron'
import type { SafeStorageLike } from './ports.ts'

export function createSafeStorage(): SafeStorageLike {
  return {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: plain => new Uint8Array(safeStorage.encryptString(plain)),
    decryptString: bytes => safeStorage.decryptString(Buffer.from(bytes)),
  }
}
