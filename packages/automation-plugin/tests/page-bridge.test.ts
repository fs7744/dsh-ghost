/** 页面桥：快照上报、命令排队、结果回传、超时。 */
// src 里有装饰器语法（Node 的 strip-types 不支持），所以测编译产物。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  activePageSessionId, completeCommand, dispatchPageCommand, readSnapshot, registerSnapshot, takeCommand,
} from '../lib/page-bridge.js'

test('上报快照后能读到，「当前页面」指向最近一次上报的会话', () => {
  registerSnapshot('sess-a', { url: 'https://news.example/1', title: '今日新闻', text: '头条：某事', at: 0 })
  assert.equal(readSnapshot('sess-a').snapshot?.title, '今日新闻')
  assert.equal(activePageSessionId(), 'sess-a')
  registerSnapshot('sess-b', { url: 'https://exam.example/', title: '考试系统', text: '登录', at: 0 })
  assert.equal(activePageSessionId(), 'sess-b')
  assert.equal(readSnapshot('sess-a').online, true)
})

test('模型下命令 → 扩展取到 → 回传结果，模型收到回复', async () => {
  registerSnapshot('sess-c', { url: 'https://news.example/1', title: '今日新闻', text: '查看新闻', at: 0 })
  const pending = dispatchPageCommand('sess-c', { action: 'click', target: '查看新闻' }, 5000)
  const command = takeCommand('sess-c')
  assert.equal(command?.action, 'click')
  assert.equal(command?.target, '查看新闻')
  assert.equal(completeCommand('sess-c', { id: command?.id ?? '', ok: true, message: '已点击「查看新闻」。' }), true)
  const result = await pending
  assert.equal(result.ok, true)
  assert.match(result.message, /已点击/)
})

test('扩展不回传就超时，模型拿到人话原因而不是挂死', async () => {
  const pending = dispatchPageCommand('sess-c', { action: 'screenshot' }, 60)
  const result = await pending
  assert.equal(result.ok, false)
  assert.match(result.message, /没有回应/)
})

test('回传未知命令不算成功', () => {
  assert.equal(completeCommand('sess-c', { id: 'nope', ok: true, message: 'x' }), false)
})
