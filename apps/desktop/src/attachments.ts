/**
 * 附件上传、目录选择与文件拖拽（C8-22 / C8-24）。
 *
 * 上传走 fileUploads/upload，目录走 directoryPicker/pick|list；全局 drop 把拖入的
 * 文件也送进同一条上传通道。纯逻辑（目录列表归一化、拖拽文件归一化、请求构造）零 DOM。
 */
import {
  asList, bool, num, paintText, pickStr, record, safeCall, str,
  type PanelServices,
} from './panels.ts'

export interface DirEntry {
  name: string
  path: string
  isDir: boolean
}
export function normalizeDirectoryList(raw: unknown): DirEntry[] {
  const out: DirEntry[] = []
  for (const value of asList(raw)) {
    const item = record(value)
    const path = pickStr(item, ['path', 'fullPath', 'name', 'id'])
    if (path === '') continue
    const clean = path.replace(/\\/g, '/')
    const name = pickStr(item, ['name', 'basename']) || clean.split('/').filter(Boolean).pop() || clean
    const isDir = bool(item.isDir) || bool(item.isDirectory)
      || pickStr(item, ['type', 'kind']).toLowerCase() === 'dir'
    out.push({ name, path: clean, isDir })
  }
  return sortDirectoryList(out)
}

/** 目录优先、同级按名称。 */
export function sortDirectoryList(rows: readonly DirEntry[]): DirEntry[] {
  return [...rows].sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name)))
}

export interface UploadItem {
  name: string
  size: number
  type: string
}
/** 归一化拖拽 / 文件选择得到的 File 列表，丢掉无名称项。 */
export function normalizeDroppedFiles(files: readonly Partial<UploadItem>[]): UploadItem[] {
  const out: UploadItem[] = []
  for (const file of files) {
    const name = str(file.name)
    if (name === '') continue
    out.push({ name, size: num(file.size), type: str(file.type) })
  }
  return out
}

/** 构造 fileUploads/upload 的 wire 参数（agentId + request）。 */
export function buildUploadRequest(agentId: string, items: readonly UploadItem[]): { request: Record<string, unknown> } {
  return {
    request: {
      files: items.map(item => ({ name: item.name, size: item.size, type: item.type })),
    },
  }
}

/** 从 directoryPicker/pick 结果里取选中路径。 */
export function pickedPath(raw: unknown): string {
  if (typeof raw === 'string') return raw
  const item = record(raw)
  const direct = pickStr(item, ['path', 'directory', 'dir', 'selected', 'picked'])
  if (direct !== '') return direct
  return pickStr(record(item.result), ['path', 'directory'])
}

/** C8-22 + C8-24：把上传 / 选目录入口挂到输入区，并注册全局拖放。 */
export function mountAttachmentTools(composer: HTMLElement, services: PanelServices): void {
  const tools = document.createElement('div')
  tools.className = 'attachtools'
  tools.innerHTML = `
    <button data-act="upload" data-t="attach.upload"></button>
    <button data-act="directory" data-t="attach.directory"></button>
    <input type="file" multiple hidden data-role="file" />
    <span class="attachstatus"></span>`
  composer.appendChild(tools)
  paintText(tools, services)
  const fileInput = tools.querySelector<HTMLInputElement>('input[data-role="file"]')!
  const status = tools.querySelector<HTMLElement>('.attachstatus')!

  const upload = async (items: readonly UploadItem[]): Promise<void> => {
    if (items.length === 0) return
    const agentId = services.agentId() ?? ''
    const result = await safeCall(() => services.transport.call('fileUploads/upload' as never, {
      agentId, request: buildUploadRequest(agentId, items).request,
    } as never))
    status.textContent = result.ok
      ? services.t('common.count').replace('{count}', String(items.length))
      : result.reason
  }

  const pickDirectory = async (): Promise<void> => {
    const picked = await safeCall(() => services.transport.call('directoryPicker/pick' as never, {} as never))
    if (picked.ok) {
      const path = pickedPath(picked.value)
      if (path !== '') {
        status.textContent = services.t('attach.picked').replace('{path}', path)
        services.notice(path)
        return
      }
    }
    // 原生选择器不可用 -> 降级为宿主目录列表
    const listed = await safeCall(() => services.transport.call('directoryPicker/list' as never, { path: '' } as never))
    if (!listed.ok) {
      status.textContent = services.t('common.unavailable')
      return
    }
    const rows = normalizeDirectoryList(listed.value)
    status.textContent = rows.length === 0
      ? services.t('common.empty')
      : `${services.t('common.count').replace('{count}', String(rows.length))}: ${rows.slice(0, 3).map(row => row.name).join(', ')}`
  }

  tools.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]')
    if (button === null) return
    if (button.dataset.act === 'upload') fileInput.click()
    else if (button.dataset.act === 'directory') void pickDirectory()
  })
  fileInput.addEventListener('change', () => {
    const files = Array.from(fileInput.files ?? []).map(file => ({ name: file.name, size: file.size, type: file.type }))
    void upload(normalizeDroppedFiles(files))
    fileInput.value = ''
  })

  // C8-24 全局文件拖拽：拖到窗口任意位置都进上传通道
  const onDragOver = (event: DragEvent): void => {
    if (event.dataTransfer !== null) event.preventDefault()
  }
  const onDrop = (event: DragEvent): void => {
    if (event.dataTransfer === null) return
    event.preventDefault()
    const files = Array.from(event.dataTransfer.files).map(file => ({
      name: file.name, size: file.size, type: file.type,
    }))
    const items = normalizeDroppedFiles(files)
    if (items.length > 0) {
      void upload(items)
      services.notice(services.t('common.count').replace('{count}', String(items.length)))
    }
  }
  document.addEventListener('dragover', onDragOver)
  document.addEventListener('drop', onDrop)
}
