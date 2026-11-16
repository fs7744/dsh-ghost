/**
 * 记忆界面（C10-03）：分组查看、逐条编辑、逐条删除、一个总开关。
 *
 * 数据全部走 `ghostMemory/*` Remote，不直接读文件；与模型的 memory_* 工具共用
 * 同一个 MemoryStore 和写入门槛，所以「模型记了什么」在这里一定看得到。
 */
import { groupEntries, memorySummary, validEntryName, type MemoryEntry } from './memory-view.ts'

/** ISO 时间戳压成可读的「YYYY-MM-DD HH:mm」，无效值原样返回。 */
export function friendlyTime(raw: string | undefined): string {
  if (raw === undefined || raw === '') return '无时间'
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export interface MemoryWriteResult {
  outcome: { ok: boolean; reasons?: string[]; oneShot?: boolean }
}

/** 界面与宿主之间的接口（main.ts 用 transport 实现）。 */
export interface MemoryHost {
  list(): Promise<MemoryEntry[]>
  read(name: string): Promise<string | undefined>
  write(input: { name: string; title?: string; text: string; source: string }): Promise<MemoryWriteResult>
  remove(name: string): Promise<boolean>
  status(): Promise<{ enabled: boolean }>
  toggle(enabled: boolean): Promise<{ enabled: boolean }>
  notice(text: string): void
}

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] as string))

/**
 * 挂载记忆面板。
 * @param pane - `#memory` 容器
 * @param host - Remote 调用与状态提示
 */
export function mountMemoryPanel(pane: HTMLElement, host: MemoryHost): void {
  pane.innerHTML = `
    <div class="membar">
      <label class="memtoggle"><input type="checkbox" id="mem-toggle"> 允许写入新记忆</label>
      <button data-act="new">+ 新建</button>
      <button data-act="refresh">刷新</button>
      <span id="mem-status"></span>
    </div>
    <div class="membody" id="mem-list"></div>
  `
  const list = pane.querySelector<HTMLElement>('#mem-list')!
  const toggle = pane.querySelector<HTMLInputElement>('#mem-toggle')!
  const status = pane.querySelector<HTMLElement>('#mem-status')!

  let items: MemoryEntry[] = []
  let enabled = true
  let editing: { name: string; text: string } | undefined
  let creating = false

  const card = (item: MemoryEntry): string => {
    const isEditing = editing?.name === item.name
    return `<div class="mcard" data-name="${escapeHtml(item.name)}">
      <div class="mhead">
        <strong>${escapeHtml(item.title || item.name)}</strong>
        <span class="mmeta">${escapeHtml(item.name)} · ${escapeHtml(friendlyTime(item.updated))}</span>
        <span class="mspacer"></span>
        ${isEditing ? '' : '<button data-act="edit">编辑</button>'}
        <button data-act="del" class="danger">删除</button>
      </div>
      ${isEditing
        ? `<div class="medit"><textarea rows="5">${escapeHtml(editing?.text ?? '')}</textarea>
             <div><button data-act="save">保存</button><button data-act="cancel">取消</button></div></div>`
        : '<div class="mcontent">点「编辑」读取并修改正文</div>'}
    </div>`
  }

  const draw = (): void => {
    toggle.checked = enabled
    status.textContent = memorySummary(items, enabled)
    const createForm = creating ? `
      <div class="mcreate">
        <div class="mcreatetitle">新建记忆</div>
        <label>名称（kebab-case）<input id="mem-name" placeholder="build-command"></label>
        <label>标题<input id="mem-title" placeholder="一行说明"></label>
        <label>正文<textarea id="mem-text" rows="4" placeholder="写清结论与原因"></textarea></label>
        <div class="mbtns"><button data-act="create">保存</button><button data-act="cancel-new">取消</button></div>
      </div>` : ''
    const groups = groupEntries(items).map(group => `
      <section class="mgroup"><h3>${group.label}<span>${group.items.length}</span></h3>
        ${group.items.map(card).join('')}
      </section>`).join('')
    list.innerHTML = createForm + (groups || '<div class="empty">还没有记忆条目。</div>')
  }

  const refresh = async (): Promise<void> => {
    try {
      items = await host.list()
      enabled = (await host.status()).enabled
      editing = undefined
      creating = false
      draw()
    } catch (error) {
      host.notice(`读取记忆失败：${String(error).slice(0, 60)}`)
    }
  }

  const report = (result: MemoryWriteResult): void => {
    host.notice(result.outcome.ok
      ? '记忆已写入'
      : `未写入：${(result.outcome.reasons ?? []).join('；')}`)
  }

  toggle.addEventListener('change', () => {
    void host.toggle(toggle.checked).then(result => {
      enabled = result.enabled
      host.notice(enabled ? '记忆写入已开启' : '记忆写入已关闭（已写的仍可读）')
      draw()
    })
  })

  pane.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-act]')
    if (button === null) return
    const action = button.dataset.act
    const name = button.closest<HTMLElement>('[data-name]')?.dataset.name ?? ''
    const item = items.find(entry => entry.name === name)

    if (action === 'refresh') { void refresh(); return }
    if (action === 'new') { creating = true; editing = undefined; draw(); return }
    if (action === 'cancel-new') { creating = false; draw(); return }
    if (action === 'cancel') { editing = undefined; draw(); return }
    if (action === 'edit' && item !== undefined) {
      void host.read(item.name).then(content => {
        editing = { name: item.name, text: content ?? '' }
        draw()
      })
      return
    }
    if (action === 'save' && item !== undefined) {
      const text = button.closest<HTMLElement>('.mcard')?.querySelector<HTMLTextAreaElement>('textarea')?.value ?? ''
      void host.write({ name: item.name, title: item.title, text, source: 'desktop-ui' })
        .then(result => { report(result); void refresh() })
      return
    }
    if (action === 'create') {
      const nameInput = pane.querySelector<HTMLInputElement>('#mem-name')?.value.trim() ?? ''
      const title = pane.querySelector<HTMLInputElement>('#mem-title')?.value.trim() ?? ''
      const text = pane.querySelector<HTMLTextAreaElement>('#mem-text')?.value ?? ''
      if (!validEntryName(nameInput)) { host.notice('名称不合法：用小写字母、数字和连字符（kebab-case）'); return }
      void host.write({ name: nameInput, ...(title === '' ? {} : { title }), text, source: 'desktop-ui' })
        .then(result => { report(result); void refresh() })
      return
    }
    if (action === 'del' && item !== undefined) {
      if (!window.confirm(`删除记忆「${item.title || item.name}」？此操作不可撤销。`)) return
      void host.remove(item.name).then(removed => {
        host.notice(removed ? '已删除' : '删除失败（条目可能已不存在）')
        void refresh()
      })
    }
  })

  void refresh()
}
