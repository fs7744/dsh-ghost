#!/usr/bin/env node
/**
 * 验收「自动化插件在真实宿主里可用」：
 *  - 插件装载（ghost-automation 注册的工具在宿主里可见）；
 *  - ghostAutomation/status 能报出本机浏览器与 Windows 能力；
 *  - 开关能改（改完立刻生效，不需要重启宿主）。
 */
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { boot, stop, login, createTransport } from './lib-driver.mjs'

const REPO = join(import.meta.dirname, '..')
let failures = 0
const check = (ok, message) => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${message}\n`)
  if (!ok) failures += 1
}

let server
try {
  server = await boot({ profile: 'p05', fromDefault: false })
  const session = await login(server.url, 'none')
  const transport = createTransport({ ...session, onError: error => process.stdout.write(`WARN  ${String(error)}\n`) })
  const created = await transport.call('session/create', { request: { cwd: join(REPO, 'spikes', 'p05-transport', '.workspace') } })

  const status = await transport.call('ghostAutomation/status', {}).catch(error => ({ error: String(error) }))
  check(status?.error === undefined, 'ghostAutomation/status 可调用')
  const browser = status?.browser ?? {}
  const computer = status?.computer ?? {}
  check(typeof browser.available === 'boolean', `报出浏览器可用性：${String(browser.available)}${browser.name === undefined ? '' : `（${browser.name}）`}`)
  check(computer.available === true || computer.available === false, `报出电脑操控可用性：${String(computer.available)}（${String(computer.platform)}）`)

  const off = await transport.call('ghostAutomation/setEnabled', { input: { browser: false, computer: false } }).catch(error => ({ error: String(error) }))
  check(off?.error === undefined && off?.browser === false && off?.computer === false, '开关能关')
  const on = await transport.call('ghostAutomation/setEnabled', { input: { browser: true, computer: true } }).catch(error => ({ error: String(error) }))
  check(on?.error === undefined && on?.browser === true && on?.computer === true, '开关能开（立即生效）')
  await transport.call('ghostAutomation/setEnabled', { input: { browser: false, computer: false } }).catch(() => undefined)
} catch (error) {
  failures += 1
  process.stdout.write(`FAIL  ${String(error)}\n`)
} finally {
  if (server !== undefined) await stop(server.child)
  rmSync(join(REPO, '.ghost', 'automation.json'), { force: true })
}

process.stdout.write(`\n${failures === 0 ? '自动化插件验收通过' : `${failures} 项失败`}\n`)
process.exit(failures === 0 ? 0 : 1)
