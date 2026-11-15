/**
 * 侧栏：配对 + 对话。
 *
 * 发送后轮询会话记录（宿主没有推给扩展的通道；扩展用轮询，简单可靠）。
 */
const stateEl = document.getElementById('state')
const pairEl = document.getElementById('pair')
const streamEl = document.getElementById('stream')
const inputEl = document.getElementById('input')
const errorEl = document.getElementById('pair-error')

let paired = false
let polling = false
let lastCount = -1

const call = async (type, payload) => {
  const response = await chrome.runtime.sendMessage({ type, payload })
  if (response?.ok !== true) throw new Error(response?.error ?? '调用失败')
  return response.value
}

const addBubble = (kind, text) => {
  const node = document.createElement('div')
  node.className = `bubble ${kind}`
  node.textContent = text
  streamEl.appendChild(node)
  streamEl.scrollTop = streamEl.scrollHeight
}

const refreshStatus = async () => {
  const status = await call('status')
  paired = status.paired === true
  stateEl.textContent = paired ? '已配对' : '未配对'
  pairEl.classList.toggle('hidden', paired)
  return status
}

const refreshMessages = async () => {
  if (!paired) return
  const { bubbles } = await call('page')
  if (bubbles.length === lastCount) return
  if (lastCount === -1) {
    streamEl.innerHTML = ''
    lastCount = 0
  }
  // 只渲染新增的部分。
  for (const bubble of bubbles.slice(lastCount)) addBubble(bubble.kind, bubble.text)
  lastCount = bubbles.length
}

const poll = async () => {
  if (polling) return
  polling = true
  try {
    for (let i = 0; i < 120; i += 1) {
      await refreshMessages()
      await new Promise(resolve => setTimeout(resolve, 1500))
    }
  } finally {
    polling = false
  }
}

document.getElementById('toggle-pair').addEventListener('click', () => {
  pairEl.classList.toggle('hidden')
})

document.getElementById('do-pair').addEventListener('click', async () => {
  errorEl.textContent = ''
  try {
    await call('pair', {
      appUrl: document.getElementById('app-url').value,
      code: document.getElementById('code').value,
    })
    lastCount = -1
    await refreshStatus()
    streamEl.innerHTML = ''
  } catch (error) {
    errorEl.textContent = String(error?.message ?? error)
  }
})

const send = async () => {
  const text = inputEl.value.trim()
  if (text === '') return
  inputEl.value = ''
  addBubble('user', text)
  try {
    await call('prompt', { text })
    void poll()
  } catch (error) {
    addBubble('error', String(error?.message ?? error))
  }
}

document.getElementById('send').addEventListener('click', () => { void send() })
inputEl.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    void send()
  }
})

void (async () => {
  await refreshStatus()
  await refreshMessages()
})()
