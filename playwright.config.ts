import { defineConfig, devices } from '@playwright/test'

/**
 * L5 界面层门禁：真实渲染我们的界面 + 截图基线。
 *
 * 起的是**真实的 Vite 开发服务**（界面代码是生产那一份），不启宿主——
 * 所以规格只断言「界面骨架与交互」，不依赖模型与 key（可随时跑）。
 * 需要宿主数据的路径由 `verify:*` 系列覆盖。
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --config apps/desktop/vite.config.ts',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      HARNESS_ORIGIN: process.env.HARNESS_ORIGIN ?? 'http://127.0.0.1:3917',
      UI_PORT: process.env.UI_PORT ?? '5173',
    },
  },
})
