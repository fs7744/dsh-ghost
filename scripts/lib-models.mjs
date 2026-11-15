#!/usr/bin/env node
/**
 * 「工程化 / 模型管理 / 测试分层」这条线共用的纯逻辑。
 *
 * 只放确定性、零网络、零 DOM、可注入依赖的函数：CLI 脚本与 node:test 用例
 * 都从这一份实现取结果，避免各脚本另写一套判定，导致门禁与测试口径不一致。
 * 所有导出都是纯函数：不读写文件、不起进程、不访问 process.env、不看时钟。
 * 需要时间 / 请求 / 文件系统的一侧，由调用方以参数注入。
 */

// ---------------------------------------------------------------------------
// 一、故障模式选择（C4-02 / L1，llm-mock-server 用）
// ---------------------------------------------------------------------------

/** 确定性故障注入支持的模式。顺序即文档展示顺序。 */
export const FAULT_MODES = Object.freeze([
  'normal',       // 正常返回
  'timeout',      // 挂住不响应，直到调用方超时
  'http500',      // 返回 500
  'http429',      // 返回 429（限流）
  'truncated',    // 返回被截断的合法前缀
  'bad-json',     // 返回非法 JSON 文本
  'tool-call',    // 返回一个 tool_calls 结构
])

const FAULT_SET = new Set(FAULT_MODES)
const PATH_FAULT = /^\/fault\/([a-z0-9-]+)\//

/**
 * 选择本次请求要注入的故障模式。
 *
 * 优先级：请求头 x-dsh-fault > 路径段 /fault/<mode>/ > 查询参数 fault > 默认 normal。
 * 选中了但值不在 FAULT_MODES 里时返回 null，调用方据此回 400，不静默回退到正常。
 *
 * @param {{ header?: string, path?: string, query?: Record<string, unknown> }} spec
 * @returns {{ mode: string, source: 'header'|'path'|'query'|'default' } | null}
 */
export function selectFaultMode(spec = {}) {
  const header = spec.header
  const path = spec.path ?? ''
  const query = spec.query ?? {}
  let candidate
  let source = 'default'
  if (typeof header === 'string' && header !== '') {
    candidate = header
    source = 'header'
  } else {
    const fromPath = PATH_FAULT.exec(path)
    if (fromPath !== null) {
      candidate = fromPath[1]
      source = 'path'
    } else {
      const fromQuery = query.fault
      if (typeof fromQuery === 'string' && fromQuery !== '') {
        candidate = fromQuery
        source = 'query'
      }
    }
  }
  if (candidate === undefined) return { mode: 'normal', source: 'default' }
  if (!FAULT_SET.has(candidate)) return null
  return { mode: candidate, source }
}

// ---------------------------------------------------------------------------
// 二、回放基线的规范化与 diff（C4-03 / L2，replay 用）
// ---------------------------------------------------------------------------

/**
 * 易变字段：录制与回放之间本来就会变，必须从基线里剔掉。
 * 时间类、随机 id 类、token 计数类、耗时类都在这里；命中即按键名整键删除。
 */
export const VOLATILE_KEYS = Object.freeze([
  'id', 'rpcId', 'requestId', 'messageId', 'traceId', 'spanId', 'sessionId',
  'created', 'createdAt', 'updated', 'updatedAt', 'timestamp', 'time', 'ts', 'at', 't',
  'date', 'datetime', 'dateTime', 'isoTime', 'generatedAt', 'startedAt', 'finishedAt',
  'durationMs', 'elapsed', 'elapsedMs', 'latencyMs', 'tookMs',
  'usage', 'tokenCount', 'tokens', 'promptTokens', 'completionTokens',
  'prompt_tokens', 'completion_tokens', 'total_tokens', 'totalTokens',
])

const VOLATILE_SET = new Set(VOLATILE_KEYS)

/** 稳定序列化：对象键按字典序排列，数组顺序保留（顺序本身是语义，不能排序）。 */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const keys = Object.keys(value).sort()
  const parts = []
  for (const key of keys) {
    const item = value[key]
    if (item === undefined) continue
    parts.push(`${JSON.stringify(key)}:${stableStringify(item)}`)
  }
  return `{${parts.join(',')}}`
}

/**
 * 去掉一条记录里的易变字段，返回规范化后的新对象（不改入参）。
 * 递归处理嵌套对象与数组；值为 undefined 的键也丢掉，保证 JSON 往返一致。
 */
export function normalizeRecord(record) {
  if (Array.isArray(record)) return record.map(normalizeRecord)
  if (record === null || typeof record !== 'object') return record
  const out = {}
  for (const key of Object.keys(record).sort()) {
    if (VOLATILE_SET.has(key)) continue
    const value = record[key]
    if (value === undefined) continue
    out[key] = normalizeRecord(value)
  }
  return out
}

/** 解析 JSONL 文本；空行跳过，坏行收集到 errors 而不静默吞掉。 */
export function parseJsonl(text) {
  const records = []
  const errors = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim()
    if (line === '') continue
    try {
      records.push({ line: i + 1, value: JSON.parse(line) })
    } catch (error) {
      errors.push({ line: i + 1, message: String(error) })
    }
  }
  return { records, errors }
}

/** 把一组记录序列化成规范化 JSONL。 */
export function toNormalizedJsonl(records) {
  return records.map(record => stableStringify(normalizeRecord(record))).join('\n') + (records.length > 0 ? '\n' : '')
}

/**
 * 比较两份 JSONL 基线：先各自规范化，再逐行对齐比较。
 * 返回 equal 与逐条差异；不相等时调用方 exit 1。
 */
export function diffRecords(expectedText, actualText) {
  const expected = parseJsonl(expectedText)
  const actual = parseJsonl(actualText)
  const diffs = []
  if (expected.errors.length > 0) {
    for (const item of expected.errors) diffs.push({ index: item.line, reason: 'bad-json', side: 'expected', detail: item.message })
  }
  if (actual.errors.length > 0) {
    for (const item of actual.errors) diffs.push({ index: item.line, reason: 'bad-json', side: 'actual', detail: item.message })
  }
  const eRows = expected.records.map(row => stableStringify(normalizeRecord(row.value)))
  const aRows = actual.records.map(row => stableStringify(normalizeRecord(row.value)))
  const total = Math.max(eRows.length, aRows.length)
  for (let i = 0; i < total; i += 1) {
    const e = eRows[i]
    const a = aRows[i]
    if (e === undefined) diffs.push({ index: i + 1, reason: 'extra', actual: a })
    else if (a === undefined) diffs.push({ index: i + 1, reason: 'missing', expected: e })
    else if (e !== a) diffs.push({ index: i + 1, reason: 'mismatch', expected: e, actual: a })
  }
  return { equal: diffs.length === 0, compared: total, diffs }
}

// ---------------------------------------------------------------------------
// 三、门禁汇总（C2-03 / C4-06，verify-gates 用）
// ---------------------------------------------------------------------------

/**
 * 把若干门禁子检查结果汇总成一张表，并给出统一 exit code。
 * results: [{ name, ok, detail?, durationMs? }]
 * 纯函数：不执行任何命令，调用方把已跑完的结果喂进来。
 */
export function summarizeGates(results) {
  const rows = results.map((result, index) => ({
    index: index + 1,
    name: String(result.name),
    status: result.ok === true ? 'PASS' : 'FAIL',
    ok: result.ok === true,
    detail: result.detail === undefined ? '' : String(result.detail).slice(0, 80),
  }))
  const failed = rows.filter(row => !row.ok)
  const allPass = failed.length === 0
  const width = Math.max(4, ...rows.map(row => row.name.length))
  const lines = [
    `${'#'.padEnd(3)} ${'门禁'.padEnd(width)} 结果   说明`,
    `${'-'.repeat(3)} ${'-'.repeat(width)} ------ ${'-'.repeat(20)}`,
    ...rows.map(row => `${String(row.index).padEnd(3)} ${row.name.padEnd(width)} ${row.status.padEnd(6)} ${row.detail}`),
  ]
  return {
    rows,
    passed: rows.length - failed.length,
    failed: failed.length,
    allPass,
    exitCode: allPass ? 0 : 1,
    table: lines.join('\n'),
  }
}

// ---------------------------------------------------------------------------
// 四、升级计划（C1-04，upgrade-harness 用）
// ---------------------------------------------------------------------------

/** 固定 8 步顺序，任何情况下不得调整。 */
export const UPGRADE_STEP_IDS = Object.freeze([
  'change-version',
  'install',
  'verify-contract',
  'typecheck',
  'test',
  'smoke',
  'ui-regression',
  'write-matrix',
])

/** 版本号只接受三段数字加可选预发布后缀，拒绝 latest / 路径 / 空串。 */
export function validateVersion(version) {
  if (typeof version !== 'string') return false
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)
}

/**
 * 生成升级计划。步骤顺序固定；mutates 标出会落盘的步骤（dry-run 不执行）。
 * 步骤里带 port 文件提示，失败时告诉使用者该改哪里，而不是改 harness。
 */
export function buildUpgradePlan(version) {
  const steps = [
    {
      id: 'change-version',
      label: '改根 package.json 里 @deepseek-ai/* 的版本',
      command: null,
      mutates: true,
      portHint: 'packages/harness-port/src/remotes.generated.ts（版本变更后由 gen:remotes 重生成）',
    },
    {
      id: 'install',
      label: '提示运行 pnpm/npm install 拉取新版本',
      command: null,
      mutates: false,
      portHint: 'packages/harness-port/**（若新版本改了 wire 参数名，重生成 remotes）',
    },
    {
      id: 'verify-contract',
      label: '重生成 Remote/事件契约并跑探针 verify-harness-contract.mjs',
      command: 'npm run gen:remotes && npm run gen:events && npm run verify:events && npm run verify:contract',
      mutates: true,
      portHint: 'harness-contract/{contract,remotes,events}.json 与 packages/harness-port/src/*.generated.ts（漂移只改 port 层）',
    },
    {
      id: 'typecheck',
      label: '类型面 typecheck',
      command: 'npm run typecheck',
      mutates: false,
      portHint: 'packages/harness-port/src/**/*.ts（类型漂移只在此修）',
    },
    {
      id: 'test',
      label: '行为面 test',
      command: 'npm test',
      mutates: false,
      portHint: 'packages/harness-port/src/**/*.ts 与对应 tests/**',
    },
    {
      id: 'smoke',
      label: '冒烟：起只装我们 bundle 的 profile 验插件装载（一条 Ticket 的轻量版）',
      command: 'npm run verify:plugin-boot',
      mutates: false,
      portHint: 'packages/harness-port/src/transport.ts（RPC 形状变化先查这里）',
    },
    {
      id: 'ui-regression',
      label: '界面回归提示（L5，每日跑，不进 PR）',
      command: 'npm run verify:l5',
      mutates: false,
      portHint: 'apps/desktop/src/**（renderer 侧契约耦合）',
    },
    {
      id: 'write-matrix',
      label: '写 harness-contract/matrix.json 并提交（绝不自动 push）',
      command: null,
      mutates: true,
      portHint: 'harness-contract/matrix.json',
    },
  ]
  return { version, steps }
}

/**
 * 改写根 package.json 里 @deepseek-ai/* 依赖的版本（升级流水线的单点）。
 *
 * cordis 是独立版本线，缺省保持不动；要一起升就显式传 cordisVersion。
 * 只改 dependencies / devDependencies / peerDependencies / optionalDependencies
 * 里以 @deepseek-ai/ 开头的键，别的依赖一律不碰。纯函数：返回新文本，不写盘。
 *
 * @returns {{ text: string, changed: Array<{ section:string, key:string, from:string, to:string }> }}
 */
export function rewritePackageVersions(pkgText, version, cordisVersion) {
  const pkg = JSON.parse(pkgText)
  const changed = []
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const group = pkg[section]
    if (group === undefined || group === null || typeof group !== 'object') continue
    for (const key of Object.keys(group)) {
      if (!key.startsWith('@deepseek-ai/')) continue
      const isCordis = key === '@deepseek-ai/cordis'
      const next = isCordis ? (cordisVersion ?? group[key]) : version
      if (typeof next !== 'string' || group[key] === next) continue
      changed.push({ section, key, from: String(group[key]), to: next })
      group[key] = next
    }
  }
  return { text: `${JSON.stringify(pkg, null, 2)}\n`, changed }
}

// ---------------------------------------------------------------------------
// 五、import 纪律违规检出（C1-05，check-port-discipline 用）
// ---------------------------------------------------------------------------

const IMPORT_PATTERNS = [
  { kind: 'import', re: /\bimport\b[^;]*?\bfrom\s*(['"])(@deepseek-ai\/[^'"\n]+)\1/g },
  { kind: 'export', re: /\bexport\b[^;]*?\bfrom\s*(['"])(@deepseek-ai\/[^'"\n]+)\1/g },
  { kind: 'side-effect', re: /\bimport\s*(['"])(@deepseek-ai\/[^'"\n]+)\1/g },
  { kind: 'dynamic', re: /\bimport\s*\(\s*(['"])(@deepseek-ai\/[^'"\n]+)\1\s*\)/g },
  { kind: 'require', re: /\brequire\s*\(\s*(['"])(@deepseek-ai\/[^'"\n]+)\1\s*\)/g },
]
// 内部源码路径：即使不是标准 import 语句，出现字符串字面量也要抓（红线 3）。
const INTERNAL_PATH = /(['"])(@deepseek-ai\/[^'"\n]*\/src(?:\/[^'"\n]*)?)\1/g

/** 是否位于允许直连 harness 的包内。 */
export function isHarnessPort(filePath) {
  return filePath.replace(/\\/g, '/').includes('packages/harness-port/')
}

/**
 * 在单份源码文本里检出所有 @deepseek-ai 模块引用。
 *
 * - harness-port 包内整体豁免（这是唯一的兼容层）。
 * - 命中 /src/ 内部路径：一律 error，白名单也不能豁免（红线 3）。
 * - 其余命中：在 allowlist 里的按 WARN 记（默认模式不阻断），strict 时升为 error；
 *   不在白名单里的一律 error。
 *
 * @param {string} text 源码文本
 * @param {string} filePath 相对仓库根的路径（POSIX 或 Windows 都可）
 * @param {{ allowlist?: Map<string,string>, strict?: boolean }} options
 */
export function classifyImports(text, filePath, options = {}) {
  const file = filePath.replace(/\\/g, '/')
  if (isHarnessPort(file)) return []
  const allowlist = options.allowlist ?? new Map()
  const strict = options.strict === true
  const found = new Map() // key: line|spec -> violation（合并重复命中）

  // 用 spec 字符串自身的位置算行号：import 语句可能跨多行，语句起点并不等于 from 所在行。
  const lineOf = index => text.slice(0, index).split('\n').length
  const specIndex = match => match.index + match[0].lastIndexOf(match[2])
  // 注释里写的示例 import 不是真引用；规格文档与工具脚本常带这类说明文字。
  const inComment = index => {
    const lineStart = text.lastIndexOf('\n', index - 1) + 1
    const before = text.slice(lineStart, index)
    return before.includes('//') || before.includes('/*') || /^\s*\*/.test(before)
  }
  const add = (spec, index, kind, internal) => {
    if (inComment(index)) return
    const line = lineOf(index)
    const key = `${line}|${spec}`
    const prev = found.get(key)
    // 内部路径命中优先级最高；其余重复命中保留首次的 kind 即可。
    if (prev !== undefined && (prev.internal || !internal)) return
    found.set(key, { file, line, spec, kind, internal })
  }

  for (const pattern of IMPORT_PATTERNS) {
    const re = new RegExp(pattern.re.source, pattern.re.flags)
    let match
    while ((match = re.exec(text)) !== null) {
      add(match[2], specIndex(match), pattern.kind, false)
    }
  }
  let match
  while ((match = INTERNAL_PATH.exec(text)) !== null) {
    add(match[2], specIndex(match), 'internal-path', true)
  }

  const violations = []
  for (const item of found.values()) {
    const whitelisted = !item.internal && allowlist.has(item.file)
    let severity
    if (item.internal) severity = 'error'
    else if (whitelisted) severity = strict ? 'error' : 'warn'
    else severity = 'error'
    violations.push({
      ...item,
      whitelisted,
      severity,
      reason: whitelisted ? allowlist.get(item.file) : undefined,
    })
  }
  violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.spec.localeCompare(b.spec))
  return violations
}

// ---------------------------------------------------------------------------
// 六、评测集评分（C4-05 / L4，verify-l4 用）
// ---------------------------------------------------------------------------

/**
 * L3 结构断言求值（C4-04）。只看结构信号，绝不断言模型文本。
 * 前三项是硬断言（失败即整体失败）；hasLink 是观测项，不阻断，避免模型
 * 某次不给链接就误红、最后没人看测试。
 */
export function evaluateStructure(signals) {
  const checks = [
    { id: 'tool-call', label: '工具调用发生', pass: signals.toolCallHappened === true, required: true },
    { id: 'file-changed', label: '文件被改动', pass: signals.fileChanged === true, required: true },
    { id: 'state-migrated', label: '状态迁移到结束', pass: signals.stateMigrated === true, required: true },
    { id: 'has-link', label: '答复含链接（观测项，不阻断）', pass: signals.hasLink === true, required: false },
  ]
  const failed = checks.filter(item => item.required && !item.pass).length
  return { checks, failed, ok: failed === 0 }
}

/**
 * 三条率的统计。输入每条 { taskId, completed, violation, noise }（布尔字段缺省按 false）。
 * 只统计结构信号，不解析模型文本；total 为 0 时三条率都为 0。
 */
export function scoreEvals(records) {
  const total = records.length
  const completed = records.filter(row => row.completed === true).length
  const violation = records.filter(row => row.violation === true).length
  const noise = records.filter(row => row.noise === true).length
  const rate = n => (total === 0 ? 0 : n / total)
  return {
    total, completed, violation, noise,
    completionRate: rate(completed),
    violationRate: rate(violation),
    noiseRate: rate(noise),
  }
}
