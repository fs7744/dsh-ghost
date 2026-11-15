/** B6 提示词：文件齐全、常驻体量预算、技能 frontmatter、.flow 剧本。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SA = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(SA, 'prompts', 'manifest.json'), 'utf8')) as {
  residentMaxChars: number
  groups: Array<{ id: string; level: string }>
  files: Array<{ path: string; group: string; level: string; skill?: boolean }>
  playbooks: string[]
}
const readPrompt = (path: string) => readFileSync(join(SA, 'prompts', path), 'utf8')

test('manifest 有 6 组、账本 16 个提示词与常驻预算', () => {
  assert.equal(manifest.groups.length, 6)
  assert.ok(manifest.files.length >= 16, `只登记了 ${manifest.files.length} 个文件`)
  assert.equal(typeof manifest.residentMaxChars, 'number')
  assert.ok(manifest.residentMaxChars > 0 && manifest.residentMaxChars < 2000)
  assert.ok(manifest.groups.every(group => group.level.length > 0), '每组都要写清加载级别')
})

test('登记的每个提示词文件都真实存在', () => {
  const missing = manifest.files.filter(file => !existsSync(join(SA, 'prompts', file.path)))
  assert.deepEqual(missing.map(file => file.path), [])
})

test('15 个纯提示词 + 2 个技能文件，口径与账本差异如实登记', () => {
  const skills = manifest.files.filter(file => file.skill === true)
  const prompts = manifest.files.filter(file => file.skill !== true)
  assert.equal(skills.length, 2)
  assert.equal(prompts.length, 15)
  assert.equal(manifest.files.length, 17)
})

test('每个常驻文件确实小于预算', () => {
  const residents = manifest.files.filter(file => file.level === 'resident')
  assert.ok(residents.length > 0, '没有常驻文件，预算检查形同虚设')
  for (const file of residents) {
    const length = readPrompt(file.path).length
    assert.ok(length < manifest.residentMaxChars, `${file.path} 有 ${length} 字符，未小于 ${manifest.residentMaxChars}`)
  }
})

test('常驻系统提示总量在数百 token 级', () => {
  const total = manifest.files
    .filter(file => file.level === 'resident')
    .reduce((sum, file) => sum + readPrompt(file.path).length, 0)
  assert.ok(total > 0 && total < 2500, `常驻合计 ${total} 字符，超出数百 token 级`)
})

test('流程步骤不塞在常驻提示词里（不含 .flow 跳转语法）', () => {
  for (const file of manifest.files.filter(item => item.level === 'resident')) {
    const text = readPrompt(file.path)
    assert.ok(!text.includes('->'), `${file.path} 里出现了条件跳转，流程应该搬到 .flow`)
    assert.ok(!text.includes('(max '), `${file.path} 里出现了回退上限语法`)
  }
})

test('2 个 SKILL.md 有合法 frontmatter（name + description）', () => {
  for (const skill of manifest.files.filter(file => file.skill === true)) {
    const text = readPrompt(skill.path)
    assert.ok(text.startsWith('---\n'), `${skill.path} 缺 frontmatter 起始`)
    assert.match(text, /^name:\s*\S+/m)
    assert.match(text, /^description:\s*\S+/m)
    assert.ok(text.indexOf('\n---', 4) > 0, `${skill.path} 缺 frontmatter 结束`)
  }
})

test('6 个 .flow 剧本齐全且都是紧凑文本给模型', () => {
  assert.equal(manifest.playbooks.length, 6)
  for (const playbook of manifest.playbooks) {
    const path = join(SA, 'playbooks', playbook)
    assert.ok(existsSync(path), `缺剧本 ${playbook}`)
    const text = readFileSync(path, 'utf8')
    assert.match(text, /^# @\S+/m, `${playbook} 缺 @id`)
    assert.match(text, /^# goal\s+\S+/m, `${playbook} 缺 goal`)
    assert.ok(text.length < 2000, `${playbook} 太长，不该把流程写成大段说明`)
  }
})

test('6 组都标了常驻 / 按需 / 混合的加载级别', () => {
  const levels = new Set(manifest.groups.map(group => group.level))
  for (const level of levels) assert.ok(['resident', 'on-demand', 'mixed'].includes(level), `未知加载级别 ${level}`)
  assert.ok(levels.has('resident') && levels.has('on-demand'))
})

test('常驻分片保留系统要填的占位符，与 prompts_save 校验一致', () => {
  const worker = readPrompt('worker.md')
  const dispatch = readPrompt('dispatch.md')
  const handoff = readPrompt('handoff.md')
  assert.ok(worker.includes('{{ticket}}'))
  assert.ok(dispatch.includes('{{ticket}}'))
  assert.ok(handoff.includes('{{ticket}}') && handoff.includes('{{assignment}}'))
})
