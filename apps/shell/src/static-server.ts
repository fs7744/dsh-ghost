/**
 * 静态服务纯逻辑（C5-01 生产加载 dist）：serve 产物 + 把 /connect 与 /api
 * 反向代理到 harness 宿主，保证渲染层「同源」拿 token / 换 Cookie / 取数。
 *
 * 这里只做路由与安全决策；真实 http server 与代理在 electron-static.ts 适配层。
 */
const PROXY_PREFIXES = ['/connect', '/api'] as const
const SPA_FALLBACK = 'index.html'
/** 模型管理页的本机 API：由壳自己处理，不能反代到 harness（宿主没有这些端点）。 */
const LOCAL_MODELS_PREFIX = '/api/models/'

export interface StaticResolution {
  ok: true
  filePath: string
  mime: string
}
export interface StaticRejection {
  ok: false
  reason: string
}
export type StaticResult = StaticResolution | StaticRejection

/** 只认模型管理页自己那几条路径，别把整个 /api 都留在本机。 */
export function isLocalModelsApi(pathname: string): boolean {
  const path = pathname.split('?')[0] ?? ''
  return path.startsWith(LOCAL_MODELS_PREFIX)
}

/** connect 换 Cookie 与 /api 取数必须转发到宿主，不能当静态文件读；模型 API 除外。 */
export function shouldProxy(pathname: string): boolean {
  if (isLocalModelsApi(pathname)) return false
  return PROXY_PREFIXES.some(prefix =>
    pathname === prefix || pathname.startsWith(`${prefix}/`) || pathname.startsWith(`${prefix}?`),
  )
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

export function selectMime(filePath: string): string {
  const dot = filePath.lastIndexOf('.')
  const ext = dot >= 0 ? filePath.slice(dot).toLowerCase() : ''
  return MIME[ext] ?? 'application/octet-stream'
}

/**
 * 把 URL 路径解析成 root 下的文件路径。
 * 拒绝 URL 编码异常、空字节与任何 .. 逃逸（目录穿越）；根路径回退 index.html。
 */
export function resolveStaticPath(root: string, pathname: string): StaticResult {
  const clean = pathname.split('?')[0] ?? '/'
  let decoded: string
  try {
    decoded = decodeURIComponent(clean)
  } catch {
    return { ok: false, reason: 'bad-encoding' }
  }
  if (decoded.includes('\0')) return { ok: false, reason: 'null-byte' }
  const segments = decoded.split('/').filter(s => s !== '' && s !== '.')
  if (segments.some(s => s === '..')) return { ok: false, reason: 'path-traversal' }
  const rel = segments.length === 0 ? [SPA_FALLBACK] : segments
  const base = root.replace(/[/\\]+$/, '')
  const filePath = [base, ...rel].join('/')
  const leaf = rel[rel.length - 1] ?? SPA_FALLBACK
  return { ok: true, filePath, mime: selectMime(leaf) }
}
