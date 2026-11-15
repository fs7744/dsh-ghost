/** 用户扩展在桌面端：面板清单、插槽按钮、端点不可用时优雅降级。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadExtensions, slotButtons, slotSection, slotsFor } from '../src/extensions.ts'

const fakeServices = (handlers: Record<string, unknown>) => ({
  transport: {
    async call(endpoint: string) {
      if (!(endpoint in handlers)) throw new Error(`no handler ${endpoint}`)
      return handlers[endpoint]
    },
  },
  agentId: () => 's1',
  notice: () => {},
  t: (key: string) => key,
}) as never

test('扩展清单从宿主拉来，非法项被丢掉', async () => {
  const services = fakeServices({
    'ghostUI/panels': { panels: [{ id: 'my-panel', title: '我的面板', source: { endpoint: 'p/rows' } }, { id: 'Bad' }], errors: [] },
    'ghostUI/slots': { slots: [{ slot: 'chat.toolbar', label: '按钮', endpoint: 'p/open' }], errors: [] },
  })
  const extensions = await loadExtensions(services)
  assert.equal(extensions.panels.length, 1)
  assert.equal(extensions.panels[0]?.id, 'my-panel')
  assert.equal(extensions.slots.length, 1)
})

test('宿主没装扩展插件时不报错，只是没有扩展', async () => {
  const services = fakeServices({})
  const extensions = await loadExtensions(services)
  assert.equal(extensions.panels.length, 0)
  assert.equal(extensions.slots.length, 0)
})

test('插槽只渲染对应槽位，按钮带端点与参数', () => {
  const slots = [
    { slot: 'chat.toolbar' as const, label: '打开面板', endpoint: 'p/open', args: { id: 7 } },
    { slot: 'settings.sections' as const, label: '设置项', description: '说明' },
  ]
  assert.equal(slotsFor(slots, 'chat.toolbar').length, 1)
  const buttons = slotButtons(slots, 'chat.toolbar')
  assert.match(buttons, /data-slot-endpoint="p\/open"/)
  assert.match(buttons, /data-slot-args/)
  const section = slotSection(slots, 'settings.sections')
  assert.match(section, /设置项/)
  assert.match(section, /说明/)
})
