/** 工作区写入校验：只允许工作区内、允许的扩展名、内容有上限。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkWorkspaceWrite } from '../src/workspace-write.ts'

const base = 'C:/work'

test('合法相对路径解析到工作区内', () => {
  const ok = checkWorkspaceWrite(base, 'playbooks/ticket.flow', '# @a\ny\n')
  assert.equal(ok.ok, true)
  if (ok.ok) assert.match(ok.path, /playbooks[\\/]ticket\.flow$/)
})

test('拒绝绝对路径、.. 逃逸、空路径与空字节', () => {
  for (const path of ['C:/Windows/x.flow', '../x.flow', 'a/../../x.flow', '', 'a\0b.flow']) {
    assert.equal(checkWorkspaceWrite(base, path, 'x').ok, false, path)
  }
})

test('拒绝非白名单扩展名与超大内容', () => {
  assert.equal(checkWorkspaceWrite(base, 'run.js', 'x').ok, false)
  assert.equal(checkWorkspaceWrite(base, 'x.flow', 'x'.repeat(2 * 1024 * 1024 + 1)).ok, false)
  assert.equal(checkWorkspaceWrite(base, 'x.flow', 'x'.repeat(1024)).ok, true)
})
