/**
 * dsh-ghost 扩展后台（service worker）。
 *
 * 职责：
 *  1. 配对（设备码式：应用出 6 位码 → 换宿主地址与 Cookie；token 不进扩展）；
 *  2. 采集**当前标签页**的快照（标题/网址/可见文本）上报给宿主；
 *  3. 轮询宿主的命令队列，用 chrome.debugger 在**当前标签页**上执行
 *     （点可见文字、填输入框、读页面、截图）。
 *
 * 为什么用 chrome.debugger 而不是注入脚本：扩展注入脚本会与页面共用
 * 同一个 JS 世界（页面能反过来调我们的函数），而 debugger 走 CDP，
 * 页面看不见我们，权限边界更清楚。
 */

const STORAGE_KEY = 'dshGhost'
const DEBUGGER_VERSION = '1.3'

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

/** 当前活动标签页。 */
async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  return tabs?.[0]
}

/** 挂上调试器（用完就摘，避免一直显示「正在被调试」提示条）。 */
async function withDebugger(tabId, fn) {
  const target = { tabId }
  const already = await chrome.debugger.getTargets().catch(() => [])
  const attached = already.some(item => item.tabId === tabId && item.attached)
  if (!attached) await chrome.debugger.attach(target, DEBUGGER_VERSION)
  try {
    return await fn()
  } finally {
    if (!attached) await chrome.debugger.detach(target).catch(() => {})
  }
}

/** CDP 求值。 */
async function evaluate(tabId, expression) {
  return withDebugger(tabId, async () => {
    const response = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    return response?.result?.value
  })
}

/** 采集当前页面快照（标题/网址/可见文本）。 */
async function collectSnapshot() {
  const tab = await activeTab()
  if (tab?.id === undefined) return undefined
  const value = await evaluate(tab.id, `(() => {
    const body = document.body;
    return {
      title: document.title || '',
      url: location.href,
      text: body ? (body.innerText || body.textContent || '').slice(0, 20000) : '',
    };
  })()`)
  if (typeof value !== 'object' || value === null) return undefined
  return { url: String(value.url ?? ''), title: String(value.title ?? ''), text: String(value.text ?? ''), at: Date.now() }
}

/** 上报快照给宿主。 */
async function reportSnapshot() {
  const state = await readState()
  if (state.origin === '' || state.sessionId === '') return undefined
  const snapshot = await collectSnapshot()
  if (snapshot === undefined) return undefined
  await api(state, 'ghostPage/register', { sessionId: state.sessionId, snapshot }).catch(() => undefined)
  return snapshot
}

/** 执行一条命令（在当前标签页上）。 */
async function executeCommand(command) {
  const tab = await activeTab()
  if (tab?.id === undefined) return { ok: false, message: '没有可用的标签页。' }

  if (command.action === 'read') {
    const snapshot = await collectSnapshot()
    if (snapshot === undefined) return { ok: false, message: '读不到页面。' }
    await reportSnapshot()
    return { ok: true, message: `已读取「${snapshot.title}」（${snapshot.url}）。` }
  }

  if (command.action === 'screenshot') {
    const data = await withDebugger(tab.id, async () => {
      const response = await chrome.debugger.sendCommand({ tabId: tab.id }, 'Page.captureScreenshot', { format: 'png' })
      return response?.data
    })
    if (typeof data !== 'string') return { ok: false, message: '截图失败。' }
    return { ok: true, message: '已截图。', data }
  }

  const target = String(command.target ?? '').trim()
  if (target === '') return { ok: false, message: '缺少 target。' }

  if (command.action === 'click') {
    // 先当 CSS 选择器试；不是选择器就按可见文字找可点击元素。
    const outcome = await evaluate(tab.id, `(() => {
      const target = ${JSON.stringify(target)};
      const bySelector = (() => { try { return document.querySelector(target); } catch { return null; } })();
      if (bySelector) { bySelector.scrollIntoView({block:'center'}); bySelector.click(); return 'clicked-selector'; }
      const candidates = Array.from(document.querySelectorAll('a,button,[role=button],input[type=submit],[onclick]'));
      const hit = candidates.find(el => {
        const text = (el.innerText || el.value || '').trim();
        return text === target || text.includes(target);
      });
      if (!hit) return 'not-found';
      hit.scrollIntoView({block:'center'});
      hit.click();
      return 'clicked-text';
    })()`)
    if (outcome === 'not-found') return { ok: false, message: `当前页面找不到「${target}」。` }
    return { ok: true, message: `已点击「${target}」（${outcome}）。` }
  }

  if (command.action === 'fill') {
    const value = String(command.value ?? '')
    const outcome = await evaluate(tab.id, `(() => {
      const el = document.querySelector(${JSON.stringify(target)});
      if (!el) return 'not-found';
      el.focus();
      const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value');
      if (setter && setter.set) setter.set.call(el, ${JSON.stringify(value)});
      else el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return 'filled';
    })()`)
    if (outcome === 'not-found') return { ok: false, message: `当前页面找不到输入框 ${target}。` }
    return { ok: true, message: `已填入 ${target}。` }
  }

  return { ok: false, message: `未知动作：${command.action}` }
}

/** 轮询宿主命令队列（长轮询：宿主最多挂 20 秒）。 */
async function pollLoop() {
  const state = await readState()
  if (state.origin === '' || state.sessionId === '') return
  let payload
  try {
    payload = await api(state, 'ghostPage/next', { sessionId: state.sessionId })
  } catch {
    await new Promise(resolve => setTimeout(resolve, 3000))
    return
  }
  const command = payload?.command
  if (command === undefined) return
  const result = await executeCommand(command).catch(error => ({ ok: false, message: String(error?.message ?? error) }))
  await api(state, 'ghostPage/result', { sessionId: state.sessionId, result: { id: command.id, ...result } })
    .catch(() => undefined)
}

/** 一直轮询命令队列（每轮结束立刻接下一轮）。 */
async function loopForever() {
  for (;;) {
    try {
      await pollLoop()
    } catch {
      await new Promise(resolve => setTimeout(resolve, 3000))
    }
  }
}

/** 配对。 */
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
  const next = await writeState({ sessionId })
  await reportSnapshot()
  void loopForever()
  return next
}

async function prompt({ text }) {
  const state = await readState()
  if (state.origin === '') throw new Error('还没配对')
  if (state.sessionId === '') throw new Error('还没有会话')
  // 发消息前刷新一次页面快照：模型就能知道「当前页面」是什么。
  await reportSnapshot()
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

async function status() {
  const state = await readState()
  return { paired: state.origin !== '', origin: state.origin, sessionId: state.sessionId, appUrl: state.appUrl }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = { pair, prompt, page, status, reportSnapshot }[message?.type]
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
