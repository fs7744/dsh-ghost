/** 宿主 CLI 参数与 token 解析：对齐真实 `dsh` 参数，不再自造 token。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildHostArgs, parseHostUrl } from '../src/electron-host-launcher.ts'

test('CLI 参数：profile / patch / host / port / no-open，且不传宿主不认的参数', () => {
  const args = buildHostArgs({ profile: 'p05', port: 3917, patchPath: 'C:/x/patch.yml' })
  assert.deepEqual(args, [
    '--profile', 'p05', '--patch', 'C:/x/patch.yml',
    '--host', '127.0.0.1', '--port', '3917', '--no-open',
  ])
  assert.equal(args.includes('--state-dir'), false)
  assert.equal(args.includes('--permission-mode'), false)
  const fresh = buildHostArgs({ profile: 'desktop', port: 0, fromDefaultProfile: true })
  assert.deepEqual(fresh.slice(0, 4), ['--profile', 'desktop', '--from-default-profile', 'web'])
})

test('从宿主输出解析入口 URL 与 token', () => {
  const parsed = parseHostUrl('booted\n  http://127.0.0.1:3917/?token=tk_abc-123\nready')
  assert.deepEqual(parsed, { port: 3917, token: 'tk_abc-123', url: 'http://127.0.0.1:3917/?token=tk_abc-123' })
  assert.equal(parseHostUrl('no url here'), undefined)
  assert.equal(parseHostUrl('http://127.0.0.1:0/?token=x'), undefined)
})
