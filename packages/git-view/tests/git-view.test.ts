/** git 输出解析：状态、增删、差异、冲突块与冲突解决。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  findConflicts, parseNumstat, parseStatusPorcelain, parseUnifiedDiff, resolveConflict,
} from '../src/index.ts'

test('porcelain 状态：未跟踪 / 修改 / 冲突都能认出来', () => {
  const out = parseStatusPorcelain([
    ' M src/app.ts',
    '?? notes.md',
    'A  new.txt',
    'UU conflict.ts',
    'R  old.ts -> new.ts',
  ].join('\n'))
  assert.equal(out.length, 5)
  assert.equal(out.find(row => row.path === 'notes.md')?.status, 'untracked')
  assert.equal(out.find(row => row.path === 'src/app.ts')?.status, 'modified')
  assert.equal(out.find(row => row.path === 'new.txt')?.status, 'added')
  assert.equal(out.find(row => row.path === 'conflict.ts')?.status, 'conflicted')
  assert.equal(out.find(row => row.path === 'new.ts')?.path, 'new.ts', '重命名取新路径')
})

test('numstat：二进制文件不当成 0 变更', () => {
  const counts = parseNumstat('12\t3\tsrc/a.ts\n-\t-\timage.png\n')
  assert.equal(counts.get('src/a.ts')?.additions, 12)
  assert.equal(counts.get('src/a.ts')?.deletions, 3)
  assert.equal(counts.get('image.png')?.additions, 0)
})

test('unified diff：分出行号与类型', () => {
  const diff = [
    'diff --git a/a.ts b/a.ts',
    '--- a/a.ts',
    '+++ b/a.ts',
    '@@ -1,3 +1,4 @@',
    ' context',
    '-old',
    '+new',
    '+extra',
  ].join('\n')
  const lines = parseUnifiedDiff(diff)
  const add = lines.filter(line => line.type === 'add')
  const del = lines.filter(line => line.type === 'del')
  assert.equal(add.length, 2)
  assert.equal(del.length, 1)
  assert.equal(add[0]?.text, 'new')
  assert.equal(add[0]?.newNo, 2)
  assert.equal(del[0]?.oldNo, 2)
})

test('冲突块：能找出我方/对方，并按选择解决', () => {
  const content = [
    'line 1',
    '<<<<<<< HEAD',
    'ours line',
    '=======',
    'theirs line',
    '>>>>>>> feature',
    'line 2',
  ].join('\n')
  const blocks = findConflicts(content)
  assert.equal(blocks.length, 1)
  assert.deepEqual(blocks[0]?.ours, ['ours line'])
  assert.deepEqual(blocks[0]?.theirs, ['theirs line'])
  assert.match(resolveConflict(content, 'ours'), /ours line/)
  assert.doesNotMatch(resolveConflict(content, 'ours'), /theirs line/)
  assert.match(resolveConflict(content, 'theirs'), /theirs line/)
  assert.match(resolveConflict(content, 'both'), /ours line[\s\S]*theirs line/)
})
