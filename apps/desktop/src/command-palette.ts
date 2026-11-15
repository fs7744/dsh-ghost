/**
 * 命令面板 UI（C11-01）：输入框上方浮出候选，接管键盘。
 *
 * 铁律：斜杠命令不进模型消息。面板只做发现 / 补全，
 * 执行一律走宿主的 `commands/execute`，结果只进会话日志。
 */
import {
  commandLine, filterCommands, hasFileReference, isShellDirect,
  moveSelection, parseSlash, type CommandItem,
} from './palette.ts'

export interface PaletteHost {
  /** 当前会话可用的命令（可缓存）。 */
  listCommands(): Promise<CommandItem[]>
  /** 执行一行命令；宿主负责刷新日志。 */
  execute(line: string): Promise<unknown>
  /** 普通消息发送。 */
  send(): void
  /** 状态栏提示。 */
  notice(text: string): void
}

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] as string))

/**
 * 把命令面板挂到输入区。
 * @param host - 与宿主交互的四个回调
 */
export function mountCommandPalette(host: PaletteHost): void {
  const input = document.getElementById('input') as HTMLTextAreaElement
  const composer = document.getElementById('composer') as HTMLElement
  const palette = document.createElement('div')
  palette.id = 'palette'
  palette.className = 'hidden'
  composer.appendChild(palette) // absolute 定位，不占 flex 空间

  let items: CommandItem[] = []
  let visible: CommandItem[] = []
  let active = 0
  let open = false

  const load = async (): Promise<void> => {
    items = await host.listCommands()
    if (open) draw()
  }

  const choose = (index: number): void => {
    const item = visible[index]
    if (item === undefined) return
    if (item.hint !== undefined) {
      // 需要自由参数：把 `/name ` 留在输入框，用户继续敲，Enter 时由 send() 判为命令行。
      input.value = `/${item.name} `
      open = false
      draw()
      input.focus()
      host.notice(`/${item.name} 需要参数：${item.hint}`)
      return
    }
    input.value = ''
    open = false
    draw()
    void host.execute(commandLine(item.name))
      .then(() => host.notice(`已执行 /${item.name}`))
      .catch(error => host.notice(`命令失败：${String(error).slice(0, 60)}`))
  }

  const draw = (): void => {
    if (!open) {
      palette.classList.add('hidden')
      palette.innerHTML = ''
      return
    }
    palette.classList.remove('hidden')
    const rows = visible.map((item, index) => `
      <div class="prow${index === active ? ' on' : ''}" data-index="${index}">
        <span class="pname">/${escapeHtml(item.name)}</span>
        <span class="pdesc">${escapeHtml(item.description)}</span>
        ${item.hint === undefined ? '' : `<span class="phint">${escapeHtml(item.hint)}</span>`}
        ${item.acceptsAttachments === true ? '<span class="phint">可带附件</span>' : ''}
      </div>`).join('')
    const hints: string[] = []
    if (isShellDirect(input.value)) hints.push('! shell 直通：完整直通等终端面板（P3）')
    if (hasFileReference(input.value)) hints.push('@ 引用：文件选择器属 P3')
    const foot = ['↑↓ 选择 · Enter / Tab 执行 · Esc 关闭', ...hints].join(' · ')
    palette.innerHTML = `${rows || '<div class="pempty">没有匹配的命令</div>'}<div class="pfoot">${escapeHtml(foot)}</div>`
    palette.querySelectorAll<HTMLElement>('.prow').forEach(row => {
      // mousedown + preventDefault：别让输入框失焦导致面板先关掉
      row.addEventListener('mousedown', event => {
        event.preventDefault()
        choose(Number(row.dataset.index))
      })
    })
  }

  const refresh = (): void => {
    const parsed = parseSlash(input.value)
    open = parsed.active
    if (open) {
      visible = filterCommands(items, parsed.query)
      active = Math.min(active, Math.max(0, visible.length - 1))
      if (items.length === 0) void load()
    }
    draw()
  }

  input.addEventListener('input', refresh)
  input.addEventListener('keydown', event => {
    if (open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        active = moveSelection(visible.length, active, event.key === 'ArrowDown' ? 1 : -1)
        draw()
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        choose(active)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        open = false
        draw()
        return
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      host.send()
    }
  })

  void load()
}
