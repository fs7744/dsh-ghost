#!/usr/bin/env node
/**
 * Remote 端点生成器：把 harness 的 typert descriptor 变成可调用的元数据。
 *
 * 为什么必须生成：RPC 的 payload 键是 **TS 源码里的参数名**（连 `_request` 这种下划线都算），
 * 而 `Agent` 这类值在线上会变成 `agentId` —— 这些映射只存在于 descriptor 的 `wire` 字段里。
 * 手写调用必错，生成才能跟上 harness 升级。
 *
 * 用法:
 *   node gen-remotes.mjs [--modules <node_modules>] [--out remotes.json] [--ts <file>]
 * 默认读**运行时安装目录** spikes/p05-transport/node_modules（有编译产物 lib/typert.remote-client.js），
 * 可用 DSH_DSH_MODULES / .env 覆盖。源码检出（DSH_HARNESS_ROOT）只用于契约校验，
 * 纯源码没有 descriptor 产物，不能在这里扫描；脚本会打印两者版本以便发现错配。
 */
import { readdirSync, existsSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { readVersion, resolveDshModules, resolveHarnessRoot } from '../scripts/harness-paths.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : fallback
}

const modules = resolveDshModules(argOf('--modules', undefined))
const outPath = resolve(argOf('--out', join(HERE, 'remotes.json')))
const tsOut = argOf('--ts', undefined)

if (!existsSync(modules)) {
  process.stderr.write(`找不到 node_modules: ${modules}\n先跑 spikes/p05-transport 的 npm i\n`)
  process.exit(2)
}

/** 找出所有带远端描述符的包。 */
function descriptorFiles(root) {
  const found = []
  for (const entry of readdirSync(root)) {
    if (!entry.startsWith('@')) continue
    const scope = join(root, entry)
    let packages = []
    try { packages = readdirSync(scope) } catch { continue }
    for (const name of packages) {
      const file = join(scope, name, 'lib', 'typert.remote-client.js')
      if (existsSync(file)) found.push({ package: `${entry}/${name}`, file })
    }
  }
  return found
}

/** 取一个值的安全摘要（描述符里有 zod 品牌对象，不能直接序列化）。 */
function schemaOf(parameter) {
  const schema = parameter.schema ?? parameter.value ?? parameter.type
  if (schema === undefined) return undefined
  try {
    const json = typeof schema.toJSONSchema === 'function' ? schema.toJSONSchema() : undefined
    if (json !== undefined) return json
  } catch { /* zod 版本差异，忽略 */ }
  return undefined
}

const files = descriptorFiles(modules)
const endpoints = []
const problems = []

for (const { package: packageName, file } of files) {
  let spec
  try {
    const module = await import(pathToFileURL(file).href)
    spec = module.default?.spec
  } catch (error) {
    problems.push(`${packageName}: 无法加载描述符（${String(error).slice(0, 120)}）`)
    continue
  }
  if (!spec?.methods) {
    problems.push(`${packageName}: 没有 spec.methods`)
    continue
  }
  for (const [endpoint, method] of Object.entries(spec.methods)) {
    endpoints.push({
      endpoint,
      package: spec.package ?? packageName,
      service: method.service,
      description: method.description,
      scope: method.scope,
      // wire 名就是线上 payload.args 的键；name 是 TS 源码里的名字。
      parameters: (method.parameters ?? []).map(p => ({
        name: p.name,
        wire: p.wire ?? p.name,
        optional: p.optional === true || p.required === false,
        schema: schemaOf(p),
      })),
      result: method.result?.jsonSchema,
    })
  }
}

endpoints.sort((a, b) => a.endpoint < b.endpoint ? -1 : 1)

const document = {
  generatedAt: new Date().toISOString(),
  modules,
  packages: files.length,
  endpoints: endpoints.length,
  problems,
  remotes: endpoints,
}
writeFileSync(outPath, JSON.stringify(document, null, 2))

const byPackage = new Map()
for (const e of endpoints) byPackage.set(e.package, (byPackage.get(e.package) ?? 0) + 1)

// 源码检出（契约）与运行时安装（宿主）必须是同一版本，否则契约探针的结论不可信。
const harnessRoot = resolveHarnessRoot(undefined)
const sourceVersion = harnessRoot === undefined ? undefined : readVersion(join(harnessRoot, 'package.json'))
const installedVersion = readVersion(join(modules, '@deepseek-ai', 'dsh', 'package.json'))
process.stdout.write(`源码检出  ${harnessRoot ?? '(未找到)'}  ${sourceVersion ?? '?'}\n`)
process.stdout.write(`运行时包  ${modules}  ${installedVersion ?? '?'}\n`)
if (sourceVersion !== undefined && installedVersion !== undefined && sourceVersion !== installedVersion) {
  process.stdout.write(`WARN  源码检出 ${sourceVersion} 与运行时 ${installedVersion} 版本不一致，契约探针结论可能失真\n`)
}
process.stdout.write(`扫描 ${files.length} 个包，得到 ${endpoints.length} 个 Remote 端点 → ${outPath}\n`)
for (const [name, count] of [...byPackage].sort((a, b) => b[1] - a[1])) {
  process.stdout.write(`  ${String(count).padStart(3)}  ${name}\n`)
}
if (problems.length > 0) {
  process.stdout.write(`\n${problems.length} 个包无法解析：\n`)
  for (const problem of problems) process.stdout.write(`  - ${problem}\n`)
}
/** 生成 TS 类型：端点名 + 参数 wire 名都进类型，拼错就是编译错误。 */
if (tsOut !== undefined) {
  const lines = [
    '/** 由 harness-contract/gen-remotes.mjs 生成，勿手改。 */',
    '/* eslint-disable */',
    '',
    'export interface RemoteMap {',
  ]
  for (const endpoint of endpoints) {
    const args = endpoint.parameters
      .map(p => `${JSON.stringify(p.wire)}${p.optional ? '?' : ''}: unknown`)
      .join('; ')
    lines.push(`  ${JSON.stringify(endpoint.endpoint)}: { args: { ${args} }; value: unknown }`)
  }
  lines.push('}', '', 'export type RemoteEndpoint = keyof RemoteMap', '')
  writeFileSync(resolve(tsOut), lines.join('\n'))
  process.stdout.write(`TS 类型 → ${resolve(tsOut)}（${endpoints.length} 个端点）\n`)
}

const sample = endpoints.find(e => e.endpoint === 'session/list')
if (sample) {
  process.stdout.write(`\nsession/list 的参数（wire 名就是要发出去的键）：\n`)
  for (const p of sample.parameters) process.stdout.write(`  name=${p.name} wire=${p.wire}${p.optional ? ' (可选)' : ''}\n`)
}
