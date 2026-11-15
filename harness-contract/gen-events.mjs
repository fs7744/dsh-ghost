#!/usr/bin/env node
/**
 * 从 harness 运行时包里生成「转发事件」清单（PLAN §5.1 的待补项 / REVIEW R1）。
 *
 * 事件名的唯一真相是 `@deepseek-ai/dsh-api-remotes` 里的
 * `API_REMOTE_FORWARDED_EVENTS`：它同时是宿主转发策略与 `ctx.remote.$on` 的合法键集。
 * 手写事件名必然漂移，所以这里读它的编译产物，产出：
 *   - harness-contract/events.json              （给契约探针 / 升级流水线比对）
 *   - packages/harness-port/src/events.generated.ts（给类型层与运行时用）
 *
 * 只读扫描，不改 harness；没有运行时安装时明确报错 exit 2。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readVersion, resolveDshModules } from '../scripts/harness-paths.mjs'

const REPO = join(import.meta.dirname, '..')
const SOURCE = '@deepseek-ai/dsh-api-remotes/lib/types/remote-events.js'
const OUT_JSON = join(REPO, 'harness-contract', 'events.json')
const OUT_TS = join(REPO, 'packages', 'harness-port', 'src', 'events.generated.ts')

/**
 * 读运行时包里声明的转发事件。
 * @param modules - `@deepseek-ai/*` 所在的 node_modules
 * @returns 归一化后的事件描述符（确定性顺序，去掉函数体）
 */
export function readDeclaredEvents(modules = resolveDshModules()) {
  const file = join(modules, ...SOURCE.split('/'))
  if (!existsSync(file)) throw new Error(`找不到事件声明：${file}（设 DSH_DSH_MODULES 指向运行时安装）`)
  const declared = readFileSync(file, 'utf8')
  if (!declared.includes('API_REMOTE_FORWARDED_EVENTS')) throw new Error(`事件声明格式变了：${file}`)
  return importAndNormalize(file)
}

async function importAndNormalize(file) {
  const mod = await import(pathToFileURL(file).href)
  const list = mod.API_REMOTE_FORWARDED_EVENTS
  if (!Array.isArray(list)) throw new Error('API_REMOTE_FORWARDED_EVENTS 不是数组')
  const events = list.map(entry => {
    if (typeof entry?.event !== 'string' || (entry.mode !== 'emit' && entry.mode !== 'waterfall')) {
      throw new Error(`事件条目不合法：${JSON.stringify(entry)}`)
    }
    return {
      event: entry.event,
      mode: entry.mode,
      resources: Object.keys(entry.resources ?? {}).sort(),
    }
  })
  return events.sort((a, b) => a.event.localeCompare(b.event))
}

/** 生成两个产物。 */
export async function generate(modules = resolveDshModules()) {
  const events = await readDeclaredEvents(modules)
  const version = readVersion(join(modules, '@deepseek-ai', 'dsh', 'package.json')) ?? 'unknown'
  const payload = { schema: 1, source: SOURCE, harness: version, count: events.length, events }
  writeFileSync(OUT_JSON, `${JSON.stringify(payload, null, 2)}\n`)

  const lines = [
    '/** 由 harness-contract/gen-events.mjs 生成，勿手改。 */',
    '/* eslint-disable */',
    '',
    '/** harness 转发的宿主事件名（含非所有者 Peer 的 waterfall 询问）。 */',
    'export type RemoteEventName =',
    ...events.map(item => `  | ${JSON.stringify(item.event)}`),
    '',
    '/** 事件描述符：mode 决定是广播还是瀑布式询问，resources 是它携带的资源身份。 */',
    'export interface RemoteEventDescriptor {',
    '  event: RemoteEventName',
    "  mode: 'emit' | 'waterfall'",
    '  resources: readonly string[]',
    '}',
    '',
    'export const REMOTE_EVENTS: readonly RemoteEventDescriptor[] = [',
    ...events.map(item => `  { event: ${JSON.stringify(item.event)}, mode: ${JSON.stringify(item.mode)}, resources: ${JSON.stringify(item.resources)} },`),
    ']',
    '',
    'const KNOWN = new Set<string>(REMOTE_EVENTS.map(item => item.event))',
    '',
    '/** 运行时判断一个事件名是否属于 harness 的转发白名单。 */',
    'export function isKnownRemoteEvent(name: string): name is RemoteEventName {',
    '  return KNOWN.has(name)',
    '}',
    '',
  ]
  writeFileSync(OUT_TS, lines.join('\n'))
  return payload
}

const invoked = process.argv[1]
if (invoked !== undefined && fileURLToPath(import.meta.url) === resolve(invoked)) {
  try {
    const result = await generate()
    process.stdout.write(`harness ${result.harness}：${result.count} 个转发事件 → events.json / events.generated.ts\n`)
    for (const item of result.events.filter(entry => entry.mode === 'waterfall')) {
      process.stdout.write(`  waterfall  ${item.event}\n`)
    }
  } catch (error) {
    process.stderr.write(`FAIL  ${String(error)}\n`)
    process.exit(2)
  }
}
