/**
 * 单实例参数转发 / 深链 / 文件关联单测（C5-03 / C5-06）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  collectOpenFiles, parseForwardedDeepLinks, parseSecondInstanceArgs, planSecondInstance,
} from '../src/single-instance.ts'

const EXE = 'C:\\app\\dsh-ghost.exe'

test('parseSecondInstanceArgs 剔除 Windows exe 路径', () => {
  const p = parseSecondInstanceArgs([EXE, '--flag-x', 'dsh-ghost://open/a'], EXE, 'C:/work')
  assert.deepEqual(p.flags, ['--flag-x'])
  assert.deepEqual(p.files, [])
  assert.equal(p.deepLinks.length, 1)
})

test('parseSecondInstanceArgs 收集 dsh-ghost 深链并按 action 解析', () => {
  const p = parseSecondInstanceArgs(['dsh-ghost://ticket/7', 'dsh-ghost://settings'], '/app/dsh', 'C:/work')
  assert.equal(p.deepLinks.length, 2)
  const parsed = parseForwardedDeepLinks(p)
  assert.equal(parsed[0]?.ok, true)
  assert.equal(parsed[1]?.ok, true)
})

test('parseSecondInstanceArgs 识别 Windows 盘符 / UNC / 带扩展名路径', () => {
  const p = parseSecondInstanceArgs(['D:\\tickets\\a.flow', '\\\\server\\share\\b.txt', 'notes.md'], '/app/dsh', 'C:/work')
  assert.deepEqual(p.files, ['D:\\tickets\\a.flow', '\\\\server\\share\\b.txt', 'notes.md'])
})

test('parseSecondInstanceArgs 过滤开关并去重重复项', () => {
  const p = parseSecondInstanceArgs(
    ['--a', 'C:/w/a.flow', 'C:/w/a.flow', 'dsh-ghost://open/x', 'dsh-ghost://open/x'],
    '/app', 'C:/w',
  )
  assert.deepEqual(p.flags, ['--a'])
  assert.deepEqual(p.files, ['C:/w/a.flow'])
  assert.deepEqual(p.deepLinks, ['dsh-ghost://open/x'])
})

test('parseSecondInstanceArgs 空 argv 得到空 payload', () => {
  const p = parseSecondInstanceArgs([], '/app', 'C:/w')
  assert.deepEqual(p.files, [])
  assert.deepEqual(p.deepLinks, [])
  assert.equal(p.cwd, 'C:/w')
})

test('非 dsh-ghost 的远程 URL 既不当深链也不当文件', () => {
  const p = parseSecondInstanceArgs(['https://evil.example/x', 'dsh-ghost://open/ok'], '/app', 'C:/w')
  assert.deepEqual(p.deepLinks, ['dsh-ghost://open/ok'])
  assert.equal(p.files.length, 0)
})

test('collectOpenFiles 去重并过滤空串', () => {
  assert.deepEqual(collectOpenFiles(['a.flow', '', 'a.flow', 'b.txt']), ['a.flow', 'b.txt'])
})

test('parseForwardedDeepLinks 对非法深链给出拒绝结果', () => {
  const p = parseSecondInstanceArgs(['dsh-ghost://unknown/x'], '/app', 'C:/w')
  const [first] = parseForwardedDeepLinks(p)
  assert.equal(first?.ok, false)
})

test('planSecondInstance 先聚焦，再打开文件，再导航深链', () => {
  const p = parseSecondInstanceArgs(['C:/w/a.flow', 'dsh-ghost://ticket/9'], '/app', 'C:/w')
  assert.deepEqual(planSecondInstance(p).map(a => a.kind), ['focus', 'openFiles', 'navigate'])
})

test('planSecondInstance 无文件/深链时只聚焦', () => {
  const actions = planSecondInstance({ deepLinks: [], files: [], flags: ['--x'], cwd: 'C:/w' })
  assert.deepEqual(actions, [{ kind: 'focus' }])
})

test('planSecondInstance 动作携带去重后的文件与深链', () => {
  const p = parseSecondInstanceArgs(['C:/w/a.flow', 'C:/w/a.flow', 'dsh-ghost://open/x'], '/app', 'C:/w')
  const actions = planSecondInstance(p)
  assert.equal(actions.length, 3)
  const open = actions[1]
  if (open?.kind === 'openFiles') assert.deepEqual(open.files, ['C:/w/a.flow'])
  else assert.fail('expected openFiles action')
})
