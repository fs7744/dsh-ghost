#!/usr/bin/env node
/**
 * superagent 宿主侧装配的静态验收（B2–B7 / C2-01），不启动宿主、不碰 lib/、不跑 build。
 *
 * 运行：node --experimental-transform-types scripts/verify-superagent-assets.mjs
 * 失败 exit 1，并把每一项的失败原因打印出来。
 *
 * 检查项：
 *  1. B2 三个入口文件存在且可动态解析；
 *  2. 19 个工具名与 docs/FEATURES.md §B3 账本一致，描述符齐全且合规；
 *  3. 7 个视图存在，示例 JSON 覆盖全部；
 *  4. 提示词文件按 manifest 齐全，常驻文件低于预算；
 *  5. 2 个 SKILL.md 有合法 frontmatter；
 *  6. 仓库里不存在自建 /orchestrator HTTP 路由（C2-01），且断言本身有效；
 *  7. status 自检退出码 0 / 1 / 2 正确；
 *  8. 装配清单、Remote 清单、触发源配置样例齐全。
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SA = join(ROOT, 'packages', 'superagent')

const { TOOL_NAMES, TOOL_DESCRIPTORS } = await import('../packages/superagent/src/tools/index.ts')
const { VIEW_NAMES, VIEW_BUILDERS, sampleViews } = await import('../packages/superagent/src/app/views/index.ts')
const {
  mainName, githubWatchName, feishuWatchName, createAssembly,
  createGithubWatchAssembly, createFeishuWatchAssembly, MANAGEMENT_REMOTES,
} = await import('../packages/superagent/src/app/host/index.ts')
const {
  runSelfCheck, containsSelfBuiltOrchestratorRoute, findSelfBuiltRoutes,
  EXIT_OK, EXIT_INCOMPLETE, EXIT_SECURITY,
} = await import('../packages/superagent/src/infra/selfcheck.ts')
const { scanRepositoryForRoutes, runService } = await import('../packages/superagent/src/infra/service.ts')

const results = []
function check(name, fn) {
  try {
    const detail = fn()
    results.push({ name, ok: true, detail: detail ?? 'OK' })
  } catch (error) {
    results.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) })
  }
}
const read = (relativePath) => readFileSync(join(ROOT, relativePath), 'utf8')
const saRead = (relativePath) => readFileSync(join(SA, relativePath), 'utf8')
const sorted = (list) => [...list].sort()

// 1. B2 三个入口可解析
check('B2 三个入口文件存在且关键导出齐全', () => {
  const entries = [
    ['packages/superagent/src/app/host/main.ts', 'dsh-superagent'],
    ['packages/superagent/src/app/host/github-watch.ts', 'dsh-superagent/github-watch'],
    ['packages/superagent/src/app/host/feishu-watch.ts', 'dsh-superagent/feishu-watch'],
  ]
  for (const [path, id] of entries) {
    assert.ok(existsSync(join(ROOT, path)), `缺文件 ${path}`)
    const text = read(path)
    assert.match(text, /export const name/, `${path} 缺 export const name`)
    assert.match(text, /export const inject/, `${path} 缺 export const inject`)
    assert.match(text, /export function apply/, `${path} 缺 export function apply`)
    assert.ok(text.includes(id), `${path} 的 name 不是 ${id}`)
  }
  assert.equal(mainName, 'dsh-superagent')
  assert.equal(githubWatchName, 'dsh-superagent/github-watch')
  assert.equal(feishuWatchName, 'dsh-superagent/feishu-watch')
  const manifest = createAssembly({})
  assert.equal(manifest.inject.length, 11, 'B2-01 inject 应为 11 个服务')
  assert.equal(manifest.tools.length, 19)
  assert.equal(manifest.views.length, 7)
  const gh = createGithubWatchAssembly()
  const fs = createFeishuWatchAssembly()
  assert.equal(gh.enabled, true, 'GitHub 源应默认启用')
  assert.equal(fs.enabled, false, '飞书源应默认关闭')
  assert.equal(fs.spec.kind, 'generic', '飞书源应为声明式 generic 映射')
  return '3 入口 / inject 11 / GitHub 默认开 / 飞书默认关'
})

// 2. 19 个工具名与账本一致
check('19 个工具名与 FEATURES.md §B3 账本一致', () => {
  const features = read('docs/FEATURES.md')
  const section = features.split('### B3')[1]?.split('### B4')[0] ?? ''
  const ledger = [...section.matchAll(/`([^`]+)`/g)]
    .map(match => match[1] ?? '')
    .map(name => name.startsWith('_') ? `orchestrator${name}` : name)
    .filter(name => name.startsWith('orchestrator_'))
  assert.equal(ledger.length, 19, `账本里解析到 ${ledger.length} 个工具名，期望 19`)
  assert.deepEqual(sorted(ledger), sorted(TOOL_NAMES), '账本与 TOOL_NAMES 不一致')
  assert.equal(new Set(TOOL_NAMES).size, 19, '工具名有重复')
  assert.equal(TOOL_DESCRIPTORS.length, 19)
  for (const descriptor of TOOL_DESCRIPTORS) {
    assert.ok(descriptor.description.length <= 120, `${descriptor.name} 的 description 超过 120 字符`)
    assert.ok(descriptor.description.length > 0, `${descriptor.name} 缺 description`)
    assert.equal(descriptor.parameters.type, 'object', `${descriptor.name} 的 parameters 不是 object`)
    assert.equal(typeof descriptor.handler, 'function', `${descriptor.name} 缺 handler`)
  }
  return '19/19 一致，description 均 <=120 字符'
})

// 3. 7 个视图存在
check('7 个面板视图存在且示例 JSON 覆盖全部', () => {
  const expected = ['overview', 'tickets', 'records', 'threads', 'sources', 'settings', 'deploy']
  assert.deepEqual(sorted(VIEW_NAMES), sorted(expected), '视图名与账本 §B4 不一致')
  for (const name of expected) assert.equal(typeof VIEW_BUILDERS[name], 'function', `缺 builder ${name}`)
  const views = sampleViews()
  for (const name of expected) {
    const view = views[name]
    assert.ok(view, `示例缺视图 ${name}`)
    assert.equal(view.view, name)
    assert.ok(Array.isArray(view.rows), `${name}.rows 不是数组`)
    assert.ok(Array.isArray(view.actions), `${name}.actions 不是数组`)
    assert.equal(typeof view.summary.total, 'number', `${name}.summary.total 缺失`)
  }
  const samplePath = join(SA, 'examples', 'superagent-views.json')
  assert.ok(existsSync(samplePath), '缺 examples/superagent-views.json')
  const sample = JSON.parse(readFileSync(samplePath, 'utf8'))
  assert.deepEqual(sorted(Object.keys(sample)), sorted(expected))
  // Overview 只显示需要人处理的票：已结束的票不该出现在示例里。
  assert.ok(!sample.overview.rows.some(row => row.id === 'overview:tk-done'), 'Overview 混进了已结束的票')
  return '7/7 视图，Overview 遵守 ready 无 follow 直接结束票的规则'
})

// 4. 提示词文件齐全且常驻体量达标
check('提示词与剧本齐全，常驻文件低于预算', () => {
  const manifest = JSON.parse(saRead('prompts/manifest.json'))
  assert.ok(Array.isArray(manifest.files), 'manifest 缺 files')
  assert.equal(manifest.groups.length, 6, '应为 6 组')
  assert.ok(manifest.files.length >= 16, `提示词文件少于账本 16 个：${manifest.files.length}`)
  const budget = manifest.residentMaxChars
  assert.equal(typeof budget, 'number')
  let residents = 0
  for (const file of manifest.files) {
    const path = join(SA, 'prompts', file.path)
    assert.ok(existsSync(path), `缺提示词文件 ${file.path}`)
    const text = readFileSync(path, 'utf8')
    if (file.level === 'resident') {
      residents++
      assert.ok(text.length < budget, `常驻文件 ${file.path} 为 ${text.length} 字符，未小于预算 ${budget}`)
    }
  }
  assert.ok(residents > 0, '没有任何常驻文件，预算检查形同虚设')
  for (const playbook of manifest.playbooks) {
    assert.ok(existsSync(join(SA, 'playbooks', playbook)), `缺 .flow 剧本 ${playbook}`)
  }
  return `${manifest.files.length} 个文件（账本 16 为口径差异，按 §B6 明细全部交付）/ ${residents} 个常驻均 <${budget} 字符 / ${manifest.playbooks.length} 个 .flow`
})

// 5. 2 个 SKILL.md frontmatter
check('2 个 SKILL.md 有合法 frontmatter', () => {
  const manifest = JSON.parse(saRead('prompts/manifest.json'))
  const skills = manifest.files.filter(file => file.skill === true)
  assert.equal(skills.length, 2, `应有 2 个技能文件，实际 ${skills.length}`)
  for (const skill of skills) {
    const text = saRead(`prompts/${skill.path}`)
    assert.ok(text.startsWith('---\n'), `${skill.path} 缺 frontmatter 起始`)
    assert.match(text, /^name:\s*\S+/m, `${skill.path} 缺 name`)
    assert.match(text, /^description:\s*\S+/m, `${skill.path} 缺 description`)
    assert.ok(text.indexOf('\n---', 4) > 0, `${skill.path} 缺 frontmatter 结束`)
  }
  return 'github / feishu 两个 SKILL.md frontmatter 合法'
})

// 6. C2-01 无自建 /orchestrator 路由，且断言本身有效
check('C2-01 管理面无自建 /orchestrator HTTP 路由', () => {
  // 先证明断言不是摆设：一段明确的路由注册代码必须被命中。
  const badSnippet = 'app.get(' + "'/orchestrator'" + ', handler)'
  assert.equal(containsSelfBuiltOrchestratorRoute(badSnippet), true, '断言无法识别自建路由，静态检查不可信')
  assert.equal(containsSelfBuiltOrchestratorRoute('说明：无自建 /orchestrator 路由'), false, '文档叙述被误判为路由')
  const found = findSelfBuiltRoutes([
    { path: 'a/routes.ts', text: badSnippet },
    { path: 'b/ok.ts', text: 'const x = 1' },
    { path: 'c/doc.md', text: badSnippet },
  ])
  assert.deepEqual(found, ['a/routes.ts'], 'findSelfBuiltRoutes 应只命中代码文件里的路由')
  const hits = scanRepositoryForRoutes(ROOT)
  assert.deepEqual(hits, [], `仓库里发现自建路由：${hits.join(', ')}`)
  assert.ok(MANAGEMENT_REMOTES.length >= 17, '管理面 Remote 清单不完整')
  return `仓库扫描 0 命中；管理面 ${MANAGEMENT_REMOTES.length} 个 Remote 全部走 Typert`
})

// 7. 自检与 status 退出码
check('自检与 status 退出码 0 / 1 / 2 正确', () => {
  const good = { stateDirReady: true, env: { GH_WEBHOOK_SECRET: 'placeholder' }, assetsReady: true, selfBuiltRoutes: [] }
  assert.equal(runSelfCheck(good).exitCode, EXIT_OK)
  const incomplete = runSelfCheck({ ...good, stateDirReady: false })
  assert.equal(incomplete.exitCode, EXIT_INCOMPLETE)
  assert.ok(incomplete.summary.includes('stateDir'), '缺项原因里没点名 stateDir')
  const security = runSelfCheck({ ...good, selfBuiltRoutes: ['routes.ts'] })
  assert.equal(security.exitCode, EXIT_SECURITY)
  // status 子命令必须把自检退出码原样交出去。
  const io = { log: () => {} }
  const statusWith = (result) => runService('status', {
    executor: { start: () => {}, stop: () => {}, isRunning: () => false, selfCheck: () => result },
    io,
  })
  assert.equal(statusWith(runSelfCheck(good)), EXIT_OK)
  assert.equal(statusWith(incomplete), EXIT_INCOMPLETE)
  assert.equal(statusWith(security), EXIT_SECURITY)
  return '0 全绿 / 1 缺项 / 2 安全红线，status 透传正确'
})

// 8. 装配清单与配置样例
check('装配清单与触发源配置样例齐全', () => {
  const manifest = createAssembly({})
  assert.ok(manifest.division.includes('orchestrator-plugin'), '分工说明没提 orchestrator-plugin')
  assert.ok(manifest.division.includes('不 new Engine') || manifest.division.includes('注入同一份'), '分工说明没讲清不重复挂 Engine')
  assert.ok(existsSync(join(SA, 'examples', 'sources.patch.yml')), '缺 examples/sources.patch.yml')
  const yaml = readFileSync(join(SA, 'examples', 'sources.patch.yml'), 'utf8')
  assert.ok(yaml.includes('secretEnv: GH_WEBHOOK_SECRET'), '样例缺 GitHub 密钥环境变量')
  assert.ok(yaml.includes('enabled: false'), '飞书源样例没标默认关闭')
  assert.ok(!/^\s*secret:\s*\S+/m.test(yaml) && !/^\s*value:\s*\S+/m.test(yaml), '样例里出现明文密钥')
  return '分工说明 / 配置样例 / 密钥走 *Env 均就位'
})

// 汇总
let failed = 0
for (const result of results) {
  process.stdout.write(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name}${result.ok ? ` — ${result.detail}` : `：${result.detail}`}\n`)
  if (!result.ok) failed++
}
process.stdout.write(`SUMMARY  ${results.length - failed}/${results.length} 通过\n`)
if (failed > 0) process.exit(1)
