/**
 * L5 界面层规格骨架（C4-07）：Playwright + Electron 关键路径 + 截图基线。
 *
 * 只进每日、不进 PR。依赖 @playwright/test 与 electron 未安装时，
 * scripts/verify-l5.mjs 会 SKIP exit 0，不会加载本文件。
 * Electron 主进程入口由 DSH_ELECTRON_MAIN 指定，桌面壳落地后填真实路径。
 * 截图基线放 tests/e2e/__screenshots__/，首次运行用 --update-snapshots 生成。
 */
import { test, expect } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { resolve } from 'node:path'

const MAIN = resolve(process.env.DSH_ELECTRON_MAIN ?? 'apps/desktop/electron-main.cjs')

/** 每条规格独立启动一次 Electron；真实落地后可改成共用 fixture。 */
async function openApp() {
  const app = await electron.launch({ args: [MAIN] })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

test('启动 -> 首屏：会话树 / 输入区 / 顶栏可见', async () => {
  const { app, page } = await openApp()
  try {
    await expect(page.locator('#app')).toBeVisible()
    await expect(page.locator('[data-role="session-tree"]')).toBeVisible()
    await expect(page.locator('[data-role="composer"]')).toBeVisible()
    await expect(page).toHaveScreenshot('first-screen.png')
  } finally {
    await app.close()
  }
})

test('会话：新建会话并投递一条消息', async () => {
  const { app, page } = await openApp()
  try {
    await page.locator('[data-act="new-session"]').click()
    await page.locator('[data-role="composer"]').fill('ping')
    await page.locator('[data-act="send"]').click()
    await expect(page.locator('[data-role="bubble"]').last()).toBeVisible()
    await expect(page).toHaveScreenshot('session-message.png')
  } finally {
    await app.close()
  }
})

test('命令面板：输入 / 浮出候选并可键盘选择', async () => {
  const { app, page } = await openApp()
  try {
    await page.locator('[data-role="composer"]').fill('/')
    await expect(page.locator('[data-role="command-palette"]')).toBeVisible()
    await page.keyboard.press('ArrowDown')
    await expect(page).toHaveScreenshot('command-palette.png')
  } finally {
    await app.close()
  }
})

test('剧本页：编辑器与源码视图可见', async () => {
  const { app, page } = await openApp()
  try {
    await page.locator('[data-tab="playbook"]').click()
    await expect(page.locator('[data-role="flow-editor"]')).toBeVisible()
    await expect(page.locator('[data-role="flow-source"]')).toBeVisible()
    await expect(page).toHaveScreenshot('playbook-page.png')
  } finally {
    await app.close()
  }
})

test('记忆页：分组列表与总开关可见', async () => {
  const { app, page } = await openApp()
  try {
    await page.locator('[data-tab="memory"]').click()
    await expect(page.locator('#mem-list')).toBeVisible()
    await expect(page.locator('#mem-toggle')).toBeVisible()
    await expect(page).toHaveScreenshot('memory-page.png')
  } finally {
    await app.close()
  }
})

test('关键路径串跑：启动 -> 会话 -> 命令面板 -> 剧本页 -> 记忆页', async () => {
  const { app, page } = await openApp()
  try {
    await expect(page.locator('#app')).toBeVisible()
    await page.locator('[data-act="new-session"]').click()
    await page.locator('[data-role="composer"]').fill('/')
    await expect(page.locator('[data-role="command-palette"]')).toBeVisible()
    await page.keyboard.press('Escape')
    await page.locator('[data-tab="playbook"]').click()
    await expect(page.locator('[data-role="flow-editor"]')).toBeVisible()
    await page.locator('[data-tab="memory"]').click()
    await expect(page.locator('#mem-list')).toBeVisible()
  } finally {
    await app.close()
  }
})
