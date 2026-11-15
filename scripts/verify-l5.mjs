#!/usr/bin/env node
/**
 * L5 界面层门禁骨架（C4-07）：Playwright + Electron 关键路径 + 截图基线。
 *
 * 不安装 playwright / electron。检测不到依赖时明确 SKIP 并 exit 0，不进 PR 门禁
 * （每日跑）。关键路径以可运行的规格写在 tests/e2e/*.spec.ts；依赖齐全时本脚本
 * 调用 playwright test runner 执行它们。截图基线目录 tests/e2e/__screenshots__/。
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
    '  检测 @playwright/test 与 electron；缺任一则 SKIP exit 0，不进 PR 门禁。',
    '  依赖齐全时执行 npx playwright test tests/e2e。',
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

  if (!hasPlaywright || !hasElectron) {
    const missing = [
      ...(hasPlaywright ? [] : ['@playwright/test / playwright']),
      ...(hasElectron ? [] : ['electron']),
    ]
    process.stdout.write(`SKIP  L5 界面层：未检测到 ${missing.join('、')}。不安装依赖、不进 PR，每日跑。\n`)
    process.stdout.write('关键路径规格（已写好，装依赖后可运行）：\n')
    KEY_PATHS.forEach((item, index) => process.stdout.write(`  ${index + 1}. ${item}\n`))
    process.stdout.write(`规格文件: ${files.length > 0 ? files.join(', ') : '(无)'}\n`)
    process.stdout.write('截图基线目录: tests/e2e/__screenshots__/（首次运行时生成）\n')
    if (json) process.stdout.write(JSON.stringify({ skipped: true, missing, paths: KEY_PATHS.length, specs: files }) + '\n')
    process.exit(0)
  }

  process.stdout.write('L5 界面层：依赖齐全，执行 tests/e2e 规格。\n')
  try {
    execSync('npx playwright test tests/e2e', { cwd: REPO, stdio: 'inherit' })
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
