/**
 * 模型管理页 UI：服务目录（可新增/编辑/删除）、连通性自测、职责路由与自动推荐。
 *
 * 只负责 DOM 渲染与事件；数据全部走 ModelsHost，纯逻辑在 models-view.ts。
 * 密钥明文只存在于表单内存，保存时交给 host.setCredential（走 safeStorage）
 * 加密落盘；ModelsState / models.json 里只有 env 引用名。
 */
import {
  API_OPTIONS, MODEL_ROLES, MODEL_ROLE_INFO, LOCAL_PRESETS, BALANCE_OPTIONS,
  apiLabel, formatCapabilities, credentialRefLabel, flattenModels, balanceLabel,
  mergeDiscoveredModels, parseModelRole, resolveRoleView, validateBindingView,
  updateBindingView, summary, emptyProviderDraft, providerToDraft, draftToProvider,
  validateDraft, upsertProviderView, removeProviderView, autoBindRoles, keyRefFor,
  type ModelsState, type RoleBindingView, type ProviderDraft, type BalanceStrategy,
  type DiscoveredView,
} from './models-view.ts'

export interface ProbeView {
  ok: boolean
  label: string
  detail?: string
}

export interface CredentialResult { stored: boolean; reason?: string }

/** 界面与宿主之间的接口（models-app.ts 用 fetch + shellApi 实现）。 */
export interface DiscoverSpec {
  providerId?: string
  id?: string
  displayName?: string
  api?: string
  baseURL?: string
  apiKeyEnv?: string
}
export interface DiscoverResult { ok: boolean; models?: DiscoveredView[]; label?: string }

export interface ModelsHost {
  load(): Promise<ModelsState>
  save(state: ModelsState): Promise<void>
  probe(providerId: string): Promise<ProbeView>
  applyPreset(preset: string): Promise<ModelsState>
  /** 把明文密钥写进系统安全存储；缺省表示当前环境（浏览器 demo）不支持。 */
  setCredential?(name: string, plain: string): Promise<CredentialResult>
  /** 从服务方的 /models 端点拉取模型列表；缺省表示无后端（demo）。 */
  discover?(spec: DiscoverSpec): Promise<DiscoverResult>
  notice(text: string): void
}

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] as string))

/**
 * 挂载模型管理面板。
 * @param root - #models-root 容器
 * @param host - 数据读写、自测、预设生成、密钥存储与状态提示
 */
export function mountModelsPanel(root: HTMLElement, host: ModelsHost): void {
  let state: ModelsState = { providers: [], bindings: [], demo: true }
  let draft: ProviderDraft | null = null
  let discovering = false
  const probeResults = new Map<string, ProbeView>()

  /* ---------- 表单 ---------- */
  const modelRows = (): string => (draft?.models ?? []).map((model, index) => `
    <div class="mfrow" data-mi="${index}">
      <input data-mf="id" value="${escapeHtml(model.id)}" placeholder="模型 id，如 gpt-4o" />
      <input data-mf="name" value="${escapeHtml(model.name)}" placeholder="显示名（可空）" />
      <input data-mf="contextWindow" type="number" min="1" value="${escapeHtml(model.contextWindow)}" title="上下文窗口" />
      <input data-mf="maxTokens" type="number" min="1" value="${escapeHtml(model.maxTokens)}" title="输出上限" />
      <input data-mf="reasoningEfforts" value="${escapeHtml(model.reasoningEfforts)}" placeholder="思考档位，逗号分隔" />
      <button type="button" class="mfdel" data-act="del-model" data-index="${index}" title="删除该模型">×</button>
    </div>`).join('')

  const renderForm = (): void => {
    const form = root.querySelector<HTMLElement>('#models-form')
    if (form === null) return
    if (draft === null) { form.innerHTML = ''; form.classList.add('hidden'); return }
    form.classList.remove('hidden')
    const current = draft
    const options = API_OPTIONS.map(option =>
      `<option value="${option.value}"${option.value === current.api ? ' selected' : ''}>${escapeHtml(option.label)}</option>`).join('')
    const hint = API_OPTIONS.find(option => option.value === current.api)?.hint ?? ''
    const editing = current.editingId !== ''
    form.innerHTML = `
      <div class="mfhead">
        <strong>${editing ? '编辑服务' : '新增服务'}</strong>
        <span class="mfh-save-note">密钥经系统安全存储加密，配置里只留引用名</span>
      </div>
      <div class="mfgrid">
        <label>协议<select data-field="api">${options}</select></label>
        <label>显示名<input data-field="displayName" value="${escapeHtml(draft.displayName)}" placeholder="如 DeepSeek 官方" /></label>
        <label>服务 id<input data-field="id" value="${escapeHtml(draft.id)}" placeholder="如 deepseek" ${editing ? 'readonly' : ''} /></label>
        <label>接口地址<input data-field="baseURL" value="${escapeHtml(draft.baseURL)}" placeholder="http://127.0.0.1:7864/v1" /></label>
        <label>权重<input data-field="weight" type="number" min="1" max="100" value="${escapeHtml(current.weight)}" title="仅「加权」策略生效" /></label>
        <label class="mfcheck"><input data-field="enabled" type="checkbox" ${current.enabled ? 'checked' : ''} /> 参与负载均衡</label>
        <label class="mf-wide">API Key<input data-field="apiKey" type="password" value="${escapeHtml(draft.apiKey)}" placeholder="${editing ? '留空表示不改动' : '粘贴密钥原文；本地模型可留空'}" autocomplete="off" /></label>
      </div>
      <p class="mfhint">${escapeHtml(hint)}${editing ? '' : ` · 密钥将存为 <code>${escapeHtml(keyRefFor(draft.id || 'model'))}</code>`}</p>
      <div class="mfmodels-head"><span>支持的模型（自动拉取后仍可逐项修改）</span>
        <button type="button" data-act="discover" ${discovering ? 'disabled' : ''}>${discovering ? '获取中…' : '↓ 自动获取模型'}</button>
        <button type="button" data-act="add-model">+ 添加模型</button>
      </div>
      <div class="mfcolhead"><span>id</span><span>显示名</span><span>上下文</span><span>输出上限</span><span>思考档位</span><span></span></div>
      ${modelRows()}
      <div class="mfbtns">
        <button type="button" class="mf-primary" data-act="save">保存服务</button>
        <button type="button" data-act="cancel">取消</button>
      </div>`
  }

  const collectForm = (): void => {
    if (draft === null) return
    for (const field of root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('#models-form [data-field]')) {
      const key = field.dataset.field
      if (key === undefined) continue
      const value = field instanceof HTMLInputElement && field.type === 'checkbox' ? field.checked : field.value
      Object.assign(draft, { [key]: value })
    }
    for (const row of root.querySelectorAll<HTMLInputElement>('#models-form .mfrow')) {
      const index = Number(row.dataset.mi)
      const model = draft.models[index]
      if (model === undefined) continue
      for (const input of row.querySelectorAll<HTMLInputElement>('[data-mf]')) {
        const key = input.dataset.mf
        if (key === undefined) continue
        Object.assign(model, { [key]: input.value })
      }
    }
  }

  const saveDraft = async (): Promise<void> => {
    if (draft === null) return
    collectForm()
    const errors = validateDraft(draft)
    if (errors.length > 0) { host.notice(`配置有误：${errors.join('；')}`); return }
    const plain = draft.apiKey.trim()
    const provider = draftToProvider(draft)
    if (plain !== '') {
      if (host.setCredential === undefined) {
        host.notice('当前为浏览器/demo 模式，无法安全存储密钥；请在桌面端填写，或改用 env 引用。')
        return
      }
      try {
        const result = await host.setCredential(provider.apiKeyEnv, plain)
        if (!result.stored) {
          host.notice(`密钥未能加密落盘（${result.reason ?? '未知原因'}），已停止保存以免配置失效。`)
          return
        }
      } catch (error) {
        host.notice(`保存密钥失败：${String(error).slice(0, 80)}`)
        return
      }
    }
    state = upsertProviderView(state, provider)
    if (state.bindings.length === 0) state = autoBindRoles(state)
    draft = null
    await host.save(state)
    host.notice(`已保存服务 ${provider.id}${plain !== '' ? ` · 密钥存为 ${escapeHtml(provider.apiKeyEnv)}` : ''}`)
    draw()
  }

  /** 从服务方 /models 拉取模型；已填写的行保留用户修改，只追加新模型。 */
  const discoverModels = async (): Promise<void> => {
    if (draft === null) return
    if (host.discover === undefined) {
      host.notice('当前为浏览器/demo 模式，无法自动获取；请在桌面端使用。')
      return
    }
    collectForm()
    const spec: DiscoverSpec = {
      ...(draft.editingId !== '' ? { providerId: draft.editingId } : {}),
      id: draft.id,
      displayName: draft.displayName,
      api: draft.api,
      baseURL: draft.baseURL,
      apiKeyEnv: keyRefFor(draft.id || 'model'),
    }
    discovering = true
    renderForm()
    try {
      const result = await host.discover(spec)
      if (!result.ok || result.models === undefined || result.models.length === 0) {
        host.notice(`未获取到模型：${result.label ?? '服务没有返回模型列表'}`)
        return
      }
      const before = draft.models.length
      draft.models = mergeDiscoveredModels(draft.models, result.models)
      host.notice(`已获取 ${result.models.length} 个模型（新增 ${draft.models.length - before} 个；已有模型保留你的修改）`)
    } catch (error) {
      host.notice(`获取模型失败：${String(error).slice(0, 80)}`)
    } finally {
      discovering = false
      renderForm()
    }
  }

  /* ---------- 列表与角色 ---------- */
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
        <span class="mmeta">${escapeHtml(provider.id)}</span>
        <span class="mprobe-api">${escapeHtml(apiLabel(provider.api))}</span>
        <span class="mlb">${provider.enabled === false ? '已停用' : `启用 · 权重 ${provider.weight ?? 1}`}</span>
        <span class="mspacer"></span>
        <button data-act="edit" data-provider="${escapeHtml(provider.id)}">编辑</button>
        <button data-act="delete" data-provider="${escapeHtml(provider.id)}">删除</button>
        <button data-act="probe" data-provider="${escapeHtml(provider.id)}">连通性自测</button>
        ${probeLabel}
      </div>
      <div class="mmeta">地址 ${escapeHtml(provider.baseURL)} · 凭据 ${escapeHtml(credentialRefLabel(provider.apiKeyEnv))}</div>
      <ul class="mmodels">${models || '<li class="empty">没有模型</li>'}</ul>
    </section>`
  }

  const recommendFor = (role: (typeof MODEL_ROLES)[number]): string | undefined =>
    autoBindRoles(state).bindings.find(item => item.role === role)?.modelId

  const roleRow = (role: (typeof MODEL_ROLES)[number]): string => {
    const resolved = resolveRoleView(state, role)
    const current = resolved === undefined ? '' : `${resolved.provider.id}|${resolved.model.id}`
    const options = flattenModels(state).map(item => {
      const value = `${item.providerId}|${item.model.id}`
      const label = `${item.providerName} / ${item.model.name || item.model.id}`
      return `<option value="${escapeHtml(value)}"${value === current ? ' selected' : ''}>${escapeHtml(label)}</option>`
    }).join('')
    const info = MODEL_ROLE_INFO[role]
    return `<div class="mrole-row">
      <div class="mrole-line"><label class="mrole" for="role-${role}"><span>${escapeHtml(info.label)}</span></label>
        <select id="role-${role}" data-role="${role}"><option value="">(未绑定)</option>${options}</select>
        <span class="mrec" data-rec="${role}"></span>
      </div>
      <p class="mrole-hint">${escapeHtml(info.hint)}</p>
    </div>`
  }

  const draw = (): void => {
    const presets = LOCAL_PRESETS.map(preset =>
      `<button data-act="preset" data-preset="${preset}">一键生成 ${preset} 预设</button>`).join(' ')
    const strategy = state.balance?.strategy ?? 'off'
    const balanceOptions = BALANCE_OPTIONS.map(option =>
      `<option value="${option.value}"${option.value === strategy ? ' selected' : ''}>${escapeHtml(option.label)}</option>`).join('')
    const balanceHint = BALANCE_OPTIONS.find(option => option.value === strategy)?.hint ?? ''
    const eligible = state.providers.filter(item => item.enabled !== false).length
    root.innerHTML = `
      <div class="mmbar">
        <strong>模型服务</strong>
        <span id="models-status">${escapeHtml(summary(state))}</span>
        <span class="mspacer"></span>
        ${state.demo ? '<span class="mdemo">demo（无后端，展示内置示例数据）</span>' : ''}
        <button data-act="new">+ 新增服务</button>
        <button data-act="auto">职责自动推荐</button>
        <button data-act="refresh">刷新</button>
      </div>
      <div id="models-notice" class="mnotice"></div>
      <div id="models-form" class="mform hidden"></div>
      <div class="msection">
        <h3>多服务负载均衡</h3>
        <p class="msec-hint">配好多个服务后在这里选分发策略；每个服务卡片里可单独开关、设权重。本页改动需重启宿主后生效。</p>
        <div class="mbalance">
          <label>分发策略 <select data-balance="strategy">${balanceOptions}</select></label>
          <span class="mrec">${escapeHtml(balanceHint)}</span>
          <span class="mmeta">${eligible} 个服务参与分发</span>
        </div>
      </div>
      <div class="msection">
        <h3>职责 → 模型</h3>
        <p class="msec-hint">不同职责可以选合适的模型；「自动推荐」会按能力标注帮你分配，仍可手动覆盖。</p>
        ${MODEL_ROLES.map(roleRow).join('')}
      </div>
      <div class="msection">
        <h3>本地预设</h3>
        <div class="mbtns">${presets}</div>
      </div>
      <div class="msection">
        <h3>已配置服务</h3>
        <div id="models-list">${state.providers.map(providerCard).join('') || '<div class="empty">还没有服务，点「+ 新增服务」开始。</div>'}</div>
      </div>
    `
    for (const role of MODEL_ROLES) {
      const rec = recommendFor(role)
      const el = root.querySelector<HTMLElement>(`[data-rec="${role}"]`)
      if (el !== undefined && el !== null && rec !== undefined) el.innerHTML = `<button data-act="apply-rec" data-role="${role}" data-model="${escapeHtml(rec)}">推荐 ${escapeHtml(rec)}</button>`
    }
    renderForm()
  }

  const refresh = async (): Promise<void> => {
    try {
      state = await host.load()
      probeResults.clear()
      draft = null
      draw()
    } catch (error) {
      host.notice(`读取模型库失败：${String(error).slice(0, 60)}`)
    }
  }

  root.addEventListener('input', event => {
    const target = event.target as HTMLElement
    if (target.closest('#models-form') !== null) collectForm()
  })

  root.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-act]')
    if (button === null) return
    const action = button.dataset.act
    if (action === 'refresh') { void refresh(); return }
    if (action === 'new') { collectForm(); draft = emptyProviderDraft(); draw(); return }
    if (action === 'edit') {
      const provider = state.providers.find(item => item.id === button.dataset.provider)
      if (provider === undefined) return
      collectForm()
      draft = providerToDraft(provider)
      draw()
      root.querySelector('#models-form')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      return
    }
    if (action === 'cancel') { draft = null; draw(); return }
    if (action === 'save') { void saveDraft(); return }
    if (action === 'discover') { void discoverModels(); return }
    if (action === 'add-model') {
      collectForm()
      draft?.models.push({ id: '', name: '', contextWindow: '128000', maxTokens: '8192', reasoningEfforts: '' })
      renderForm()
      return
    }
    if (action === 'del-model') {
      collectForm()
      if (draft !== null && draft.models.length > 1) draft.models.splice(Number(button.dataset.index), 1)
      renderForm()
      return
    }
    if (action === 'delete') {
      const id = button.dataset.provider ?? ''
      state = removeProviderView(state, id)
      void host.save(state).then(() => { host.notice(`已删除服务 ${id}`); draw() })
      return
    }
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
        if (state.bindings.length === 0) state = autoBindRoles(state)
        host.notice(`已生成 ${preset} 预设`)
        draw()
      }).catch(error => host.notice(`生成预设失败：${String(error).slice(0, 60)}`))
      return
    }
    if (action === 'auto') {
      state = autoBindRoles(state)
      void host.save(state).then(() => { host.notice('已按能力标注为各职责推荐模型'); draw() })
      return
    }
    if (action === 'apply-rec') {
      const role = parseModelRole(button.dataset.role ?? '')
      const modelId = button.dataset.model ?? ''
      if (role === undefined || modelId === '') return
      const flat = flattenModels(state).find(item => item.model.id === modelId)
      if (flat === undefined) return
      const binding: RoleBindingView = { role, providerId: flat.providerId, modelId }
      if (validateBindingView(state, binding).length > 0) return
      state = updateBindingView(state, binding)
      void host.save(state).then(() => { host.notice(`${MODEL_ROLE_INFO[role].label} 已绑定 ${modelId}`); draw() })
    }
  })

  root.addEventListener('change', event => {
    const select = event.target as HTMLSelectElement
    if (select.dataset.balance === 'strategy') {
      const next = select.value as BalanceStrategy
      state = { ...state, balance: { strategy: next } }
      void host.save(state).then(() => {
        host.notice(`负载均衡已设为「${balanceLabel(next)}」，重启宿主后生效`)
        draw()
      })
      return
    }
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
    void host.save(state).then(() => { host.notice(`${MODEL_ROLE_INFO[role].label} 已绑定`); draw() })
  })

  void refresh()
}
