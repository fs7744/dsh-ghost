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

/**
 * 构造 fileUploads/upload 的 request：一次一个文件，字段是**真实字节**的 base64。
 * 早期版本只发 name/size/type，宿主收到的是空文件——看起来上传成功，实际什么都没传。
 */
export function buildUploadRequest(data: string, name: string): { data: string; name?: string } {
  return { data, ...(name === '' ? {} : { name }) }
}

/** 字节 → base64（分块，避免大文件把参数列表撑爆）。 */
export function bytesToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000
  let binary = ''
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

/** 单文件上限：超过就明确拒绝，别让宿主在传输层报一个看不懂的错。 */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024

/** 从上传响应里取 receiptId（后续 prompt 的 file part 要用它）。 */
export function uploadedReceipt(raw: unknown): string {
  return pickStr(record(raw), ['receiptId', 'receipt', 'id'])
}

/** 从 directoryPicker/pick 结果里取选中路径。 */
export function pickedPath(raw: unknown): string {
  if (typeof raw === 'string') return raw
  const item = record(raw)
  const direct = pickStr(item, ['path', 'directory', 'dir', 'selected', 'picked'])
  if (direct !== '') return direct
  return pickStr(record(item.result), ['path', 'directory'])
}

/** 附件工具句柄：send() 从这里取本轮已上传的 receiptId。 */
export interface AttachmentTools {
  /** 取走并清空本轮 receipts（发送后调用，避免下一条消息重复引用）。 */
  takeReceipts: () => string[]
}

/** C8-22 + C8-24：把上传 / 选目录入口挂到输入区，并注册全局拖放。 */
export function mountAttachmentTools(composer: HTMLElement, services: PanelServices): AttachmentTools {
  const receipts: string[] = []
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

  const upload = async (files: readonly File[]): Promise<void> => {
    if (files.length === 0) return
    const agentId = services.agentId() ?? ''
    let ok = 0
    let lastError = ''
    for (const file of files) {
      if (file.size > MAX_UPLOAD_BYTES) {
        lastError = `${file.name} 超过 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB`
        continue
      }
      try {
        const data = bytesToBase64(new Uint8Array(await file.arrayBuffer()))
        const result = await safeCall(() => services.transport.call('fileUploads/upload' as never, {
          agentId, request: buildUploadRequest(data, file.name),
        } as never))
        if (!result.ok) { lastError = result.reason; continue }
        const receipt = uploadedReceipt(result.value)
        if (receipt === '') { lastError = '宿主没有返回 receiptId'; continue }
        receipts.push(receipt)
        ok += 1
      } catch (error) {
        lastError = String(error).slice(0, 80)
      }
    }
    status.textContent = ok === 0
      ? `${services.t('common.unavailable')}: ${lastError}`
      : `${ok}/${files.length} 个附件已上传${lastError === '' ? '' : `（${lastError}）`}`
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
    const files = Array.from(fileInput.files ?? [])
    void upload(files)
    fileInput.value = ''
  })

  // C8-24 全局文件拖拽：拖到窗口任意位置都进上传通道
  const onDragOver = (event: DragEvent): void => {
    if (event.dataTransfer !== null) event.preventDefault()
  }
  const onDrop = (event: DragEvent): void => {
    if (event.dataTransfer === null) return
    event.preventDefault()
    const files = Array.from(event.dataTransfer.files)
    if (files.length > 0) {
      void upload(files)
      services.notice(services.t('common.count').replace('{count}', String(files.length)))
    }
  }
  document.addEventListener('dragover', onDragOver)
  document.addEventListener('drop', onDrop)
  return { takeReceipts: () => receipts.splice(0) }
}
