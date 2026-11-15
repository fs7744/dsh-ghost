/**
 * test:evolution（二）—— C11-03 压缩策略配置 / C11-07 GHOST.md 草案。
 * 纯函数 + 内存 IO，不碰真实仓库、不覆盖任何既有文件。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_COMPACTION, compactInvocation, deserializeCompaction, draftGhostMd,
  memoryFileIo, normalizeCompaction, serializeCompaction, toSettingsJson,
  validateCompaction, writeGhostDraft, type RepoScan,
} from '../src/index.ts'

test('C11-03 默认配置合法，normalize 补齐缺省字段', () => {
  assert.equal(validateCompaction(DEFAULT_COMPACTION).ok, true)
  const merged = normalizeCompaction({ triggerRatio: 0.6 })
  assert.equal(merged.triggerRatio, 0.6)
  assert.equal(merged.pruneThresholdBytes, DEFAULT_COMPACTION.pruneThresholdBytes)
  assert.equal(merged.keepPolicy, DEFAULT_COMPACTION.keepPolicy)
  assert.equal(merged.keepRecentImages, 2)
})

test('C11-03 非法值一律被拒（越界/类型/和>1/负值/非对象）', () => {
  assert.equal(validateCompaction({ triggerRatio: 1.5 }).ok, false)
  assert.equal(validateCompaction({ pruneThresholdBytes: -1 }).ok, false)
  assert.equal(validateCompaction({ keepPolicy: 'bogus' }).ok, false)
  assert.equal(validateCompaction({ headKeepRatio: 0.8, tailKeepRatio: 0.5 }).ok, false)
  assert.equal(validateCompaction({ keepRecentImages: -1 }).ok, false)
  assert.equal(validateCompaction({ compactFocus: 'x'.repeat(200) }).ok, false)
  assert.equal(validateCompaction('not an object').ok, false)
  const verdict = validateCompaction({ triggerRatio: 2 })
  assert.equal(verdict.ok, false)
  assert.ok(verdict.errors.length > 0)
})

test('C11-03 normalize 遇到非法配置直接抛错', () => {
  assert.throws(() => normalizeCompaction({ triggerRatio: 2 }), /非法/)
  assert.throws(() => normalizeCompaction({ keepPolicy: 'nope' }), /非法/)
})

test('C11-03 settings 序列化/反序列化往返', () => {
  const config = normalizeCompaction({ triggerRatio: 0.5, compactFocus: '当前任务' })
  const shape = serializeCompaction(config)
  assert.equal(shape.compaction.triggerRatio, 0.5)
  assert.equal(deserializeCompaction(shape).compactFocus, '当前任务')
  assert.equal(deserializeCompaction(shape).triggerRatio, 0.5)
  assert.equal(deserializeCompaction({}).triggerRatio, DEFAULT_COMPACTION.triggerRatio)
})

test('C11-03 toSettingsJson 是含 compaction 键的合法 JSON', () => {
  const json = toSettingsJson(normalizeCompaction({ keepPolicy: 'recent' }))
  const parsed = JSON.parse(json) as { compaction: { keepPolicy: string } }
  assert.equal(parsed.compaction.keepPolicy, 'recent')
  assert.match(json, /"compaction"/)
})

test('C11-03 /compact 焦点参数由配置生成', () => {
  assert.deepEqual(
    compactInvocation(normalizeCompaction({ compactFocus: '支付模块' })),
    { command: '/compact', focus: '支付模块' },
  )
  assert.deepEqual(compactInvocation(DEFAULT_COMPACTION), { command: '/compact' })
})

test('C11-07 草案标出来源与不确定项', () => {
  const scan: RepoScan = {
    files: {
      'package.json': JSON.stringify({ name: 'demo', scripts: { build: 'tsc', test: 'node --test' } }),
      'README.md': '# Demo\n这是一个示例项目。\n',
    },
    dirs: ['src', 'docs'],
    ghostExists: false,
  }
  const draft = draftGhostMd(scan)
  assert.match(draft.content, /\[来源: package\.json\]/)
  assert.match(draft.content, /\[来源: README\.md\]/)
  assert.match(draft.content, /待确认/)
  assert.ok(draft.sources.includes('package.json') && draft.sources.includes('README.md'))
  assert.equal(draft.wouldWrite, true)

  const sparse = draftGhostMd({ files: {}, dirs: [], ghostExists: false })
  assert.ok(sparse.uncertainties.some(item => item.includes('package.json')))
  assert.ok(sparse.uncertainties.some(item => item.includes('README')))
})

test('C11-07 不覆盖既有 GHOST.md；不存在时才写草案', async () => {
  const original = '人工写的项目约定，不许覆盖'
  const existing = memoryFileIo({ 'GHOST.md': original })
  const blocked = await writeGhostDraft('', existing)
  assert.equal(blocked.created, false)
  assert.equal(existing.files.get('GHOST.md'), original)

  const fresh = memoryFileIo()
  const created = await writeGhostDraft('', fresh)
  assert.equal(created.created, true)
  assert.match(fresh.files.get('GHOST.md') ?? '', /GHOST\.md（草案）/)
  assert.ok(created.created === true && created.path !== undefined)
})
