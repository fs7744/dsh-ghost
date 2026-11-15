/**
 * 模型配置的文件存储（C3 的持久化位）：把 `/api/models/state` 的 CatalogState
 * 落到用户目录的 `models.json`，重启后不再丢。
 *
 * 结构损坏一律回退空目录，不让一个坏文件把模型页卡死；写入走 tmp + rename。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { CatalogState, CatalogStore, ProviderSpec, RoleBinding } from '@dsh-ghost/model-manager'

const EMPTY: CatalogState = { providers: [], bindings: [] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 只做形状校验；字段合法性由 models-api 的 validateProviderSpec 负责。 */
function parseState(raw: unknown): CatalogState {
  if (!isRecord(raw) || !Array.isArray(raw.providers) || !Array.isArray(raw.bindings)) return EMPTY
  const providers = raw.providers
    .filter(isRecord)
    .filter(item => Array.isArray(item['models']))
    .map(item => item as unknown as ProviderSpec)
  const bindings = raw.bindings.filter(isRecord) as unknown as RoleBinding[]
  return { providers, bindings }
}

/** 文件版 CatalogStore；路径由调用方注入，测试可用临时目录。 */
export function createFileCatalogStore(path: string): CatalogStore {
  const read = (): CatalogState => {
    if (!existsSync(path)) return EMPTY
    try {
      return parseState(JSON.parse(readFileSync(path, 'utf8')))
    } catch {
      return EMPTY
    }
  }
  const write = (state: CatalogState): void => {
    mkdirSync(dirname(path), { recursive: true })
    const temporary = `${path}.tmp`
    writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`)
    renameSync(temporary, path)
  }
  return { read, write }
}
