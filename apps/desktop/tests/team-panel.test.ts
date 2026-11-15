/** 多 agent 面板：从投影里归一化团队任务、子 agent 目录、权限档位。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizePermission, normalizeSubagentCatalog, normalizeTeamTasks } from '../src/team-panel.ts'

test('团队任务：从投影里挑出标题与状态', () => {
  const rows = normalizeTeamTasks([
    { id: 't1', title: '先做接口', status: 'running' },
    { summary: '再做界面' },
    { nothing: true },
  ])
  assert.equal(rows.length, 2)
  assert.equal(rows[0]?.title, '先做接口')
  assert.equal(rows[0]?.state, 'running')
  assert.equal(rows[1]?.title, '再做界面')
})

test('子 agent 目录：id 必填，label 缺失时用 id 兜底', () => {
  const rows = normalizeSubagentCatalog([
    { id: 'spawn', label: '临时子 agent', mode: 'spawn' },
    { id: 'fork' },
    { label: '没有 id' },
  ])
  assert.equal(rows.length, 2)
  assert.equal(rows[0]?.label, '临时子 agent')
  assert.equal(rows[1]?.label, 'fork')
})

test('权限档位：读 currentValue，缺失时是 unknown', () => {
  assert.equal(normalizePermission({ currentValue: 'read-only' }), 'read-only')
  assert.equal(normalizePermission({}), 'unknown')
  assert.equal(normalizePermission(undefined), 'unknown')
})
