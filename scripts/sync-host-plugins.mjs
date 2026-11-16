#!/usr/bin/env node
/**
 * 把我们的 workspace 插件包同步进运行时的 `@dsh-ghost/*`。
 *
 * 为什么必须进运行时：harness 解析 patch 里的 `name: '@dsh-ghost/xxx'` 时，
 * 锚点是运行时 node_modules（dsh 包的 package.json 所在目录）。插件不在那儿，
 * 宿主会把它当「读不到的 bundle」跳过 —— 记忆、自动化、同事、票这些功能就都没有了。
 *
 * 只复制 package.json + lib + src + examples：
 * - lib 是编译产物（宿主按包名 require 它的入口）；
 * - src/examples 是为了让插件内的相对引用仍能工作。
 *
 * 用法: node scripts/sync-host-plugins.mjs [--runtime <dir>]
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { HOST_PACKAGES } from './host-packages.mjs'

const REPO = join(import.meta.dirname, '..')

function parseArgs(argv) {
  const out = { runtime: join(REPO, 'build', 'runtime', 'node_modules') }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--runtime') {
      const value = argv[++index]
      if (value === undefined) { process.stderr.write('--runtime 需要目录参数\n'); process.exit(2) }
      out.runtime = value
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write('用法: node scripts/sync-host-plugins.mjs [--runtime <dir>]\n')
      process.exit(0)
    } else {
      process.stderr.write(`未知参数: ${arg}\n`)
      process.exit(2)
    }
  }
  return out
}

const args = parseArgs(process.argv.slice(2))

if (!existsSync(args.runtime)) {
  process.stderr.write(`运行时目录不存在: ${args.runtime}\n先跑 node scripts/prepare-runtime.mjs --apply\n`)
  process.exit(1)
}

const target = join(args.runtime, '@dsh-ghost')
mkdirSync(target, { recursive: true })
let count = 0
const missing = []
for (const name of HOST_PACKAGES) {
  const from = join(REPO, 'packages', name)
  if (!existsSync(from)) { missing.push(name); continue }
  const to = join(target, name)
  mkdirSync(to, { recursive: true })
  cpSync(join(from, 'package.json'), join(to, 'package.json'))
  for (const dir of ['lib', 'src', 'examples']) {
    const source = join(from, dir)
    if (existsSync(source)) cpSync(source, join(to, dir), { recursive: true })
  }
  count += 1
}
process.stdout.write(`已同步 ${count}/${HOST_PACKAGES.length} 个 @dsh-ghost 插件包到 ${target}\n`)
if (missing.length > 0) process.stdout.write(`缺包: ${missing.join(', ')}\n`)
process.exit(count === HOST_PACKAGES.length ? 0 : 1)
