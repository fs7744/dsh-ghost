#!/usr/bin/env node
/**
 * 验收「用户用配置扩展界面 + 登记 LLM 服务」这条链路。
 *
 * 1) 在 `.ghost/ui/` 放面板清单、插槽清单、provider 规格（就是用户会做的事）；
 * 2) 起宿主（profile 由模板渲染，providers.json 会被注入 llm-pi-ai.providers）；
 * 3) 断言：ghostUI/panels 能读到面板、ghostUI/slots 能读到插槽、
 *    ghostUI/providers 能读到服务、session/modelCatalog 里能看到新登记的 provider。
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { boot, stop, login, createTransport, readProxyEnv } from './lib-driver.mjs'

const REPO = join(import.meta.dirname, '..')
const UI_ROOT = join(REPO, '.ghost', 'ui')
const PANEL_DIR = join(UI_ROOT, 'panels')
const SLOT_DIR = join(UI_ROOT, 'slots')
const PROVIDERS_FILE = join(UI_ROOT, 'providers.json')

let failures = 0
const check = (ok, message) => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${message}\n`)
  if (!ok) failures += 1
}

const created = []
const ensureDir = (dir) => {
  mkdirSync(dir, { recursive: true })
  created.push(dir)
}

try {
  // —— 用户做的事：放配置 ——
  ensureDir(PANEL_DIR)
  ensureDir(SLOT_DIR)
  writeFileSync(join(PANEL_DIR, 'demo.json'), JSON.stringify({
    id: 'demo-panel',
    title: '示例面板',
    source: { endpoint: 'ghostTickets/list', args: {} },
    columns: ['stage'],
  }))
  writeFileSync(join(SLOT_DIR, 'demo.json'), JSON.stringify({
    slot: 'chat.toolbar',
    label: '示例按钮',
    endpoint: 'ghostTickets/list',
    args: {},
  }))
  writeFileSync(join(UI_ROOT, 'custom.css'), ':root { --accent: #ff0000; }\n')
  writeFileSync(join(UI_ROOT, 'proxy.json'), JSON.stringify({
    http: 'http://127.0.0.1:7890', noProxy: 'localhost',
  }))
  writeFileSync(PROVIDERS_FILE, JSON.stringify([{
    id: 'demo-local',
    displayName: 'Demo Local',
    api: 'openai-completions',
    baseURL: 'http://127.0.0.1:11434/v1',
    apiKeyEnv: 'DEMO_LOCAL_KEY',
    models: [{ id: 'demo-model', capabilities: { contextWindow: 32768, maxTokens: 8192, reasoningEfforts: [] } }],
  }], null, 2))
  created.push(PROVIDERS_FILE)

  // 宿主只在凭据 env 存在时才把 provider 列进目录（这是宿主的行为，也正好说明
  // 「凭据只认 env 名」这条规矩是端到端生效的）。
  process.env.DEMO_LOCAL_KEY = 'dummy-for-verification'

  let server
  try {
    server = await boot({ profile: 'p05', fromDefault: false })
    const session = await login(server.url, 'none')
    const transport = createTransport({ ...session, onError: error => process.stdout.write(`WARN  ${String(error)}\n`) })

    const panels = await transport.call('ghostUI/panels', {}).catch(error => ({ error: String(error) }))
    const panelList = Array.isArray(panels?.panels) ? panels.panels : []
    check(panelList.some(panel => panel.id === 'demo-panel'), 'ghostUI/panels 读到了用户放的面板')

    const slots = await transport.call('ghostUI/slots', {}).catch(error => ({ error: String(error) }))
    const slotList = Array.isArray(slots?.slots) ? slots.slots : []
    check(slotList.some(slot => slot.label === '示例按钮'), 'ghostUI/slots 读到了用户放的插槽')

    const providers = await transport.call('ghostUI/providers', {}).catch(error => ({ error: String(error) }))
    const providerList = Array.isArray(providers?.providers) ? providers.providers : []
    check(providerList.some(provider => provider.id === 'demo-local'), 'ghostUI/providers 读到了登记的 LLM 服务')

    const css = await transport.call('ghostUI/customCss', {}).catch(() => undefined)
    check(String(css?.css ?? '').includes('--accent'), 'ghostUI/customCss 读到了用户放的自定义皮肤')

    const proxySaved = await transport.call('ghostUI/proxySave', {
      input: { proxy: { http: 'http://127.0.0.1:7890', noProxy: 'localhost' } },
    }).catch(() => undefined)
    check(proxySaved?.ok === true, 'ghostUI/proxySave 接受了合法的代理配置')
    const proxyEnv = readProxyEnv(UI_ROOT)
    check(proxyEnv.HTTP_PROXY === 'http://127.0.0.1:7890' && proxyEnv.NO_PROXY === 'localhost',
      '代理配置被翻译成宿主进程要的 env（HTTP_PROXY / NO_PROXY）')

    const catalog = await transport.call('session/modelCatalog', {}).catch(() => undefined)
    const groups = Array.isArray(catalog?.groups) ? catalog.groups : []
    const found = groups.some(group => Array.isArray(group.models)
      && group.models.some(model => model.id === 'demo-model'))
    check(found, '新登记的 provider 已经进了宿主的模型目录（下次启动生效的链路打通）')
  } finally {
    if (server !== undefined) await stop(server.child)
  }
} catch (error) {
  failures += 1
  process.stdout.write(`FAIL  ${String(error)}\n`)
} finally {
  for (const path of created) rmSync(path, { recursive: true, force: true })
}

process.stdout.write(`\n${failures === 0 ? 'UI 扩展验收通过' : `${failures} 项失败`}\n`)
process.exit(failures === 0 ? 0 : 1)
