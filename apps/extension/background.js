/**
 * dsh-ghost 扩展后台（service worker）。
 *
 * 职责：配对、调用宿主 API、给侧栏提供消息。
 *
 * 配对流程（设备码式）：
 *  1. 应用界面显示 6 位配对码与应用地址；
 *  2. 用户在侧栏填地址 + 码 → 这里 POST {appUrl}/extension/pair；
 *  3. 壳校验码，换出宿主地址与 Cookie → 这里把 Cookie 写进浏览器（chrome.cookies），
 *     之后所有请求都用 credentials:'include'，**token 不进扩展**。
 */
const STORAGE_KEY = 'dshGhost'

async function readState() {
  const stored = await chrome.storage.local.get(STORAGE_KEY)
  return stored[STORAGE_KEY] ?? { origin: '', appUrl: '', sessionId: '', cwd: '' }
}

async function writeState(patch) {
  const current = await readState()
  const next = { ...current, ...patch }
  await chrome.storage.local.set({ [STORAGE_KEY]: next })
  return next
}

/** 调宿主的一个 Remote 方法（typert 网关的 client-request 形状）。 */
async function api(state, method, args) {
  const response = await fetch(`${state.origin}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      type: 'client-request',
      rpcId: `ext-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      method,
      payload: { args },
    }),
  })
  const text = await response.text()
  let envelope
  try {
    envelope = JSON.parse(text)
  } catch {
    throw new Error(`${method} 返回非 JSON（HTTP ${response.status}）`)
  }
  if (envelope?.result?.ok !== true) {
    throw new Error(`${method} 失败：${envelope?.result?.error?.message ?? '未知错误'}`)
  }
  return envelope.result.value
}

/** 记录里的文本 → 气泡（只取用户/助手消息）。 */
function bubbles(records) {
  const out = []
  for (const record of records ?? []) {
    const event = record?.event
    if (event === undefined) continue
    const data = event.data ?? {}
    if (event.type === 'user/message') {
      const text = (data.content ?? []).filter(part => part.type === 'text').map(part => part.text ?? '').join('\n')
      if (text !== '') out.push({ kind: 'user', text })
    } else if (event.type === 'assistant/message') {
      const parts = data.message?.content ?? []
      const text = parts.filter(part => part.type === 'text').map(part => part.text ?? '').join('')
      if (text !== '') out.push({ kind: 'assistant', text })
    }
  }
  return out
}

async function pair({ appUrl, code }) {
  const base = String(appUrl ?? '').trim().replace(/\/+$/, '')
  if (base === '') throw new Error('请填写应用地址')
  const response = await fetch(`${base}/extension/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: String(code ?? '').trim() }),
  })
  if (!response.ok) throw new Error('配对码无效或已过期')
  const { origin, cookieName, cookieValue, cwd } = await response.json()
  // Cookie 写进浏览器：之后 fetch 带 credentials 即可，扩展不保存 token。
  await chrome.cookies.set({
    url: origin,
    name: cookieName,
    value: cookieValue,
    path: '/',
    expirationDate: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
  })
  const state = await writeState({ origin, appUrl: base, cwd, sessionId: '' })
  const created = await api(state, 'session/create', { request: { cwd } })
  const sessionId = created?.sessionId ?? ''
  return writeState({ sessionId })
}

async function prompt({ text }) {
  const state = await readState()
  if (state.origin === '') throw new Error('还没配对')
  if (state.sessionId === '') throw new Error('还没有会话')
  await api(state, 'session/prompt', {
    request: {
      requestId: `ext-${Date.now()}`,
      sessionId: state.sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: String(text ?? '') }],
    },
  })
  return { ok: true }
}

async function page() {
  const state = await readState()
  if (state.origin === '' || state.sessionId === '') return { bubbles: [] }
  const result = await api(state, 'session/page', {
    request: { address: { kind: 'session', sessionId: state.sessionId }, maxMessages: 60 },
  })
  return { bubbles: bubbles(result?.records ?? []) }
}

async function status() {
  const state = await readState()
  return { paired: state.origin !== '', origin: state.origin, sessionId: state.sessionId, appUrl: state.appUrl }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = {
    pair,
    prompt,
    page,
    status,
  }[message?.type]
  if (handler === undefined) return false
  Promise.resolve(handler(message.payload ?? {}))
    .then(value => sendResponse({ ok: true, value }))
    .catch(error => sendResponse({ ok: false, error: String(error?.message ?? error) }))
  return true
})

chrome.action.onClicked.addListener(tab => {
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {
    // 老版本 Chrome 没有 sidePanel API，忽略即可（用户可用右键菜单打开）。
  })
})
