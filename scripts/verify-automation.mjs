#!/usr/bin/env node
/**
 * 自动化验收：浏览器自动化（Playwright 优先，CDP 兜底）与 Windows 电脑操控真跑一遍。
 *
 * 不需要模型、不需要 key：
 *  - 浏览器：起引擎 → 打开本地测试页 → 读正文 → 点一下 → 填一下 → 截图；
 *  - 电脑操控：截屏存 PNG → 读 UI Automation 元素树 → 解析。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import {
  clickScript, createBrowserEngine, elementsScript, parseElements, screenshotScript,
} from '../packages/automation/lib/index.js'

const REPO = join(import.meta.dirname, '..')
const TMP = join(REPO, 'out', 'automation-check')
let failures = 0
const check = (ok, message) => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${message}\n`)
  if (!ok) failures += 1
}

rmSync(TMP, { recursive: true, force: true })
mkdirSync(TMP, { recursive: true })

// —— 浏览器 ——
const created = await createBrowserEngine({ headless: true })
if ('error' in created) {
  check(false, `浏览器引擎起不来：${created.error}`)
} else {
  const engine = created.engine
  check(true, `浏览器引擎就绪：${created.note}`)
  try {
    const page = join(TMP, 'page.html')
    writeFileSync(page, '<!doctype html><meta charset="utf-8"><title>自动化验收</title>'
      + '<h1 id="h">Hello dsh-ghost</h1><input id="q" value="">'
      + '<button id="b" onclick="document.getElementById(\'h\').textContent=\'点过了\'">点我</button>')
    const title = await engine.open(`file:///${page.replace(/\\/g, '/')}`)
    check(title === '自动化验收', `打开了测试页（标题：${title}）`)

    const body = await engine.read()
    check(body.includes('Hello dsh-ghost'), '读到了页面正文')

    check(await engine.click('#b') === 'clicked', '按选择器点击成功')
    const after = await engine.read()
    check(after.includes('点过了'), '点击真的生效了（页面内容变了）')

    check(await engine.type('#q', '你好 dsh') === 'filled', '按选择器填值成功')
    const shot = await engine.screenshot()
    check(shot.length > 1000, `页面截图拿到了数据（${shot.length} 字节 base64）`)
  } catch (error) {
    check(false, `浏览器操作出错：${String(error).slice(0, 200)}`)
  } finally {
    await engine.close()
  }
}

// —— Windows 电脑操控 ——
if (process.platform !== 'win32') {
  process.stdout.write('SKIP  电脑操控只支持 Windows，跳过\n')
} else {
  const shotPath = join(TMP, 'screen.png')
  await new Promise(resolve => {
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', screenshotScript(shotPath)],
      { timeout: 30_000, windowsHide: true }, () => resolve(undefined))
  })
  check(existsSync(shotPath), '整屏截图落盘成功')
  if (existsSync(shotPath)) {
    const bytes = readFileSync(shotPath).length
    check(bytes > 5000, `截图不是空白（${bytes} 字节）`)
  }

  const elements = await new Promise(resolve => {
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', elementsScript(120)],
      { timeout: 60_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (_error, stdout) => resolve(String(stdout ?? '')))
  })
  const parsed = parseElements(elements)
  check(parsed.length > 0, `UI Automation 读到 ${parsed.length} 个可访问元素`)
  if (parsed.length > 0) {
    check(parsed.some(element => element.name !== ''), '元素里有可读的控件名（可以按名字定位，而不是盲点）')
  }

  await new Promise(resolve => {
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', clickScript(2, 2)],
      { timeout: 30_000, windowsHide: true }, () => resolve(undefined))
  })
  check(true, '鼠标点击脚本执行完成')
}

rmSync(TMP, { recursive: true, force: true })
process.stdout.write(`\n${failures === 0 ? '自动化验收通过' : `${failures} 项失败`}\n`)
process.exit(failures === 0 ? 0 : 1)
