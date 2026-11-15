import { boot, stop, login, createTransport } from './lib-driver.mjs'

let server
try {
  server = await boot({ profile: 'p05', fromDefault: false })
  const session = await login(server.url, 'none')
  const transport = createTransport({ ...session, onError: e => console.log('WARN', String(e)) })
  const created = await transport.call('session/create', { request: { cwd: process.cwd() } })
  const sessionId = created?.sessionId ?? ''
  const made = await transport.call('schedule/create', {
    request: {
      title: '测试剧本',
      prompt: '执行剧本 test-flow',
      timing: { kind: 'daily', daily: { time: '09:00:00', time_zone: 'Asia/Shanghai' } },
      target: { kind: 'session', sessionId },
    },
  }).catch(e => ({ err: String(e) }))
  console.log('CREATE', JSON.stringify(made ?? null).slice(0, 700))
  if (made?.err === undefined) {
    const list = await transport.call('schedule/list', { request: {} })
    console.log('LIST', JSON.stringify(list ?? null).slice(0, 800))
    const ran = await transport.call('schedule/run', { request: { id: made.id } }).catch(e => ({ err: String(e) }))
    console.log('RUN', JSON.stringify(ran ?? null).slice(0, 300))
    await new Promise(r => setTimeout(r, 1500))
    const page = await transport.call('session/page', { request: { address: { kind: 'session', sessionId }, maxMessages: 20 } })
    const records = page?.records ?? []
    console.log('RECORDS', records.length, JSON.stringify(records).slice(0, 500))
  }
} catch (error) {
  console.log('ERR', String(error))
} finally {
  if (server !== undefined) await stop(server.child)
}
