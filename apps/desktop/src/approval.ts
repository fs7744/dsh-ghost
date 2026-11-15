/**
 * 审批弹窗（C8-03）。
 *
 * 待审批项来自 session/projections 里的审批 / 动作卡投影，或事件流上的 approval 帧；
 * 字段名随宿主版本变化，纯逻辑兼容多种写法，端点不可用一律静默降级（不打扰用户）。
 * 应答走 actionCards/act；宿主没接这个能力时把错误显示出来，不抛未捕获异常。
 */
import {
  asList, escapeHtml, pickStr, record, safeCall,
  type PanelServices,
} from './panels.ts'

export type ApprovalKind = 'allow' | 'deny' | 'always' | 'other'

export interface ApprovalOption {
  id: string
  label: string
  kind: ApprovalKind
}

export interface ApprovalRequest {
  id: string
  callId: string
  agentId: string
  title: string
  detail: string
  options: ApprovalOption[]
}

/** 从 id / 文案推断选项语义，用于排序与应答载荷。 */
export function optionKind(id: string, label: string): ApprovalKind {
  const text = `${id} ${label}`.toLowerCase()
  if (text.includes('always') || text.includes('总是')) return 'always'
  if (text.includes('deny') || text.includes('reject') || text.includes('拒绝') || text.includes('cancel')) return 'deny'
  if (text.includes('allow') || text.includes('approve') || text.includes('批准') || text.includes('accept') || text.includes('once')) return 'allow'
  return 'other'
}

/** 归一化审批选项：丢掉空壳，按 允许/总是/拒绝/其它 排序。 */
export function parseApprovalOptions(raw: unknown): ApprovalOption[] {
  const out: ApprovalOption[] = []
  for (const value of asList(raw)) {
    const item = record(value)
    const id = pickStr(item, ['id', 'value', 'verb', 'action', 'key'])
    const label = pickStr(item, ['label', 'text', 'name', 'title']) || id
    if (id === '' && label === '') continue
    out.push({ id: id || label, label, kind: optionKind(id, label) })
  }
  const rank: Record<ApprovalKind, number> = { allow: 0, always: 1, deny: 2, other: 3 }
  return [...out].sort((a, b) => rank[a.kind] - rank[b.kind] || a.label.localeCompare(b.label))
}

/** 从投影里挖待审批项，兼容数组 / {active,pending,items} 两种形态。 */
export function extractApprovals(projections: unknown): ApprovalRequest[] {
  const values = record(record(projections).values)
  const sources: unknown[] = [
    values.userApproval, values.approvals, values.pendingApprovals,
    values.actionCards, values.authorization, values.userQuestions,
  ]
  const out: ApprovalRequest[] = []
  for (const source of sources) {
    const wrapper = record(source)
    const list = [...asList(source), ...asList(wrapper.active ?? wrapper.pending ?? wrapper.items)]
    for (const value of list) {
      const item = record(value)
      // 只收「待审批」：显式 active:false 或已 answered 的项跳过
      if (item.active === false || item.answered === true || item.resolved === true) continue
      const id = pickStr(item, ['id', 'callId', 'requestId', 'key'])
      const title = pickStr(item, ['title', 'question', 'prompt', 'description', 'text', 'name'])
      if (id === '' && title === '') continue
      out.push({
        id: id || title,
        callId: pickStr(item, ['callId', 'id']) || id,
        agentId: pickStr(item, ['agentId', 'sessionId']),
        title: title || '需要你批准',
        detail: pickStr(item, ['detail', 'reason', 'summary', 'tool', 'command', 'description']),
        options: parseApprovalOptions(item.options ?? item.choices ?? item.actions ?? item.buttons),
      })
    }
  }
  return out
}

export interface ApprovalReply {
  endpoint: string
  args: Record<string, unknown>
}

/** 构造应答：拒绝 -> approved:false，其余 -> true。 */
export function buildApprovalReply(request: ApprovalRequest, option: ApprovalOption): ApprovalReply {
  return {
    endpoint: 'actionCards/act',
    args: {
      agentId: request.agentId,
      callId: request.callId,
      verb: option.id,
      payload: { approved: option.kind !== 'deny' },
    },
  }
}

export interface ApprovalFrame {
  event?: string
  args?: readonly unknown[]
}

export interface ApprovalLayer {
  onFrame: (frame: ApprovalFrame) => void
  refresh: () => Promise<void>
  destroy: () => void
}

/** 挂载全局审批弹窗层，返回事件 / 刷新 / 注销入口给 main.ts 装配。 */
export function mountApprovalLayer(services: PanelServices): ApprovalLayer {
  const layer = document.createElement('div')
  layer.className = 'approval-mask hidden'
  layer.innerHTML = `<div class="approval-box" role="dialog" aria-modal="true">
      <div class="approval-title"></div>
      <div class="approval-hint"></div>
      <div class="approval-detail"></div>
      <div class="approval-options"></div>
      <button class="approval-close" data-act="close"></button>
    </div>`
  document.body.appendChild(layer)
  const titleEl = layer.querySelector<HTMLElement>('.approval-title')!
  const hintEl = layer.querySelector<HTMLElement>('.approval-hint')!
  const detailEl = layer.querySelector<HTMLElement>('.approval-detail')!
  const optionsEl = layer.querySelector<HTMLElement>('.approval-options')!
  const closeEl = layer.querySelector<HTMLElement>('.approval-close')!
  let current: ApprovalRequest | undefined

  const hide = (): void => {
    layer.classList.add('hidden')
    current = undefined
  }

  const draw = (request: ApprovalRequest): void => {
    current = request
    titleEl.textContent = services.t('approval.title')
    hintEl.textContent = services.t('approval.hint')
    detailEl.textContent = request.detail === '' ? request.title : `${request.title} · ${request.detail}`
    closeEl.textContent = services.t('common.close')
    const options = request.options.length === 0
      ? parseApprovalOptions([
        { id: 'allow', label: services.t('common.approve') },
        { id: 'deny', label: services.t('common.deny') },
      ])
      : request.options
    optionsEl.innerHTML = options.map((option, index) =>
      `<button data-index="${index}">${escapeHtml(option.label)}</button>`).join('')
    layer.classList.remove('hidden')
  }

  const answer = async (index: number): Promise<void> => {
    if (current === undefined) return
    const option = current.options[index]
      ?? parseApprovalOptions([{ id: 'allow', label: services.t('common.approve') }])[0]
    if (option === undefined) return
    const reply = buildApprovalReply(current, option)
    const result = await safeCall(() => services.transport.call(reply.endpoint as never, reply.args as never))
    if (result.ok) {
      hide()
      services.notice(services.t('runtime.done'))
    } else {
      detailEl.textContent = `${services.t('common.unavailable')}: ${result.reason}`
    }
  }

  optionsEl.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-index]')
    if (button === null) return
    void answer(Number(button.dataset.index))
  })
  closeEl.addEventListener('click', hide)
  layer.addEventListener('click', event => {
    if (event.target === layer) hide()
  })
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && !layer.classList.contains('hidden')) hide()
  }
  document.addEventListener('keydown', onKey)

  const refresh = async (): Promise<void> => {
    const sessionId = services.agentId()
    if (sessionId === undefined) return
    const result = await safeCall(() => services.transport.call('session/projections', {
      request: { sessionId },
    }))
    if (!result.ok) return
    const approvals = extractApprovals(result.value)
    const first = approvals[0]
    if (first !== undefined) draw(first)
  }

  const onFrame = (frame: ApprovalFrame): void => {
    const event = frame.event ?? ''
    if (event.includes('approval') || event.includes('action-card')) void refresh()
  }

  return {
    onFrame,
    refresh,
    destroy: () => {
      document.removeEventListener('keydown', onKey)
      layer.remove()
    },
  }
}
