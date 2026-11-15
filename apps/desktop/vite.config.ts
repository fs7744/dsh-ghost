import { defineConfig, type Plugin } from 'vite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO = resolve(import.meta.dirname, '../..')
const harness = process.env.HARNESS_ORIGIN ?? 'http://127.0.0.1:3917'

/**
 * 过渡方案：把插件写在磁盘上的票状态透出一个本地端点。
 * 正式版应走 Remote（插件注册 typert 服务），但那条路要先有服务描述符生成。
 */
function ticketsBridge(repo: string): Plugin {
  return {
    name: 'ghost-tickets-bridge',
    configureServer(server) {
      server.middlewares.use('/local/tickets', (_request, response) => {
        try {
          response.setHeader('content-type', 'application/json')
          response.end(readFileSync(resolve(repo, '.ghost', 'tickets.json'), 'utf8'))
        } catch {
          response.statusCode = 404
          response.end('{"tickets":[]}')
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [ticketsBridge(REPO)],
  root: import.meta.dirname,
  server: {
    // 显式绑 IPv4：Windows 上 "localhost" 可能只解析到 ::1，curl 127.0.0.1 会连不上
    host: '127.0.0.1',
    port: Number(process.env.UI_PORT ?? 5173),
    strictPort: false,
    proxy: {
      // 同源代理：浏览器只跟 vite 说话，由 vite 转发到 harness（顺带解决 CORS 与 Cookie）
      '/api': { target: harness, changeOrigin: false, ws: true },
      '/connect': { target: harness, changeOrigin: false },
    },
    fs: { allow: [REPO] },
  },
  resolve: {
    alias: {
      '@dsh-ghost/harness-port': resolve(REPO, 'packages/harness-port/src/index.ts'),
      '@dsh-ghost/playbook': resolve(REPO, 'packages/playbook/src/index.ts'),
    },
  },
})
