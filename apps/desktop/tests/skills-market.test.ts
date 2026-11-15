/** 技能页与插件市场：真实字段（path / modelInvocable）、市场索引提示。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSkills } from '../src/runtime-panels.ts'
import { normalizeMarket } from '../src/admin-panels.ts'

test('技能行保留 path 与 modelInvocable，界面能标「模型可直接调用」', () => {
  const rows = normalizeSkills({
    skills: [
      { name: 'office-docx', description: '创建 Word 文档', path: 'D:/skills/office-docx/SKILL.md', modelInvocable: true },
      { name: 'local-thing', description: '本地技能' },
    ],
  })
  assert.equal(rows.length, 2)
  const docx = rows.find(row => row.name === 'office-docx')
  assert.equal(docx?.modelInvocable, true)
  assert.equal(docx?.path, 'D:/skills/office-docx/SKILL.md')
  assert.equal(rows.find(row => row.name === 'local-thing')?.modelInvocable, false)
})

test('市场行保留名称、版本与索引地址（安装要用）', () => {
  const rows = normalizeMarket([
    { name: '@scope/pkg', version: '1.2.3', description: '示例', url: 'https://index.test/pkg' },
  ])
  assert.equal(rows[0]?.name, '@scope/pkg')
  assert.equal(rows[0]?.version, '1.2.3')
  assert.equal(rows[0]?.url, 'https://index.test/pkg')
})
