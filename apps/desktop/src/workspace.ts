/**
 * 工作区与文件树 / 交付物预览 / 文档预览 / 右键菜单（C8-06 / C8-09 / C8-10 / C8-24）。
 *
 * 数据走 workspaceFiles/list|read 与 officeKit/render；端点不可用统一降级。
 * 纯逻辑（归一化、目录树构建、类型分类、菜单项计算）零 DOM，可单测。
 */
import {
  asList, bool, escapeHtml, num, paintText, pickStr, record, safeCall, str, unavailableHtml,
  type PanelInstance, type PanelServices,
} from './panels.ts'

export interface FileEntry {
  path: string
  name: string
  isDir: boolean
  size: number
}

export type FileKind = 'document' | 'image' | 'code' | 'deliverable' | 'other'

export interface TreeNode {
  name: string
  path: string
  isDir: boolean
  children: TreeNode[]
  entry: FileEntry | undefined
}

export interface FlatNode {
  name: string
  path: string
  isDir: boolean
  depth: number
}

/** 归一化 workspaceFiles/list 的响应，丢掉没有路径的畸形项。 */
export function normalizeFileEntries(raw: unknown): FileEntry[] {
  const out: FileEntry[] = []
  for (const value of asList(raw)) {
    const item = record(value)
    const path = pickStr(item, ['path', 'relativePath', 'name', 'file', 'id'])
    if (path === '') continue
    const clean = path.replace(/\\/g, '/')
    const name = pickStr(item, ['name', 'filename', 'basename'])
      || clean.split('/').filter(Boolean).pop()
      || clean
    const type = pickStr(item, ['type', 'kind']).toLowerCase()
    const isDir = bool(item.isDir) || bool(item.isDirectory) || type === 'dir'
      || type === 'directory' || clean.endsWith('/')
    out.push({ path: clean, name, isDir, size: num(item.size ?? item.bytes) })
  }
  return out
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

/**
 * 从扁平路径列表构建目录树：目录优先、同级按名称排序。
 * 缺失的中间目录会隐式补齐（不少宿主只返回文件不返回目录）。
 */
export function buildFileTree(entries: readonly FileEntry[]): TreeNode[] {
  const index = new Map<string, TreeNode>()
  const ensure = (path: string, name: string, isDir: boolean, entry: FileEntry | undefined): TreeNode => {
    const key = normalizePath(path)
    const found = index.get(key)
    if (found !== undefined) {
      if (entry !== undefined) {
        found.entry = entry
        found.isDir = found.isDir || isDir
      }
      return found
    }
    const node: TreeNode = { name, path: key, isDir, children: [], entry }
    index.set(key, node)
    return node
  }
  for (const entry of entries) {
    const full = normalizePath(entry.path)
    const segments = full.split('/').filter(Boolean)
    let parent: TreeNode | undefined
    for (let i = 0; i < segments.length - 1; i += 1) {
      const dirPath = segments.slice(0, i + 1).join('/')
      const dir = ensure(dirPath, segments[i] ?? dirPath, true, undefined)
      if (parent !== undefined && !parent.children.some(child => child.path === dir.path)) parent.children.push(dir)
      parent = dir
    }
    const leaf = ensure(full, entry.name, entry.isDir, entry)
    if (parent !== undefined && !parent.children.some(child => child.path === leaf.path)) parent.children.push(leaf)
  }
  const roots: TreeNode[] = []
  for (const node of index.values()) {
    if (normalizePath(node.path).split('/').filter(Boolean).length <= 1) roots.push(node)
  }
  return sortTree(roots)
}

/** 纯排序：目录在前、名字升序，返回新树不改动入参。 */
export function sortTree(nodes: readonly TreeNode[]): TreeNode[] {
  return [...nodes]
    .sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name)))
    .map(node => ({ ...node, children: sortTree(node.children) }))
}

/** 摊平成渲染用的行（带缩进层级）。 */
export function flattenTree(nodes: readonly TreeNode[], depth = 0): FlatNode[] {
  const out: FlatNode[] = []
  for (const node of nodes) {
    out.push({ name: node.name, path: node.path, isDir: node.isDir, depth })
    out.push(...flattenTree(node.children, depth + 1))
  }
  return out
}

/** 按扩展名分类，决定走文档预览、交付物预览还是纯文本。 */
export function classifyFile(path: string): FileKind {
  const lower = path.toLowerCase()
  const dot = lower.lastIndexOf('.')
  const ext = dot < 0 ? '' : lower.slice(dot + 1)
  if (['md', 'txt', 'pdf', 'doc', 'docx', 'rtf', 'json', 'yaml', 'yml', 'csv', 'log'].includes(ext)) return 'document'
  if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'].includes(ext)) return 'image'
  if (['html', 'htm', 'xlsx', 'xls', 'pptx', 'ppt'].includes(ext)) return 'deliverable'
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'css', 'sh', 'ps1', 'sql', 'toml'].includes(ext)) return 'code'
  return 'other'
}

export function isPreviewable(kind: FileKind): boolean {
  return kind === 'document' || kind === 'code' || kind === 'deliverable'
}

/** 归一化 workspaceFiles/read 或 officeKit/render 的响应为可显示文本。 */
export function normalizeFileContent(raw: unknown): string {
  if (typeof raw === 'string') return raw
  const value = record(raw)
  for (const key of ['content', 'text', 'value', 'data', 'body', 'rendered', 'html']) {
    const text = str(value[key])
    if (text !== '') return text
  }
  return ''
}

/** 右键菜单项：预览只在可预览类型上可用（权限开关语义）。 */
export interface MenuItem {
  id: string
  labelKey: string
  enabled: boolean
}
export function buildMenuItems(kind: FileKind): MenuItem[] {
  return [
    { id: 'open', labelKey: 'common.open', enabled: true },
    { id: 'copy', labelKey: 'common.copyPath', enabled: true },
    { id: 'preview', labelKey: 'common.preview', enabled: isPreviewable(kind) },
    { id: 'refresh', labelKey: 'common.refresh', enabled: true },
  ]
}

/** 挂载工作区面板。 */
export function mountWorkspacePanel(host: HTMLElement, services: PanelServices): PanelInstance {
  host.innerHTML = `
    <div class="panelbar">
      <strong data-t="workspace.tree"></strong>
      <button data-act="refresh" data-t="common.refresh"></button>
      <span class="panelhint" data-t="workspace.drop"></span>
      <span class="panelspacer"></span><span class="panelstatus"></span>
    </div>
    <div class="wsbody">
      <div class="wstree"></div>
      <div class="wspreview"><div class="empty" data-t="common.empty"></div></div>
    </div>
    <div class="ctxmenu hidden"></div>
  `
  const treeEl = host.querySelector<HTMLElement>('.wstree')!
  const previewEl = host.querySelector<HTMLElement>('.wspreview')!
  const statusEl = host.querySelector<HTMLElement>('.panelstatus')!
  const menuEl = host.querySelector<HTMLElement>('.ctxmenu')!
  let rows: FlatNode[] = []
  let menuPath = ''

  const drawTree = (): void => {
    if (rows.length === 0) {
      treeEl.innerHTML = `<div class="empty" data-t="common.empty"></div>`
    } else {
      treeEl.innerHTML = rows.map(row =>
        `<div class="wsrow" data-path="${escapeHtml(row.path)}" style="padding-left:${8 + row.depth * 14}px">
           <span class="wsicon">${row.isDir ? '[+]' : '[ ]'}</span>
           <span>${escapeHtml(row.name)}</span>
         </div>`).join('')
    }
    paintText(host, services)
  }

  const load = async (): Promise<void> => {
    paintText(host, services)
    const scope = services.agentId() ?? ''
    const result = await safeCall(() => services.transport.call('workspaceFiles/list', {
      workspaceFileScopeId: scope, path: '',
    }))
    if (!result.ok) {
      treeEl.innerHTML = unavailableHtml(services.t('common.unavailable'), result.reason)
      return
    }
    rows = flattenTree(buildFileTree(normalizeFileEntries(result.value)))
    statusEl.textContent = services.t('common.count').replace('{count}', String(rows.length))
    drawTree()
  }

  const openFile = async (path: string): Promise<void> => {
    const kind = classifyFile(path)
    if (kind === 'image' || kind === 'other') {
      previewEl.innerHTML = `<div class="wsfile"><div class="empty">${escapeHtml(path)}</div>
        <div class="panelhint">${escapeHtml(services.t('workspace.deliverable'))}</div></div>`
      return
    }
    const scope = services.agentId() ?? ''
    const endpoint = kind === 'deliverable' ? 'officeKit/render' : 'workspaceFiles/read'
    const args = kind === 'deliverable'
      ? { workspaceFileScopeId: scope, path, priority: 0 }
      : { workspaceFileScopeId: scope, path, range: undefined }
    const result = await safeCall(() => services.transport.call(endpoint as never, args as never))
    if (!result.ok) {
      previewEl.innerHTML = unavailableHtml(services.t('common.unavailable'), result.reason)
      return
    }
    const content = normalizeFileContent(result.value)
    previewEl.innerHTML = `<div class="wsfile"><div class="fpath">${escapeHtml(path)}</div>
      <pre>${escapeHtml(content === '' ? services.t('common.empty') : content)}</pre></div>`
  }

  const showMenu = (x: number, y: number, path: string): void => {
    menuPath = path
    const items = buildMenuItems(classifyFile(path))
    menuEl.innerHTML = items.map(item =>
      `<button data-m="${item.id}" ${item.enabled ? '' : 'disabled'}>${escapeHtml(services.t(item.labelKey))}</button>`).join('')
    menuEl.style.left = `${x}px`
    menuEl.style.top = `${y}px`
    menuEl.classList.remove('hidden')
  }

  treeEl.addEventListener('click', event => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('.wsrow[data-path]')
    if (row === null) return
    menuEl.classList.add('hidden')
    void openFile(row.dataset.path ?? '')
  })
  treeEl.addEventListener('contextmenu', event => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('.wsrow[data-path]')
    if (row === null) return
    event.preventDefault()
    showMenu(event.clientX, event.clientY, row.dataset.path ?? '')
  })
  menuEl.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-m]')
    if (button === null || button.disabled) return
    menuEl.classList.add('hidden')
    const action = button.dataset.m
    if (action === 'copy') {
      void navigator.clipboard?.writeText(menuPath).catch(() => services.notice(services.t('common.error')))
      services.notice(menuPath)
    } else if (action === 'open' || action === 'preview') {
      void openFile(menuPath)
    } else if (action === 'refresh') {
      void load()
    }
  })
  host.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-act="refresh"]')
    if (button !== null) void load()
  })

  return { refresh: load }
}
