/**
 * 模型管理页 UI（C3-01/02/03/05）：模型库列表、能力标注、角色路由编辑、
 * 自测按钮、本地预设一键生成。
 *
 * 只负责 DOM 渲染与事件；数据全部走 ModelsHost，纯逻辑在 models-view.ts。
 * 页面通过 fetch /api/... 走同源，无后端时 host 返回 demo 数据并标 demo。
 */
import {
  MODEL_ROLES, LOCAL_PRESETS, formatCapabilities, credentialRefLabel, flattenModels,
  parseModelRole, resolveRoleView, validateBindingView, updateBindingView, summary,
  type ModelsState, type RoleBindingView,
} from './models-view.ts'

export interface ProbeView {
  ok: boolean
  label: string
  detail?: string
}

/** 界面与宿主之间的接口（models-app.ts 用 fetch 实现）。 */
export interface ModelsHost {
  load(): Promise<ModelsState>
  save(state: ModelsState): Promise<void>
  probe(providerId: string): Promise<ProbeView>
  applyPreset(preset: string): Promise<ModelsState>
  notice(text: string): void
}

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] as string))

/**
 * 挂载模型管理面板。
 * @param root - #models-root 容器
 * @param host - 数据读写、自测、预设生成与状态提示
 */
export function mountModelsPanel(root: HTMLElement, host: ModelsHost): void {
  let state: ModelsState = { providers: [], bindings: [], demo: true }
  const probeResults = new Map<string, ProbeView>()

  const providerCard = (provider: ModelsState['providers'][number]): string => {
    const probe = probeResults.get(provider.id)
    const probeLabel = probe === undefined ? '' : `<span class="mprobe ${probe.ok ? 'ok' : 'bad'}">自测: ${escapeHtml(probe.label)}</span>`
    const models = provider.models.map(model => `
      <li class="mmodel">
        <strong>${escapeHtml(model.name || model.id)}</strong>
        <span class="mid">${escapeHtml(model.id)}</span>
        <span class="mcap">${escapeHtml(formatCapabilities(model.capabilities))}</span>
      </li>`).join('')
    return `<section class="mprovider" data-provider="${escapeHtml(provider.id)}">
      <div class="mphead">
        <strong>${escapeHtml(provider.displayName)}</strong>
        <span class="mmeta">${escapeHtml(provider.id)} · ${escapeHtml(provider.api)}</span>
        <span class="mspacer"></span>
        <button data-act="probe" data-provider="${escapeHtml(provider.id)}">连通性自测</button>
        ${probeLabel}
      </div>
      <div class="mmeta">端点 ${escapeHtml(provider.baseURL)} · 凭据 ${escapeHtml(credentialRefLabel(provider.apiKeyEnv))}</div>
      <ul class="mmodels">${models || '<li class="empty">没有模型</li>'}</ul>
    </section>`
  }

  const roleRow = (role: (typeof MODEL_ROLES)[number]): string => {
    const resolved = resolveRoleView(state, role)
    const current = resolved === undefined ? '' : `${resolved.provider.id}|${resolved.model.id}`
    const options = flattenModels(state).map(item => {
      const value = `${item.providerId}|${item.model.id}`
      const label = `${item.providerName} / ${item.model.name || item.model.id}`
      return `<option value="${escapeHtml(value)}"${value === current ? ' selected' : ''}>${escapeHtml(label)}</option>`
    }).join('')
    return `<label class="mrole"><span>${role}</span>
      <select data-role="${role}"><option value="">(未绑定)</option>${options}</select>
      <em>${resolved === undefined ? '未绑定' : escapeHtml(formatCapabilities(resolved.model.capabilities))}</em>
    </label>`
  }

  const draw = (): void => {
    const presets = LOCAL_PRESETS.map(preset =>
      `<button data-act="preset" data-preset="${preset}">一键生成 ${preset} 预设</button>`).join(' ')
    root.innerHTML = `
      <div class="mmbar">
        <strong>模型库</strong>
        <span id="models-status">${escapeHtml(summary(state))}</span>
        <span class="mspacer"></span>
        ${state.demo ? '<span class="mdemo">demo（无后端，展示内置示例数据）</span>' : ''}
        <button data-act="refresh">刷新</button>
      </div>
      <div id="models-notice" class="mnotice"></div>
      <div class="msection">
        <h3>本地预设</h3>
        <div class="mbtns">${presets}</div>
      </div>
      <div class="msection">
        <h3>角色路由</h3>
        ${MODEL_ROLES.map(roleRow).join('')}
      </div>
      <div class="msection">
        <h3>Provider / 模型</h3>
        <div id="models-list">${state.providers.map(providerCard).join('') || '<div class="empty">还没有 provider。</div>'}</div>
      </div>
    `
  }

  const refresh = async (): Promise<void> => {
    try {
      state = await host.load()
      probeResults.clear()
      draw()
    } catch (error) {
      host.notice(`读取模型库失败：${String(error).slice(0, 60)}`)
    }
  }

  root.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-act]')
    if (button === null) return
    const action = button.dataset.act
    if (action === 'refresh') { void refresh(); return }
    if (action === 'probe') {
      const providerId = button.dataset.provider ?? ''
      void host.probe(providerId).then(result => {
        probeResults.set(providerId, result)
        host.notice(`自测 ${providerId}: ${result.label}${result.detail === undefined ? '' : ` · ${result.detail}`}`)
        draw()
      }).catch(error => host.notice(`自测失败：${String(error).slice(0, 60)}`))
      return
    }
    if (action === 'preset') {
      const preset = button.dataset.preset ?? ''
      void host.applyPreset(preset).then(next => {
        state = next
        host.notice(`已生成 ${preset} 预设`)
        draw()
      }).catch(error => host.notice(`生成预设失败：${String(error).slice(0, 60)}`))
    }
  })

  root.addEventListener('change', event => {
    const select = event.target as HTMLSelectElement
    const role = select.dataset.role === undefined ? undefined : parseModelRole(select.dataset.role)
    if (role === undefined) return
    if (select.value === '') {
      state = { ...state, bindings: state.bindings.filter(item => item.role !== role) }
      void host.save(state).then(() => draw())
      return
    }
    const parts = select.value.split('|')
    const providerId = parts[0]
    const modelId = parts[1]
    if (providerId === undefined || modelId === undefined) return
    const binding: RoleBindingView = { role, providerId, modelId }
    const errors = validateBindingView(state, binding)
    if (errors.length > 0) { host.notice(errors.join('；')); draw(); return }
    state = updateBindingView(state, binding)
    void host.save(state).then(() => { host.notice(`${role} 已绑定`); draw() })
  })

  void refresh()
}
