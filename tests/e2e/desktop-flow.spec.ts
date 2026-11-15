/**
 * L5 界面层规格（C4-07）：Playwright + 真实界面 + 截图基线。
 *
 * 跑的是**生产那一份界面代码**（Vite 开发服务），断言的是真实选择器
 * （#tabs / #composer / #input / #send / .wsbody …），不是虚构的 data-role。
 * 不需要宿主、不需要模型、不需要 key —— 界面骨架与交互随时可验。
 *
 * 截图基线：tests/e2e/__screenshots__/（首次运行自动生成；
 * 界面有意改动时用 `npx playwright test --update-snapshots` 更新）。
 */
import { test, expect, type Page } from '@playwright/test'

/** 等界面挂载完（页签出现即算就绪）。 */
async function ready(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.locator('#tabs button').first()).toBeVisible()
}

test('首屏：顶栏 / 页签 / 输入区可见，页签数量合理', async ({ page }) => {
  await ready(page)
  await expect(page.locator('header')).toBeVisible()
  const tabs = page.locator('#tabs button')
  expect(await tabs.count()).toBeGreaterThanOrEqual(10)
  await expect(page.locator('#composer')).toBeVisible()
  await expect(page.locator('#input')).toBeVisible()
  await expect(page.locator('#send')).toBeVisible()
})

test('页签切换：工作区与设置页真的渲染出来', async ({ page }) => {
  await ready(page)
  await page.locator('#tabs button', { hasText: '工作区' }).first().click()
  await expect(page.locator('.wsbody')).toBeVisible()
  await page.locator('#tabs button', { hasText: '设置' }).first().click()
  await expect(page.locator('#panel-settings')).toBeVisible()
})

test('主题按钮：暗 → 亮 → 跟随系统循环', async ({ page }) => {
  await ready(page)
  const button = page.locator('#btn-theme')
  await button.click()
  await expect(page.locator('body.theme-light')).toBeVisible()
  await button.click()
  await button.click()
  await expect(page.locator('body.theme-light')).toHaveCount(0)
})

test('截图基线：默认界面', async ({ page }) => {
  await ready(page)
  await expect(page).toHaveScreenshot('first-screen.png', { animations: 'disabled' })
})

test('截图基线：赛博朋克皮肤', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('dsh-ghost.skin', 'cyberpunk')
  })
  await ready(page)
  await expect(page).toHaveScreenshot('cyberpunk.png', { animations: 'disabled' })
})
