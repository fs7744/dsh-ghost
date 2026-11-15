#!/usr/bin/env node
/**
 * 桌面壳静态自检（C6 发布门禁）：不启动 Electron、不联网、不 npm install。
 *
 * 根脚本名映射（由集成者登记到根 package.json）：
 *   - verify:shell  -> node --experimental-transform-types scripts/verify-shell.mjs
 *   - release:check -> node --experimental-transform-types scripts/verify-shell.mjs --only=version
 *   - test:shell    -> node --test --experimental-transform-types apps/shell/tests/*.test.ts
 *   - build:shell   -> npx tsc -p apps/shell/tsconfig.build.json
 *
 * 检查项：装配文件齐全、electron import 仅在适配层、preload 不暴露 ipcRenderer、
 * CSP 不含 unsafe-eval、核心纯模块零 DOM、builder 目标 Windows x64、
 * 发布流水线 --publish never、诊断脱敏零命中、版本一致性。
 * 任一项失败退出码 1。
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectDiagnostics } from '../apps/shell/src/diagnostics.ts'

const REPO = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const SHELL = join(REPO, 'apps', 'shell')
const SRC = join(SHELL, 'src')

const onlyArg = process.argv.find(a => a.startsWith('--only='))
const only = onlyArg === undefined ? null : onlyArg.slice('--only='.length)

const results = []

function check(name, fn) {
  if (only !== null && name !== only && !(only === 'version' && name === 'version')) return
  try {
    fn()
    results.push({ name, ok: true })
  } catch (error) {
    results.push({ name, ok: false, error: String(error && error.message ? error.message : error) })
  }
}

function read(path) {
  return readFileSync(path, 'utf8')
}

// --- 1. 装配文件齐全 ---------------------------------------------------------
const REQUIRED = [
  'src/main.ts', 'src/ports.ts', 'src/config.ts', 'src/runtime.ts', 'src/urls.ts',
  'src/single-instance.ts', 'src/diagnostics.ts', 'src/onboarding.ts', 'src/updater.ts',
  'src/credentials.ts', 'src/i18n.ts', 'src/window-state.ts', 'src/telemetry.ts',
  'src/static-server.ts', 'preload.cjs', 'src/electron-app.ts',
  'src/electron-window.ts', 'src/electron-tray.ts', 'src/electron-menu.ts',
  'src/electron-ipc.ts', 'src/electron-safe-storage.ts', 'src/electron-updater.ts',
  'src/electron-static.ts', 'src/electron-host-launcher.ts', 'src/electron-platform.ts',
  'onboarding.html', 'about.html', 'package.json', 'tsconfig.json', 'tsconfig.build.json',
]
check('files', () => {
  const missing = REQUIRED.filter(rel => !existsSync(join(SHELL, rel)))
  if (missing.length > 0) throw new Error('缺失: ' + missing.join(', '))
})

// --- 2. electron import 仅在 electron-*.ts -----------------------------------
check('electron-boundary', () => {
  for (const file of readdirSync(SRC)) {
    if (!file.endsWith('.ts') || file.endsWith('.d.ts')) continue
    const text = read(join(SRC, file))
    const importsElectron = /from ['"](electron|electron-updater)['"]/.test(text)
    if (importsElectron && !file.startsWith('electron-')) {
      throw new Error(`${file} 含 electron import 但不是适配层`)
    }
  }
})

// --- 3. preload 不暴露 ipcRenderer 本体 --------------------------------------
check('preload', () => {
  const text = read(join(SHELL, 'preload.cjs'))
  const dangerous = [
    /exposeInMainWorld\(\s*['"]ipcRenderer['"]/,
    /exposeInMainWorld\([^)]*,\s*ipcRenderer\s*\)/,
    /window\.ipcRenderer\s*=/,
    /globalThis\.ipcRenderer\s*=/,
    /\bipcRenderer\s*:/,
    /=\s*ipcRenderer\s*[,;]/,
  ]
  for (const re of dangerous) {
    if (re.test(text)) throw new Error('preload 暴露 ipcRenderer: ' + String(re))
  }
  if (!/contextBridge\.exposeInMainWorld\(\s*['"]shellApi['"]/.test(text)) {
    throw new Error('未通过 contextBridge 暴露 shellApi')
  }
})

// --- 4. CSP 与窗口安全 -------------------------------------------------------
check('csp', () => {
  const text = read(join(SRC, 'electron-window.ts'))
  const start = text.indexOf('export const CONTENT_SECURITY_POLICY')
  const end = text.indexOf(".join('; ')", start)
  if (start < 0 || end < 0) throw new Error('找不到 CSP 常量定义')
  // 只检查常量本体，避免注释里提到该词造成误判。
  const csp = text.slice(start, end)
  if (/unsafe-eval/.test(csp)) throw new Error('CSP 含 unsafe-eval')
  if (!/default-src 'self'/.test(csp)) throw new Error("CSP 缺少 default-src 'self'")
  if (!/nodeIntegration:\s*false/.test(text)) throw new Error('未关闭 nodeIntegration')
  if (!/contextIsolation:\s*true/.test(text)) throw new Error('未打开 contextIsolation')
})

// --- 5. 核心纯模块零 DOM -----------------------------------------------------
check('pure-modules', () => {
  const pure = [
    'config.ts', 'runtime.ts', 'urls.ts', 'single-instance.ts', 'diagnostics.ts',
    'onboarding.ts', 'updater.ts', 'credentials.ts', 'i18n.ts', 'window-state.ts',
    'telemetry.ts', 'static-server.ts',
  ]
  for (const file of pure) {
    const text = read(join(SRC, file))
    if (/from ['"](electron|electron-updater)['"]/.test(text)) throw new Error(`${file} import electron`)
    if (/\bdocument\.|\bwindow\./.test(text)) throw new Error(`${file} 含 DOM 访问`)
  }
})

// --- 6. builder 目标 Windows x64 ---------------------------------------------
check('builder-platforms', () => {
  const path = join(REPO, 'build', 'electron-builder.yml')
  if (!existsSync(path)) throw new Error('缺 build/electron-builder.yml')
  const raw = read(path)
  const noComments = raw.split('\n').filter(line => !line.trim().startsWith('#')).join('\n')
  if (!/^\s*win:/m.test(noComments)) throw new Error('缺少 win 配置')
  if (!/target:\s*nsis/.test(noComments)) throw new Error('缺少 nsis target')
  if (!/^\s*mac:/m.test(noComments)) throw new Error('缺少 mac 配置')
  if (!/^\s*linux:/m.test(noComments)) throw new Error('缺少 linux 配置')
  if (!/\bdmg\b/.test(noComments)) throw new Error('mac 缺少 dmg target')
  if (!/\bAppImage\b/.test(noComments)) throw new Error('linux 缺少 AppImage target')
  if (!/-\s*x64/.test(noComments) || !/-\s*arm64/.test(noComments)) {
    throw new Error('至少要有 x64 与 arm64 架构声明')
  }
})

// --- 6.5 三平台图标产物齐全且容器头正确 --------------------------------
check('icons', () => {
  const dir = join(REPO, 'build', 'resources')
  for (const name of ['icon.ico', 'icon.icns', 'icon.png', 'trayTemplate.png', 'trayTemplate@2x.png']) {
    if (!existsSync(join(dir, name))) throw new Error(`缺图标: ${name}`)
  }
  const ico = readFileSync(join(dir, 'icon.ico'))
  if (ico.readUInt16LE(2) !== 1 || ico.readUInt16LE(4) < 5) throw new Error('icon.ico 不是多尺寸 ICO')
  const icns = readFileSync(join(dir, 'icon.icns'))
  if (icns.toString('ascii', 0, 4) !== 'icns' || icns.readUInt32BE(4) !== icns.length) {
    throw new Error('icon.icns 容器头不对')
  }
})

// --- 7. 发布流水线只产出不发布 -----------------------------------------------
check('release-workflow', () => {
  const path = join(REPO, '.github', 'workflows', 'release.yml')
  if (!existsSync(path)) throw new Error('缺 .github/workflows/release.yml')
  const text = read(path)
  if (!/platform: win/.test(text) || !/platform: mac/.test(text) || !/platform: linux/.test(text)) {
    throw new Error('流水线缺平台矩阵（win / mac / linux）')
  }
  if (!/--publish never/.test(text)) throw new Error('流水线未禁用发布')
  if (!/npm run build:shell/.test(text)) throw new Error('流水线未用 build:shell bundle')
})

// --- 8. 诊断包脱敏零命中（等价于 diagnostics.test.ts 口径） -------------------
check('diagnostics-redaction', () => {
  const token = 'tk_VERIFY_FAKE_9f8a'
  // 运行时拼接，避免仓库里出现密钥字面量（密钥扫描会把字面量当真）。
  const key = ['sk', 'verify', 'FAKEKEY', '123456'].join('-')
  const cookie = 'api_session=VERIFYFAKECOOKIE'
  const secrets = [token, key, cookie]
  const collector = {
    versions: () => ({ product: '0.0.0', shell: '0.0.0', electron: '44', chromium: '1', node: `runtime-${token}` }),
    logTail: () => `GET /?token=${token}\nCookie: ${cookie}\nkey=${key}`,
    hostHealth: () => ({ ok: true, state: 'healthy', port: 41_000, restartCount: 0 }),
    tickets: () => [{ id: 't1', note: `apiKey=${key}` }],
    environment: () => ({ WB_KEY: key, cookie, token, safe: 'ok' }),
    knownSecrets: () => secrets,
  }
  const bundle = collectDiagnostics(collector, { now: () => 0 })
  const combined = bundle.files.map(f => f.content).join('\n') + Buffer.from(bundle.zip).toString('latin1')
  for (const secret of secrets) {
    if (combined.includes(secret)) throw new Error('脱敏泄漏: ' + secret)
  }
  if (bundle.files.length < 5) throw new Error('诊断包文件清单过少')
})

// --- 9. 版本一致性（根 / shell / RELEASE.md changelog 标记） -----------------
check('version', () => {
  const root = JSON.parse(read(join(REPO, 'package.json'))).version
  const shell = JSON.parse(read(join(SHELL, 'package.json'))).version
  const release = read(join(REPO, 'docs', 'RELEASE.md'))
  const match = /<!--\s*SHELL_VERSION:\s*([^\s]+)\s*-->/.exec(release)
  if (match === null) throw new Error('RELEASE.md 缺 SHELL_VERSION 标记')
  const changelog = match[1]
  if (!(root === shell && shell === changelog)) {
    throw new Error(`版本不一致: root=${root} shell=${shell} changelog=${changelog}`)
  }
})

for (const result of results) {
  process.stdout.write(`${result.ok ? 'OK  ' : 'FAIL'} ${result.name}${result.ok ? '' : ' -> ' + result.error}\n`)
}
const failed = results.filter(r => !r.ok)
if (failed.length > 0) {
  process.stderr.write(`verify-shell 失败 ${failed.length} 项\n`)
  process.exit(1)
}
process.stdout.write(`verify-shell 通过 ${results.length} 项\n`)
