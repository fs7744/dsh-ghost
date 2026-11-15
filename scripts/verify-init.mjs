#!/usr/bin/env node
/**
 * C11-07 本地验收：扫描一个临时仓库生成 GHOST.md 草案，并验证不覆盖既有文件。
 * 纯本地、不启宿主；失败 exit(1)。
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { draftGhostMd, scanRepo, writeGhostDraft } from '../packages/evolution/src/index.ts'

let failures = 0
const check = (ok, label, extra = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra === '' ? '' : `：${extra}`}\n`)
  if (!ok) failures += 1
}

const root = mkdtempSync(join(tmpdir(), 'ghost-init-'))
try {
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name: 'demo', description: '示例项目', scripts: { build: 'tsc', test: 'node --test' },
  }))
  writeFileSync(join(root, 'README.md'), '# Demo\n这是一个示例项目，用来验证 /init 草案。\n')
  mkdirSync(join(root, 'src'))

  const scan = await scanRepo(root)
  const draft = draftGhostMd(scan)
  check(draft.content.includes('[来源: package.json]'), '草案标注了 package.json 来源')
  check(draft.content.includes('[来源: README.md]'), '草案标注了 README 来源')
  check(draft.content.includes('tsc'), '草案含从 package.json 提取的构建命令')
  check(draft.content.includes('待确认'), '草案有「待确认」区块')
  check(draft.sources.includes('目录结构'), '草案标注了目录结构来源')
  check(draft.wouldWrite === true, 'GHOST.md 不存在时允许写入')

  const first = await writeGhostDraft(root)
  check(first.created === true, '首次生成会写入 GHOST.md')
  check(readFileSync(join(root, 'GHOST.md'), 'utf8').includes('GHOST.md（草案）'), '写入的是草案正文')

  // 人工改写后再跑 /init，绝不能覆盖。
  const manual = '人工约定：不许覆盖我。\n'
  writeFileSync(join(root, 'GHOST.md'), manual)
  const second = await writeGhostDraft(root)
  check(second.created === false, 'GHOST.md 已存在时不写入')
  check(readFileSync(join(root, 'GHOST.md'), 'utf8') === manual, '既有文件内容一字不变')
} catch (error) {
  failures += 1
  process.stdout.write(`FAIL  异常：${String(error)}\n`)
} finally {
  rmSync(root, { recursive: true, force: true })
}
process.stdout.write(`\n${failures === 0 ? '/init 草案验收通过' : `${failures} 项失败`}\n`)
process.exit(failures === 0 ? 0 : 1)
