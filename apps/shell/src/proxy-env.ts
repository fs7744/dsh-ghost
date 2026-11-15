/**
 * 代理环境变量：从工作区的 `.ghost/ui/proxy.json` 读，转成宿主进程要用的 env。
 *
 * 宿主 `dsh-http-proxy` 会读 HTTP_PROXY / HTTPS_PROXY / NO_PROXY，装到 undici 的
 * 全局 dispatcher 上；本地回环始终直连（宿主内置），不会出现代理绕回自己的流量。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** 读代理配置，返回 env 键值对（没有配置就返回空）。 */
export function readProxyEnv(workspaceRoot: string): Record<string, string> {
  const file = join(workspaceRoot, '.ghost', 'ui', 'proxy.json')
  if (!existsSync(file)) return {}
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
      http?: unknown
      https?: unknown
      noProxy?: unknown
    }
    const env: Record<string, string> = {}
    if (typeof parsed.http === 'string' && parsed.http !== '') {
      env.HTTP_PROXY = parsed.http
      env.http_proxy = parsed.http
    }
    if (typeof parsed.https === 'string' && parsed.https !== '') {
      env.HTTPS_PROXY = parsed.https
      env.https_proxy = parsed.https
    }
    if (typeof parsed.noProxy === 'string' && parsed.noProxy !== '') {
      env.NO_PROXY = parsed.noProxy
      env.no_proxy = parsed.noProxy
    }
    return env
  } catch {
    return {}
  }
}
