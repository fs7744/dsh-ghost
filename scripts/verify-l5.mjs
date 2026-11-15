#!/usr/bin/env node
/**
 * L5 界面层门禁（C4-07）：Playwright + **真实界面** + 截图基线。
 *
 * 现在是真跑：@playwright/test 已在开发依赖里，规格跑生产那一份界面代码
 * （Vite 开发服务），断言真实选择器，并留截图基线（含赛博朋克皮肤）。
 * 缺依赖时仍然明确 SKIP exit 0（不把「没装」当成失败），但依赖已在仓库里，
 * 正常开发机上都会真跑。
 *
 * 截图基线：tests/e2e/desktop-flow.spec.ts-snapshots/
 * 界面有意改动时用 `npx playwright test --update-snapshots` 更新。
 *
 * 用法:
 *   node scripts/verify-l5.mjs [--json] [--help]
 *
 * 退出码: 0 SKIP 或规格通过 / 1 规格失败 / 2 用法错误。
 */
import { existsSync, readdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'

const REPO = join(import.meta.dirname, '..')
const E2E = join(REPO, 'tests', 'e2e')

/** 关键路径（PLAN §13 / REVIEW R4）：一条链走完自建界面。 */
const KEY_PATHS = [
  '启动 Electron 壳并拿到首窗口',
  '首屏渲染：会话树 / 输入区 / 顶栏可见',
  '会话：新建会话并投递一条消息',
  '命令面板：输入 / 浮出候选，键盘选择',
  '剧本页：切到剧本标签，编辑器与源码视图可见',
  '记忆页：切到记忆标签，分组列表可见',
]

function canResolve(spec) {
  try { import.meta.resolve(spec); return true } catch { return false }
}

function specFiles() {
  return existsSync(E2E) ? readdirSync(E2E).filter(name => name.endsWith('.spec.ts')).sort() : []
}

function help() {
  process.stdout.write([
    '用法: node scripts/verify-l5.mjs [--json] [--help]',
    '',
    '  检测 @playwright/test；缺则 SKIP exit 0（装上就真跑）。',
    '  依赖齐全时执行 npx playwright test --config playwright.config.ts。',
    '',
    '退出码: 0 SKIP 或规格通过 / 1 规格失败 / 2 用法错误',
  ].join('\n') + '\n')
}

function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) { help(); return }
  const json = argv.includes('--json')
  const hasPlaywright = canResolve('@playwright/test') || canResolve('playwright')
  const hasElectron = canResolve('electron')
  const files = specFiles()

  if (!hasPlaywright) {
    const missing = ['@playwright/test / playwright']
    process.stdout.write(`SKIP  L5 界面层：未检测到 ${missing.join('、')}。装上依赖（npm i -D @playwright/test && npx playwright install chromium）即可真跑。\n`)
    process.stdout.write('关键路径规格（已写好，装依赖后可运行）：\n')
    KEY_PATHS.forEach((item, index) => process.stdout.write(`  ${index + 1}. ${item}\n`))
    process.stdout.write(`规格文件: ${files.length > 0 ? files.join(', ') : '(无)'}\n`)
    process.stdout.write('截图基线目录: tests/e2e/desktop-flow.spec.ts-snapshots/\n')
    if (json) process.stdout.write(JSON.stringify({ skipped: true, missing, paths: KEY_PATHS.length, specs: files }) + '\n')
    process.exit(0)
  }

  process.stdout.write('L5 界面层：依赖齐全，执行 tests/e2e 规格。\n')
  try {
    execSync('npx playwright test --config playwright.config.ts', { cwd: REPO, stdio: 'inherit' })
    process.stdout.write('L5 规格通过。\n')
    if (json) process.stdout.write(JSON.stringify({ skipped: false, ok: true, specs: files }) + '\n')
    process.exit(0)
  } catch (error) {
    process.stdout.write(`FAIL  L5 规格失败：${String(error).slice(0, 200)}\n`)
    if (json) process.stdout.write(JSON.stringify({ skipped: false, ok: false, specs: files }) + '\n')
    process.exit(1)
  }
}

main()
